/* ============================================================
 * 拼豆工坊 · 图纸生成管线
 *  源图 RGBA ─▶ 面积平均降采样(像素化) ─▶ 调色 ─▶ 量化+吸附色卡
 *          ─▶ 最近色分配(可选抖动) ─▶ 统计与编号
 * 纯计算，不依赖 DOM，方便 Node 里跑测试。
 * ============================================================ */
(function (g) {
  'use strict';

  const C = g.PBColor;
  const Q = g.PBQuantize;

  /* ---------------- 面积平均降采样 ---------------- */
  function buildWeights(size, count) {
    const scale = size / count;
    const ranges = new Array(count);
    const norm = new Float64Array(count);
    for (let c = 0; c < count; c++) {
      const a = c * scale, b = (c + 1) * scale;
      let i0 = Math.floor(a), i1 = Math.ceil(b);
      if (i1 > size) i1 = size;
      if (i0 < 0) i0 = 0;
      const arr = [];
      let total = 0;
      for (let i = i0; i < i1; i++) {
        const s = Math.max(a, i), e = Math.min(b, i + 1);
        const w = e - s;
        if (w > 0) { arr.push(i, w); total += w; }
      }
      ranges[c] = arr;
      norm[c] = total > 0 ? total : 1;
    }
    return { ranges, norm };
  }

  /**
   * 把源图按网格做面积平均（而不是丢点采样），缩小后颜色更稳定。
   * @param {Uint8ClampedArray|Uint8Array} data RGBA
   * @returns {{r:Float32Array,g:Float32Array,b:Float32Array,a:Float32Array}}
   */
  function areaResample(data, sw, sh, cols, rows) {
    const n = cols * rows;
    const outR = new Float32Array(n);
    const outG = new Float32Array(n);
    const outB = new Float32Array(n);
    const outA = new Float32Array(n);

    const xw = buildWeights(sw, cols);
    const yw = buildWeights(sh, rows);

    const rowStride = sw * 4;
    for (let cy = 0; cy < rows; cy++) {
      const yarr = yw.ranges[cy];
      const yTotal = yw.norm[cy];
      for (let cx = 0; cx < cols; cx++) {
        const xarr = xw.ranges[cx];
        const xTotal = xw.norm[cx];
        const total = yTotal * xTotal;

        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let yi = 0; yi < yarr.length; yi += 2) {
          const py = yarr[yi], wy = yarr[yi + 1];
          const base = py * rowStride;
          for (let xi = 0; xi < xarr.length; xi += 2) {
            const px = xarr[xi], wx = xarr[xi + 1];
            const w = wy * wx;
            const o = base + px * 4;
            const al = data[o + 3] / 255;
            sr += data[o] * al * w;
            sg += data[o + 1] * al * w;
            sb += data[o + 2] * al * w;
            sa += al * w;
          }
        }

        const alpha = sa / total; // 平均不透明度
        const idx = cy * cols + cx;
        if (alpha <= 0.0001) {
          outR[idx] = 255; outG[idx] = 255; outB[idx] = 255; outA[idx] = 0;
        } else {
          outR[idx] = sr / sa;  // 反预乘 → 真实颜色
          outG[idx] = sg / sa;
          outB[idx] = sb / sa;
          outA[idx] = alpha;
        }
      }
    }
    return { r: outR, g: outG, b: outB, a: outA };
  }

  /* ---------------- 抖动 ---------------- */
  function ditherToPalette(cells, cols, rows, palette, nearestLab, strength) {
    const idx = new Int16Array(cols * rows).fill(-1);
    const buf = new Float32Array(cols * rows * 3);
    for (let i = 0; i < cols * rows; i++) {
      buf[i * 3] = cells.r[i];
      buf[i * 3 + 1] = cells.g[i];
      buf[i * 3 + 2] = cells.b[i];
    }

    const clamp255 = C.clamp;
    const s = strength;

    for (let y = 0; y < rows; y++) {
      const leftToRight = (y & 1) === 0; // 蛇形扫描，减少条纹
      for (let k = 0; k < cols; k++) {
        const x = leftToRight ? k : cols - 1 - k;
        const i = y * cols + x;
        if (cells.a[i] <= 0) { idx[i] = -1; continue; }

        const r = clamp255(buf[i * 3], 0, 255);
        const gg = clamp255(buf[i * 3 + 1], 0, 255);
        const b = clamp255(buf[i * 3 + 2], 0, 255);

        const lab = C.rgbToLab(r, gg, b);
        const pi = nearestLab(lab.L, lab.a, lab.b);
        const p = palette[pi];
        idx[i] = pi;

        const er = (r - p.r) * s;
        const eg = (gg - p.g) * s;
        const eb = (b - p.b) * s;
        const dir = leftToRight ? 1 : -1;

        const add = (xx, yy, f) => {
          if (xx < 0 || xx >= cols || yy < 0 || yy >= rows) return;
          const j = (yy * cols + xx) * 3;
          buf[j] += er * f;
          buf[j + 1] += eg * f;
          buf[j + 2] += eb * f;
        };
        add(x + dir, y, 7 / 16);
        add(x - dir, y + 1, 3 / 16);
        add(x, y + 1, 5 / 16);
        add(x + dir, y + 1, 1 / 16);
      }
    }
    return idx;
  }

  /* ---------------- 主流程 ---------------- */
  /**
   * @param {object} cfg
   * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} cfg.source
   * @param {number} cfg.cols 列数（横向豆数）
   * @param {number} cfg.rows 行数
   * @param {Array} cfg.palette 色卡
   * @param {number} cfg.maxColors 最大颜色数
   * @param {number} cfg.mergeDeltaE 相近色合并阈值(CIEDE2000)
   * @param {0|1|2} cfg.dither 0 关 / 1 弱 / 2 强
   * @param {'white'|'black'|'none'} cfg.background 透明区域的底色
   * @param {{brightness:number,contrast:number,saturation:number}} cfg.adjust
   */
  function buildPattern(cfg) {
    const cols = Math.max(1, cfg.cols | 0);
    const rows = Math.max(1, cfg.rows | 0);
    const palette = cfg.palette;
    const bg = cfg.background || 'white';
    const adj = cfg.adjust || null;

    const cells = areaResample(cfg.source.data, cfg.source.width, cfg.source.height, cols, rows);

    // 合成背景 + 调色 + 打包成 0xRRGGBB
    const packed = new Int32Array(cols * rows);
    const bgRGB = bg === 'black' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    let emptyCount = 0;

    for (let i = 0; i < cols * rows; i++) {
      let alpha = cells.a[i];
      let r = cells.r[i], gg = cells.g[i], b = cells.b[i];

      if (bg === 'none' && alpha < 0.5) {
        // 半透明区域按白底预览，但判定为空豆位
        emptyCount++;
        packed[i] = -1;
        cells.a[i] = 0;
        continue;
      }
      if (alpha < 1) {
        r = r * alpha + bgRGB.r * (1 - alpha);
        gg = gg * alpha + bgRGB.g * (1 - alpha);
        b = b * alpha + bgRGB.b * (1 - alpha);
      }
      if (adj) {
        const a2 = C.adjust(r, gg, b, adj);
        r = a2.r; gg = a2.g; b = a2.b;
      }
      const ri = C.clamp(Math.round(r), 0, 255);
      const gi = C.clamp(Math.round(gg), 0, 255);
      const bi = C.clamp(Math.round(b), 0, 255);
      cells.r[i] = ri; cells.g[i] = gi; cells.b[i] = bi; cells.a[i] = 1;
      packed[i] = (ri << 16) | (gi << 8) | bi;
    }

    // 配色：直方图 → 量化 → 吸附色卡 → 合并相近色
    const histogram = Q.buildHistogram(packed);
    if (!histogram.length) {
      return {
        cols, rows,
        indices: new Int16Array(cols * rows).fill(-1),
        palette: [], total: 0, empty: cols * rows,
        cells: packed, source: cells
      };
    }

    const finalColors = Q.buildFinalPalette(histogram, palette, {
      maxColors: cfg.maxColors,
      mergeDeltaE: cfg.mergeDeltaE
    });

    // 分配：最近色 or 抖动
    let indices;
    if (cfg.dither) {
      const nearestLab = C.makeNearestLab(finalColors);
      indices = ditherToPalette(cells, cols, rows, finalColors, nearestLab, cfg.dither === 2 ? 0.92 : 0.55);
    } else {
      const nearest = C.makeNearest(finalColors);
      const cache = new Map();
      indices = new Int16Array(cols * rows);
      for (let i = 0; i < packed.length; i++) {
        if (packed[i] < 0) { indices[i] = -1; continue; }
        let v = cache.get(packed[i]);
        if (v === undefined) {
          const r = (packed[i] >> 16) & 255, gg = (packed[i] >> 8) & 255, b = packed[i] & 255;
          v = nearest(r, gg, b);
          cache.set(packed[i], v);
        }
        indices[i] = v;
      }
    }

    // 统计 → 去掉没被用到的颜色 → 按豆量降序重新编号
    const counts = new Int32Array(finalColors.length);
    for (let i = 0; i < indices.length; i++) {
      const v = indices[i];
      if (v >= 0) counts[v]++;
    }

    const order = [];
    for (let i = 0; i < finalColors.length; i++) if (counts[i] > 0) order.push(i);
    order.sort((a, b) => counts[b] - counts[a]);

    const remap = new Int32Array(finalColors.length).fill(-1);
    const bead = order.map((oldIdx, newIdx) => {
      remap[oldIdx] = newIdx;
      const c = finalColors[oldIdx];
      return {
        index: newIdx,
        code: c.code,
        name: c.name,
        hex: c.hex,
        r: c.r, g: c.g, b: c.b,
        count: counts[oldIdx]
      };
    });

    for (let i = 0; i < indices.length; i++) {
      const v = indices[i];
      indices[i] = v < 0 ? -1 : remap[v];
    }

    let total = 0;
    for (let i = 0; i < bead.length; i++) total += bead[i].count;

    return {
      cols,
      rows,
      indices,
      palette: bead,
      total,
      empty: cols * rows - total,
      cells: packed,
      source: cells
    };
  }

  g.PBPattern = {
    areaResample,
    buildWeights,
    buildPattern,
    ditherToPalette
  };
})(typeof window !== 'undefined' ? window : globalThis);

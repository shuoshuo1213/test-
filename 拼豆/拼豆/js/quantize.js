/* ============================================================
 * 拼豆工坊 · 量化与配色映射
 *  1) 直方图统计（去重 + 计数）
 *  2) 加权中位切分（median cut）得到 k 个初始主色
 *  3) Lab 空间 k-means 精修
 *  4) 主色吸附到拼豆色卡
 *  5) 相近色合并（CIEDE2000 阈值 + 数量上限）
 * ============================================================ */
(function (g) {
  'use strict';

  const C = g.PBColor;

  /* ---------------- 直方图 ---------------- */
  /**
   * @param {Int32Array|Array<number>} packed 每个格子的 0xRRGGBB，-1 表示空格
   * @returns {Array<{r,g,b,count,lab}>}
   */
  function buildHistogram(packed) {
    const map = new Map();
    for (let i = 0; i < packed.length; i++) {
      const k = packed[i];
      if (k < 0) continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    const items = [];
    map.forEach((count, k) => {
      const r = (k >> 16) & 255, gg = (k >> 8) & 255, b = k & 255;
      items.push({ r, g: gg, b, count, lab: C.rgbToLab(r, gg, b) });
    });
    return items;
  }

  /* ---------------- 加权中位切分 ---------------- */
  function boxOf(list) {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    let LMin = 100, LMax = -100, aMin = 128, aMax = -128, bMinL = 128, bMaxL = -128;
    let weight = 0, sr = 0, sg = 0, sb = 0, sL = 0, sa = 0, sbb = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.r < rMin) rMin = p.r; if (p.r > rMax) rMax = p.r;
      if (p.g < gMin) gMin = p.g; if (p.g > gMax) gMax = p.g;
      if (p.b < bMin) bMin = p.b; if (p.b > bMax) bMax = p.b;
      const l = p.lab;
      if (l.L < LMin) LMin = l.L; if (l.L > LMax) LMax = l.L;
      if (l.a < aMin) aMin = l.a; if (l.a > aMax) aMax = l.a;
      if (l.b < bMinL) bMinL = l.b; if (l.b > bMaxL) bMaxL = l.b;
      weight += p.count;
      sr += p.r * p.count; sg += p.g * p.count; sb += p.b * p.count;
      sL += l.L * p.count; sa += l.a * p.count; sbb += l.b * p.count;
    }
    return {
      list,
      weight,
      range: [rMax - rMin, gMax - gMin, bMax - bMin],
      labRange: [LMax - LMin, aMax - aMin, bMaxL - bMinL],
      mean: {
        r: sr / weight, g: sg / weight, b: sb / weight,
        L: sL / weight, a: sa / weight, b: sbb / weight
      }
    };
  }

  /** 选出「最值得再切一刀」的盒子 */
  function pickBox(boxes) {
    let best = -1, bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.list.length < 2) continue;
      const lg = box.labRange;
      const span = Math.max(lg[0], lg[1], lg[2]);
      if (span < 1e-4) continue;
      // 权重 × 跨度：既有豆量优势，也有色域优势
      const score = Math.sqrt(box.weight) * span;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function splitBox(box) {
    const lg = box.labRange;
    let axis = 'b';
    if (lg[0] >= lg[1] && lg[0] >= lg[2]) axis = 'L';
    else if (lg[1] >= lg[0] && lg[1] >= lg[2]) axis = 'a';

    const key = (p) => (axis === 'L' ? p.lab.L : axis === 'a' ? p.lab.a : p.lab.b);
    const sorted = box.list.slice().sort((x, y) => key(x) - key(y));

    const half = box.weight / 2;
    let acc = 0, cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].count;
      if (acc >= half) { cut = i + 1; break; }
      cut = i + 2;
    }
    if (cut >= sorted.length) cut = sorted.length - 1;
    if (cut < 1) cut = 1;
    return [sorted.slice(0, cut), sorted.slice(cut)];
  }

  function medianCut(items, k) {
    if (!items.length) return [];
    let boxes = [boxOf(items.slice())];
    while (boxes.length < k) {
      const idx = pickBox(boxes);
      if (idx < 0) break;
      const [a, b] = splitBox(boxes[idx]);
      if (!a.length || !b.length) break;
      boxes.splice(idx, 1, boxOf(a), boxOf(b));
    }
    return boxes.map((b) => ({
      r: Math.round(b.mean.r),
      g: Math.round(b.mean.g),
      b: Math.round(b.mean.b),
      L: b.mean.L, a: b.mean.a, bb: b.mean.b,
      count: b.weight
    }));
  }

  /* ---------------- k-means 精修（Lab 空间，按豆量加权） ---------------- */
  function kmeans(items, seeds, iterations) {
    const k = seeds.length;
    const cent = seeds.map((s) => ({ L: s.L, a: s.a, b: s.bb }));
    const assign = new Int32Array(items.length).fill(-1);
    const iters = iterations == null ? 8 : iterations;

    for (let it = 0; it < iters; it++) {
      let changed = 0;
      // 分配
      for (let i = 0; i < items.length; i++) {
        const p = items[i].lab;
        let best = 0, bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const q = cent[c];
          const dL = p.L - q.L, da = p.a - q.a, db = p.b - q.b;
          const d = dL * dL + da * da + db * db;
          if (d < bestD) { bestD = d; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; changed++; }
      }
      // 更新
      const sum = new Float64Array(k * 3);
      const wsum = new Float64Array(k);
      for (let i = 0; i < items.length; i++) {
        const c = assign[i], it2 = items[i], p = it2.lab, w = it2.count;
        sum[c * 3] += p.L * w; sum[c * 3 + 1] += p.a * w; sum[c * 3 + 2] += p.b * w;
        wsum[c] += w;
      }
      for (let c = 0; c < k; c++) {
        if (wsum[c] > 0) {
          cent[c].L = sum[c * 3] / wsum[c];
          cent[c].a = sum[c * 3 + 1] / wsum[c];
          cent[c].b = sum[c * 3 + 2] / wsum[c];
        }
      }
      if (!changed && it > 0) break;
    }
    // 簇权重
    const weights = new Float64Array(k);
    for (let i = 0; i < items.length; i++) weights[assign[i]] += items[i].count;

    const out = [];
    for (let c = 0; c < k; c++) {
      if (weights[c] <= 0) continue;
      const rgb = C.labToRgb(cent[c].L, cent[c].a, cent[c].b);
      out.push({ r: rgb.r, g: rgb.g, b: rgb.b, count: weights[c] });
    }
    return out;
  }

  /* ---------------- 主色提取 ---------------- */
  function quantize(items, k) {
    if (!items.length) return [];
    if (items.length <= k) {
      return items.map((p) => ({ r: p.r, g: p.g, b: p.b, count: p.count }));
    }
    const seeds = medianCut(items, k);
    if (seeds.length <= 1) return seeds.map((s) => ({ r: s.r, g: s.g, b: s.b, count: s.count }));
    return kmeans(items, seeds, 8);
  }

  /* ---------------- 吸附到色卡 ---------------- */
  function snapToPalette(quantized, palette) {
    const nearest = C.makeNearest(palette);
    const acc = new Map();
    for (let i = 0; i < quantized.length; i++) {
      const q = quantized[i];
      const idx = nearest(q.r, q.g, q.b);
      const p = palette[idx];
      const cur = acc.get(idx);
      if (cur) cur.count += q.count;
      else {
        acc.set(idx, {
          code: p.code, name: p.name, hex: p.hex,
          r: p.r, g: p.g, b: p.b, count: q.count
        });
      }
    }
    return Array.from(acc.values());
  }

  /* ---------------- 相近色合并 ---------------- */
  /**
   * 反复合并「色差最小」的一对颜色，直到：
   *  - 颜色数 <= maxCount
   *  - 且（threshold <= 0 或 最小色差 >= threshold）
   * 合并时把豆量少的并到豆量多的颜色上。
   */
  function mergeSimilar(list, maxCount, threshold) {
    const cols = list.map((c) => ({
      code: c.code, name: c.name, hex: c.hex, r: c.r, g: c.g, b: c.b, count: c.count,
      lab: c.lab || C.rgbToLab(c.r, c.g, c.b)
    }));

    const need = () => cols.length > maxCount;
    const similar = (d) => threshold > 0 && d < threshold;

    while (cols.length > 1) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < cols.length; i++) {
        const ci = cols[i].lab;
        for (let j = i + 1; j < cols.length; j++) {
          const d = C.deltaE2000(ci, cols[j].lab);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
      }
      if (bi < 0) break;
      if (!need() && !similar(bd)) break;

      const a = cols[bi], b = cols[bj];
      const keepIdx = a.count >= b.count ? bi : bj;
      const dropIdx = keepIdx === bi ? bj : bi;
      cols[keepIdx].count += cols[dropIdx].count;
      cols.splice(dropIdx, 1);
    }

    return cols
      .map((c) => ({ code: c.code, name: c.name, hex: c.hex, r: c.r, g: c.g, b: c.b, count: c.count }))
      .sort((x, y) => y.count - x.count);
  }

  /* ---------------- 完整配色流程 ---------------- */
  /**
   * @param {Array<{r,g,b,count,lab}>} items 直方图
   * @param {Array} palette 拼豆色卡
   * @param {{maxColors:number, mergeDeltaE:number}} opt
   * @returns {Array<{code,name,hex,r,g,b,count}>} 按豆量降序
   */
  function buildFinalPalette(items, palette, opt) {
    const limit = Math.max(2, Math.min(opt.maxColors || palette.length, palette.length));
    const quant = quantize(items, limit);
    let snapped = snapToPalette(quant, palette);
    snapped = mergeSimilar(snapped, limit, opt.mergeDeltaE || 0);
    return snapped;
  }

  g.PBQuantize = {
    buildHistogram,
    medianCut,
    kmeans,
    quantize,
    snapToPalette,
    mergeSimilar,
    buildFinalPalette
  };
})(typeof window !== 'undefined' ? window : globalThis);

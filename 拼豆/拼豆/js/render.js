/* ============================================================
 * 拼豆工坊 · 渲染
 *  - drawPreview : 屏幕预览（彩色豆 / 图纸 / 彩色+编号）
 *  - sheetLayout : 导出图纸的排版计算（含按板分页、图例）
 *  - drawSheet   : 把图纸画到 canvas
 * ============================================================ */
(function (g) {
  'use strict';

  const C = g.PBColor;

  const FONT = '"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,-apple-system,sans-serif';
  const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace';

  /* 色号符号：字母(去掉易混 I/O/i/l/o) + 数字 + 希腊 + 图形 */
  const SYMBOLS = (
    'ABCDEFGHJKLMNPQRSTUVWXYZ' +
    'abcdefghjkmnpqrstuvwxyz' +
    '0123456789' +
    'αβγδεζηθικλμνξοπρστυφχψω' +
    '○●□■△▲▽▼◇◆★☆'
  ).split('');

  function symbolFor(i) {
    return i >= 0 && i < SYMBOLS.length ? SYMBOLS[i] : String(i + 1);
  }

  function labelOf(index, mode) {
    return mode === 'sym' ? symbolFor(index) : String(index + 1);
  }

  function fitFont(ctx, text, maxWidth, size, weight, family) {
    let fs = size;
    const build = () => (weight || '700') + ' ' + fs + 'px ' + (family || MONO);
    ctx.font = build();
    while (fs > 4 && ctx.measureText(text).width > maxWidth) {
      fs -= 1;
      ctx.font = build();
    }
    return fs;
  }

  /* ---------------- 网格绘制（预览与图纸共用） ---------------- */
  function drawGrid(ctx, pat, o) {
    const cell = o.cell;
    const ox = o.ox, oy = o.oy;
    const fromCol = o.fromCol || 0, fromRow = o.fromRow || 0;
    const toCol = o.toCol == null ? pat.cols : o.toCol;
    const toRow = o.toRow == null ? pat.rows : o.toRow;
    const mode = o.mode || 'beads';
    const numbers = o.numbers || 'none';
    const focus = o.focus == null ? -1 : o.focus;
    const hover = o.hover || null;
    const tint = !!o.tint;

    const chart = mode === 'chart';
    // 格子太小的时候字会糊成一团，干脆不画
    const drawText = numbers !== 'none' && cell >= 12;

    // 1) 底色块
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let r = 0; r < toRow - fromRow; r++) {
      const gy = fromRow + r;
      const y = oy + r * cell;
      for (let c = 0; c < toCol - fromCol; c++) {
        const gx = fromCol + c;
        const idx = pat.indices[gy * pat.cols + gx];
        const x = ox + c * cell;

        if (idx < 0) {
          if (chart) continue;
          ctx.fillStyle = '#F2F3F5';
          ctx.fillRect(x, y, cell, cell);
          continue;
        }
        const p = pat.palette[idx];
        const dim = focus >= 0 && idx !== focus;
        const hex = p.hex;

        if (chart) {
          ctx.fillStyle = tint ? hex : '#FFFFFF';
          ctx.fillRect(x, y, cell, cell);
          if (tint) {
            ctx.fillStyle = 'rgba(255,255,255,0.72)';
            ctx.fillRect(x, y, cell, cell);
          }
        } else {
          ctx.fillStyle = hex;
          ctx.fillRect(x, y, cell, cell);
          if (dim) {
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.fillRect(x, y, cell, cell);
          }
        }
      }
    }

    // 2) 色号 / 符号
    if (drawText) {
      const maxLabel = labelOf(pat.palette.length - 1, numbers);
      const fontSize = Math.max(5, Math.round(cell * (numbers === 'sym' ? 0.66 : 0.6)));
      const fs = fitFont(ctx, maxLabel, cell * 0.84, fontSize, '700', MONO);
      for (let r = 0; r < toRow - fromRow; r++) {
        const gy = fromRow + r;
        const y = oy + r * cell + cell / 2;
        for (let c = 0; c < toCol - fromCol; c++) {
          const gx = fromCol + c;
          const idx = pat.indices[gy * pat.cols + gx];
          if (idx < 0) continue;
          const x = ox + c * cell + cell / 2;
          const p = pat.palette[idx];
          const dim = focus >= 0 && idx !== focus;
          if (chart) ctx.fillStyle = dim ? '#B9BEC6' : '#141414';
          else if (dim) ctx.fillStyle = 'rgba(20,20,20,0.55)';
          else ctx.fillStyle = C.readableOn(p.r, p.g, p.b);
          ctx.font = '700 ' + fs + 'px ' + MONO;
          ctx.fillText(labelOf(idx, numbers), x, y + fs * 0.04);
        }
      }
    }

    // 3) 网格线
    if (o.grid !== false) {
      const w = (toCol - fromCol) * cell;
      const h = (toRow - fromRow) * cell;
      ctx.lineWidth = 1;
      ctx.strokeStyle = chart ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      for (let c = 0; c <= toCol - fromCol; c++) {
        const x = Math.round(ox + c * cell) + 0.5;
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + h);
      }
      for (let r = 0; r <= toRow - fromRow; r++) {
        const y = Math.round(oy + r * cell) + 0.5;
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + w, y);
      }
      ctx.stroke();
    }

    // 4) 每 N 格加粗（方便数格）
    const thick = o.thickEvery | 0;
    if (thick > 1) {
      ctx.strokeStyle = chart ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.42)';
      ctx.lineWidth = Math.max(1, cell > 20 ? 1.6 : 1.2);
      ctx.beginPath();
      for (let c = 0; c <= toCol - fromCol; c++) {
        const gx = fromCol + c;
        if (gx === 0 || gx === pat.cols || gx % thick !== 0) continue;
        const x = Math.round(ox + c * cell) + 0.5;
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + (toRow - fromRow) * cell);
      }
      for (let r = 0; r <= toRow - fromRow; r++) {
        const gy = fromRow + r;
        if (gy === 0 || gy === pat.rows || gy % thick !== 0) continue;
        const y = Math.round(oy + r * cell) + 0.5;
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + (toCol - fromCol) * cell, y);
      }
      ctx.stroke();
    }

    // 5) 拼豆板分界线
    const bc = o.boardCols | 0, br = o.boardRows | 0;
    if (bc > 1 || br > 1) {
      ctx.strokeStyle = 'rgba(20,60,140,0.85)';
      ctx.lineWidth = Math.max(1.4, cell > 20 ? 2.2 : 1.6);
      ctx.beginPath();
      if (bc > 1) {
        for (let c = 0; c <= toCol - fromCol; c++) {
          const gx = fromCol + c;
          if (gx === 0 || gx === pat.cols || gx % bc !== 0) continue;
          const x = Math.round(ox + c * cell) + 0.5;
          ctx.moveTo(x, oy);
          ctx.lineTo(x, oy + (toRow - fromRow) * cell);
        }
      }
      if (br > 1) {
        for (let r = 0; r <= toRow - fromRow; r++) {
          const gy = fromRow + r;
          if (gy === 0 || gy === pat.rows || gy % br !== 0) continue;
          const y = Math.round(oy + r * cell) + 0.5;
          ctx.moveTo(ox, y);
          ctx.lineTo(ox + (toCol - fromCol) * cell, y);
        }
      }
      ctx.stroke();
    }

    // 6) 鼠标悬停高亮
    if (hover && hover.c >= fromCol && hover.c < toCol && hover.r >= fromRow && hover.r < toRow) {
      const x = ox + (hover.c - fromCol) * cell;
      const y = oy + (hover.r - fromRow) * cell;
      ctx.strokeStyle = '#FF6B2C';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  }

  /* ---------------- 标尺 ---------------- */
  function drawRulers(ctx, o) {
    const cell = o.cell;
    const ox = o.ox, oy = o.oy;
    const fromCol = o.fromCol || 0, fromRow = o.fromRow || 0;
    const toCol = o.toCol == null ? o.cols : o.toCol;
    const toRow = o.toRow == null ? o.rows : o.toRow;
    const size = o.rulerSize;
    const step = o.rulerStep || 5;
    const fs = Math.max(7, Math.min(Math.round(size * 0.62), Math.round(cell * 0.72)));

    ctx.font = '600 ' + fs + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5A6270';

    for (let c = 0; c < toCol - fromCol; c++) {
      const g = fromCol + c;
      if (g !== 0 && g % step !== 0) continue;
      const x = ox + c * cell + cell / 2;
      ctx.fillText(String(g), x, oy - size / 2);
    }
    for (let r = 0; r < toRow - fromRow; r++) {
      const g = fromRow + r;
      if (g !== 0 && g % step !== 0) continue;
      const y = oy + r * cell + cell / 2;
      ctx.fillText(String(g), ox - size / 2, y);
    }
    // 角落刻度线
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= toCol - fromCol; c++) {
      const g = fromCol + c;
      if (g !== 0 && g % step !== 0) continue;
      const x = Math.round(ox + c * cell) + 0.5;
      ctx.moveTo(x, oy - size + 2);
      ctx.lineTo(x, oy - 2);
    }
    for (let r = 0; r <= toRow - fromRow; r++) {
      const g = fromRow + r;
      if (g !== 0 && g % step !== 0) continue;
      const y = Math.round(oy + r * cell) + 0.5;
      ctx.moveTo(ox - size + 2, y);
      ctx.lineTo(ox - 2, y);
    }
    ctx.stroke();
  }

  /* ---------------- 预览 ---------------- */
  function previewMetrics(pat, o) {
    const cell = o.cell;
    const ruler = o.rulers !== false;
    const rulerSize = ruler ? Math.max(16, Math.round(cell * 0.9)) : 0;
    return {
      cell,
      rulerSize,
      originX: rulerSize,
      originY: rulerSize,
      width: rulerSize + pat.cols * cell,
      height: rulerSize + pat.rows * cell
    };
  }

  function drawPreview(canvas, pat, o) {
    const m = previewMetrics(pat, o);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.max(1, Math.round(m.width * dpr));
    canvas.height = Math.max(1, Math.round(m.height * dpr));
    canvas.style.width = m.width + 'px';
    canvas.style.height = m.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, m.width, m.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, m.width, m.height);

    const gridOpt = {
      cell: m.cell,
      ox: m.originX,
      oy: m.originY,
      mode: o.mode,
      numbers: o.numbers,
      grid: o.grid,
      thickEvery: o.thickEvery,
      boardCols: o.boardCols,
      boardRows: o.boardRows,
      tint: o.tint,
      focus: o.focus,
      hover: o.hover
    };
    drawGrid(ctx, pat, gridOpt);
    if (o.rulers !== false) {
      drawRulers(ctx, {
        cell: m.cell, ox: m.originX, oy: m.originY,
        cols: pat.cols, rows: pat.rows,
        rulerSize: m.rulerSize, rulerStep: o.rulerStep
      });
    }
    return m;
  }

  /* ---------------- 图纸排版 ---------------- */
  function sheetLayout(pat, o) {
    o = o || {};
    const cell = o.cell || 26;
    const margin = o.margin != null ? o.margin : Math.round(cell * 1.2);
    const rulers = o.rulers !== false;
    const rulerSize = rulers ? Math.max(16, Math.round(cell * 0.8)) : 0;
    // 黑色外框：在格子四周额外留出一圈，避免压住最外一排格子
    const frameW = o.frame ? Math.max(2, Math.round(cell * 0.12)) : 0;
    const pad = frameW;
    const compact = o.legendStyle === 'compact';
    const split = !!o.split;
    const pageCols = split ? Math.max(4, o.pageCols | 0) : pat.cols;
    const pageRows = split ? Math.max(4, o.pageRows | 0) : pat.rows;
    const len = split ? (o.overlap | 0) : 0;

    // 分页时相邻页留一点重叠，贴豆时好对位
    const stepC = Math.max(1, pageCols - len);
    const stepR = Math.max(1, pageRows - len);

    const defs = [];
    if (split) {
      for (let r0 = 0; r0 < pat.rows; r0 += stepR) {
        for (let c0 = 0; c0 < pat.cols; c0 += stepC) {
          const cw = Math.min(pageCols, pat.cols - c0);
          const ch = Math.min(pageRows, pat.rows - r0);
          defs.push({ c0, r0, cw, ch });
          if (c0 + cw >= pat.cols) break;
        }
        if (r0 + pageRows >= pat.rows) break;
      }
    } else {
      defs.push({ c0: 0, r0: 0, cw: pat.cols, ch: pat.rows });
    }

    const total = defs.length;
    const visibleIdx = o.pageIndex == null ? defs.map((_, i) => i) : [Math.max(0, Math.min(total - 1, o.pageIndex))];

    // arrange: 'grid' = 按原图位置把各页拼回一张；'stack' = 一页接一页竖排
    const arrange = o.arrange === 'grid' ? 'grid' : 'stack';
    const gridCols = split ? Math.ceil(pat.cols / stepC) : 1;
    const gridRows = split ? Math.ceil(pat.rows / stepR) : 1;

    const labelH = split && arrange === 'stack' ? Math.round(cell * 1.0) : 0;
    const gap = Math.round(cell * 1.0);
    const titleH = o.title ? Math.round(cell * 1.6) : 0;

    // 先算出每页的尺寸（拼合模式下所有页按最大的那一页对齐）
    let maxW = 0, maxH = 0;
    const tiles = visibleIdx.map((di) => {
      const d = defs[di];
      const w = rulerSize + pad * 2 + d.cw * cell;
      const h = labelH + rulerSize + pad * 2 + d.ch * cell;
      maxW = Math.max(maxW, w);
      maxH = Math.max(maxH, h);
      return {
        index: di, of: total, c0: d.c0, r0: d.r0, cw: d.cw, ch: d.ch,
        w, h,
        pcol: split ? Math.round(d.c0 / stepC) : 0,
        prow: split ? Math.round(d.r0 / stepR) : 0
      };
    });

    const pages = [];
    const top = margin + titleH;
    let y = top;
    if (arrange === 'grid') {
      tiles.forEach((t) => {
        pages.push(Object.assign({}, t, {
          x: margin + t.pcol * maxW,
          y: top + t.prow * maxH
        }));
      });
      y = top + gridRows * maxH;
    } else {
      tiles.forEach((t) => {
        pages.push(Object.assign({}, t, { x: margin, y }));
        y += t.h + gap;
      });
      if (pages.length) y -= gap;
    }

    const legend = o.legend !== false && pat.palette.length > 0 &&
      (o.pageIndex == null || o.pageIndex === total - 1);
    const entryW = Math.round(cell * (compact ? 3.7 : 7.2));
    const entryH = Math.round(cell * (compact ? 1.05 : 1.15));
    const legendHeaderH = legend ? Math.round(cell * (compact ? 0.95 : 1.6)) : 0;

    const gridW = arrange === 'grid' ? gridCols * maxW : maxW;
    const contentW = Math.max(gridW, entryW * (compact ? 5 : 3));

    // 水平居中：拼合模式整体居中，竖排模式每页各自居中
    if (arrange === 'grid') {
      const dx = Math.round((contentW - gridW) / 2);
      pages.forEach((pg) => { pg.x += dx; });
    } else {
      pages.forEach((pg) => { pg.x = margin + Math.round((contentW - pg.w) / 2); });
    }

    const legCols = Math.max(1, Math.floor(contentW / entryW));
    const legRows = legend ? Math.ceil(pat.palette.length / legCols) : 0;
    const legendH = legend ? legendHeaderH + legRows * entryH : 0;
    const footerH = o.footer === false ? 0 : Math.round(cell * 1.8);

    const width = Math.round(margin * 2 + contentW);
    const height = Math.round(y + (legend ? gap + legendH : 0) + footerH + margin);

    return {
      width, height, cell, margin, rulerSize, frameW, compact, pages, contentW, maxW, maxH,
      arrange, labelH, gridCols, gridRows,
      legend, legCols, legRows, entryW, entryH, legendHeaderH,
      legendY: y + gap, footerH, totalPages: total
    };
  }

  /* ---------------- 图例 ---------------- */
  /** 简洁版：一行行「色块 + 编号 + 个数」，铺满整宽，放在图纸最下方 */
  function drawLegendCompact(ctx, pat, L, o) {
    const x0 = L.margin;
    const top = L.legendY;
    const hfs = Math.max(9, Math.round(L.cell * 0.38));
    const fs = Math.max(9, Math.round(L.cell * 0.44));

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    ctx.font = '600 ' + hfs + 'px ' + FONT;
    ctx.fillStyle = '#5A6270';
    ctx.fillText('颜色用量 · 共 ' + pat.palette.length + ' 色 · ' + pat.total + ' 颗', x0, top + hfs * 0.72);

    const y0 = top + L.legendHeaderH;
    for (let i = 0; i < pat.palette.length; i++) {
      const p = pat.palette[i];
      const col = i % L.legCols;
      const row = (i / L.legCols) | 0;
      const x = x0 + col * L.entryW;
      const cy = y0 + row * L.entryH + L.entryH / 2;

      const s = Math.round(L.entryH * 0.6);
      ctx.fillStyle = p.hex;
      ctx.fillRect(x, cy - s / 2, s, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, cy - s / 2 + 0.5, s - 1, s - 1);

      const tx = x + s + Math.max(5, L.cell * 0.22);
      const numTxt = labelOf(i, o.numbers);
      ctx.font = '700 ' + fs + 'px ' + MONO;
      ctx.fillStyle = '#111111';
      ctx.fillText(numTxt, tx, cy);
      const nw = ctx.measureText(numTxt).width;

      ctx.font = '600 ' + fs + 'px ' + MONO;
      ctx.fillStyle = '#39404A';
      ctx.fillText('×' + p.count, tx + nw + Math.max(4, L.cell * 0.16), cy);
    }
  }

  function drawLegend(ctx, pat, L, o) {
    if (L.compact) { drawLegendCompact(ctx, pat, L, o); return; }

    const x0 = L.margin;
    let y = L.legendY;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const hfs = Math.max(10, Math.round(L.cell * 0.46));
    ctx.font = '700 ' + hfs + 'px ' + FONT;
    ctx.fillStyle = '#141414';
    ctx.fillText('配色表 / Legend', x0, y + L.legendHeaderH * 0.4);

    const fs = Math.max(8, Math.round(L.cell * 0.34));
    y += L.legendHeaderH;

    for (let i = 0; i < pat.palette.length; i++) {
      const p = pat.palette[i];
      const col = i % L.legCols;
      const row = (i / L.legCols) | 0;
      const x = x0 + col * L.entryW;
      const ey = y + row * L.entryH;

      const s = Math.round(L.entryH * 0.58);
      const sy = ey + (L.entryH - s) / 2;

      ctx.fillStyle = p.hex;
      ctx.fillRect(x + 2, sy, s, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2.5, sy + 0.5, s - 1, s - 1);

      const tx = x + 2 + s + Math.max(6, L.cell * 0.3);
      ctx.fillStyle = '#141414';
      ctx.font = '700 ' + fs + 'px ' + MONO;
      const numTxt = labelOf(i, o.numbers);
      ctx.fillText(numTxt, tx, ey + L.entryH / 2);

      const numW = ctx.measureText(numTxt).width;
      ctx.font = '600 ' + fs + 'px ' + FONT;
      const codeTxt = p.name ? (p.code + ' ' + p.name) : p.code;
      const avail = L.entryW - (s + Math.max(6, L.cell * 0.3) + numW + Math.max(8, L.cell * 0.4) + 6);
      let label = codeTxt;
      if (ctx.measureText(label).width > avail) {
        while (label.length > 2 && ctx.measureText(label + '…').width > avail) label = label.slice(0, -1);
        label = label + '…';
      }
      ctx.fillStyle = '#39404A';
      ctx.fillText(label, tx + numW + Math.max(6, L.cell * 0.3), ey + L.entryH / 2);

      ctx.fillStyle = '#6B7280';
      ctx.textAlign = 'right';
      ctx.font = '600 ' + fs + 'px ' + MONO;
      ctx.fillText('×' + p.count, x + L.entryW - 6, ey + L.entryH / 2);
      ctx.textAlign = 'left';
    }
  }

  /* ---------------- 图纸 ---------------- */
  function drawSheet(canvas, pat, o) {
    o = o || {};
    const L = sheetLayout(pat, o);
    canvas.width = L.width;
    canvas.height = L.height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, L.width, L.height);

    // 外框
    if (!L.frameW) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, L.width - 1, L.height - 1);
    }

    // 标题
    if (o.title) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const tfs = Math.max(12, Math.round(L.cell * 0.62));
      ctx.font = '700 ' + tfs + 'px ' + FONT;
      ctx.fillStyle = '#141414';
      ctx.fillText(o.title, L.margin, L.margin + tfs * 0.55);
      if (o.subtitle) {
        const sfs = Math.max(9, Math.round(L.cell * 0.36));
        ctx.font = '500 ' + sfs + 'px ' + FONT;
        ctx.fillStyle = '#6B7280';
        ctx.fillText(o.subtitle, L.margin, L.margin + tfs * 0.55 + tfs * 0.95);
      }
    }

    // 各页
    L.pages.forEach((pg) => {
      const ox = pg.x + L.rulerSize + L.frameW;
      const oy = pg.y + L.labelH + L.rulerSize + L.frameW;

      if (L.labelH > 0 && pg.of > 1) {
        const lfs = Math.max(9, Math.round(L.cell * 0.42));
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '700 ' + lfs + 'px ' + FONT;
        ctx.fillStyle = '#141414';
        const label = '第 ' + (pg.index + 1) + '/' + pg.of + ' 页 · 列 ' + (pg.c0 + 1) + '–' + (pg.c0 + pg.cw) +
          ' · 行 ' + (pg.r0 + 1) + '–' + (pg.r0 + pg.ch);
        ctx.fillText(label, pg.x, pg.y + lfs * 0.7);
      }

      if (L.rulerSize > 0) {
        drawRulers(ctx, {
          cell: L.cell, ox, oy,
          fromCol: pg.c0, fromRow: pg.r0,
          toCol: pg.c0 + pg.cw, toRow: pg.r0 + pg.ch,
          cols: pat.cols, rows: pat.rows,
          rulerSize: L.rulerSize, rulerStep: o.rulerStep
        });
      }

      drawGrid(ctx, pat, {
        cell: L.cell, ox, oy,
        fromCol: pg.c0, fromRow: pg.r0,
        toCol: pg.c0 + pg.cw, toRow: pg.r0 + pg.ch,
        mode: o.mode || 'chart',
        numbers: o.numbers || 'num',
        grid: o.grid !== false,
        thickEvery: o.thickEvery,
        boardCols: o.boardCols,
        boardRows: o.boardRows,
        tint: o.tint
      });

      // 页面边框：简洁模式用黑色粗框，其它用细边框
      if (L.frameW) {
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = L.frameW;
        ctx.strokeRect(ox - L.frameW / 2, oy - L.frameW / 2,
          pg.cw * L.cell + L.frameW, pg.ch * L.cell + L.frameW);
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ox + 0.5, oy + 0.5, pg.cw * L.cell - 1, pg.ch * L.cell - 1);
      }
    });

    if (L.legend) drawLegend(ctx, pat, L, o);

    // 页脚
    if (L.footerH) {
      const ffs = Math.max(8, Math.round(L.cell * 0.32));
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '500 ' + ffs + 'px ' + FONT;
      ctx.fillStyle = '#8A919C';
      const fy = L.height - L.margin / 2 - ffs * 0.3;
      ctx.fillText(o.footerText || '', L.margin, fy);
      if (o.footerRight) {
        ctx.textAlign = 'right';
        ctx.fillText(o.footerRight, L.width - L.margin, fy);
      }
    }

    return L;
  }

  g.PBRender = {
    SYMBOLS,
    symbolFor,
    labelOf,
    drawPreview,
    previewMetrics,
    sheetLayout,
    drawSheet,
    drawGrid,
    drawLegend
  };
})(typeof window !== 'undefined' ? window : globalThis);

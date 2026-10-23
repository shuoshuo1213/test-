/* ============================================================
 * 核心算法自测（node tests/core.test.js）
 * 覆盖：颜色换算 / 色差 / 中位切分 / 相近色合并 / 像素化管线 / 图纸排版
 * ============================================================ */
'use strict';

const path = require('path');
const { makeCanvas } = require('./canvas-shim');

require(path.join(__dirname, '..', 'js', 'color.js'));
require(path.join(__dirname, '..', 'js', 'quantize.js'));
require(path.join(__dirname, '..', 'js', 'palettes.brands.js'));
require(path.join(__dirname, '..', 'js', 'palettes.js'));
require(path.join(__dirname, '..', 'js', 'bgremove.js'));
require(path.join(__dirname, '..', 'js', 'pattern.js'));
require(path.join(__dirname, '..', 'js', 'render.js'));

const C = globalThis.PBColor;
const Q = globalThis.PBQuantize;
const PAL = globalThis.PBPalettes;
const P = globalThis.PBPattern;
const R = globalThis.PBRender;
const Rm = globalThis.PBRemove;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name + ' (= ' + b + ')', a === b, 'got ' + a); }
function near(name, a, b, tol) { ok(name, Math.abs(a - b) <= tol, 'got ' + a + ' want ~' + b); }

function section(t) { console.log('\n' + t); }

/* ---------------- 颜色 ---------------- */
section('颜色基础');
{
  const white = C.rgbToLab(255, 255, 255);
  const black = C.rgbToLab(0, 0, 0);
  near('白色 L≈100', white.L, 100, 0.5);
  near('黑色 L≈0', black.L, 0, 0.5);
  near('白色 a≈0', white.a, 0, 0.2);

  const red = C.rgbToLab(255, 0, 0);
  const green = C.rgbToLab(0, 255, 0);
  ok('红绿 ΔE2000 > 60', C.deltaE2000(red, green) > 60, C.deltaE2000(red, green));
  eq('同色 ΔE2000 = 0', Math.round(C.deltaE2000(red, red)), 0);

  const rt = C.labToRgb(red.L, red.a, red.b);
  ok('Lab→RGB 回环（红）', rt.r > 250 && rt.g < 5 && rt.b < 5, JSON.stringify(rt));

  const h = C.hexToRgb('#F6F1E4');
  eq('HEX 解析', h.r + ',' + h.g + ',' + h.b, '246,241,228');
  eq('HEX 生成', C.rgbToHex(246, 241, 228), '#F6F1E4');
  eq('读白色上的字用深色', C.readableOn(255, 255, 255), '#141414');
  eq('读黑色上的字用浅色', C.readableOn(0, 0, 0), '#FFFFFF');

  // 相近但不同的两个粉色，ΔE2000 应该很小
  const p1 = C.rgbToLab(255, 205, 221);
  const p2 = C.rgbToLab(250, 199, 215);
  ok('相近粉 ΔE2000 < 3', C.deltaE2000(p1, p2) < 3, C.deltaE2000(p1, p2));
}

/* ---------------- 色卡 ---------------- */
section('色卡');
{
  eq('通用色卡 84 色', PAL.UNIVERSAL.length, 84);
  eq('新手色卡 48 色', PAL.STARTER.length, 48);
  eq('柔和色卡 36 色', PAL.SOFT.length, 36);

  const hexes = new Set(PAL.UNIVERSAL.map((c) => c.hex));
  eq('通用色卡无重复颜色', hexes.size, 84);

  const csv = PAL.parseCsv('色号,名称,颜色\nA1,纯白,#FFFFFF\nA2,米白,#F6F1E4\n');
  eq('CSV 解析条数', csv.length, 2);
  eq('CSV 解析色号', csv[0].code, 'A1');

  const norm = PAL.normalize(csv, '测试');
  eq('归一化', norm.colors.length, 2);
  eq('归一化 name', norm.name, '测试');
}

/* ---------------- 品牌色卡 ---------------- */
section('品牌色卡');
{
  ok('已加载品牌色卡数据', PAL.isBrandData);
  eq('色卡套数', PAL.SETS.length, 9);

  const byId = (id) => PAL.SETS.filter((s) => s.id === id)[0];
  eq('MARD 221 色数', byId('mard221').colors.length, 221);
  eq('MARD 291 色数', byId('mard291').colors.length, 291);
  eq('Artkal C197 色数', byId('artkal197').colors.length, 197);
  eq('Artkal 418 色数', byId('artkal418').colors.length, 418);
  eq('COCO 291 色数', byId('coco291').colors.length, 291);
  eq('漫漫 278 色数', byId('manman278').colors.length, 278);

  eq('MARD 首个色号', byId('mard221').colors[0].code, 'A1');
  eq('MARD 首个色值', byId('mard221').colors[0].hex, '#FAF5CD');

  ok('每套色卡色号唯一', PAL.SETS.every((s) => new Set(s.colors.map((c) => c.code)).size === s.colors.length));
  ok('每套色卡 HEX 合法', PAL.SETS.every((s) => s.colors.every((c) => /^#[0-9A-F]{6}$/.test(c.hex))));
  ok('每套色卡都有 RGB', PAL.SETS.every((s) => s.colors.every((c) => typeof c.r === 'number' && c.r >= 0 && c.r <= 255)));
  ok('每套色卡都有名称', PAL.SETS.every((s) => typeof s.name === 'string' && s.name.length >= 2));

  // 用 MARD 色卡生成图纸：色号必须全部落在 MARD 体系内
  const mard = byId('mard221');
  const W2 = 40, H2 = 40;
  const data2 = new Uint8ClampedArray(W2 * H2 * 4);
  for (let i = 0; i < W2 * H2; i++) {
    const o = i * 4;
    data2[o] = (i * 37) % 256;
    data2[o + 1] = (i * 91) % 256;
    data2[o + 2] = (i * 13) % 256;
    data2[o + 3] = 255;
  }
  const mardPat = P.buildPattern({
    source: { data: data2, width: W2, height: H2 },
    cols: 20, rows: 20, palette: mard.colors,
    maxColors: 8, mergeDeltaE: 4, dither: 0, background: 'white'
  });
  ok('MARD 图纸色号都在 MARD 色卡内', mardPat.palette.every((p) => mard.colors.some((c) => c.code === p.code)));
  ok('MARD 图纸颜色数不超上限', mardPat.palette.length <= 8, mardPat.palette.length);
  eq('MARD 图纸豆量守恒', mardPat.palette.reduce((s, p) => s + p.count, 0), 400);
}

/* ---------------- 量化 ---------------- */
section('量化');
{
  // 四种颜色的直方图
  const items = Q.buildHistogram(new Int32Array([
    0xFF0000, 0xFF0000, 0xFF0000,
    0x00FF00, 0x00FF00,
    0x0000FF,
    0xFFFFFF, 0xFFFFFF, 0xFFFFFF, 0xFFFFFF
  ]));
  eq('直方图去重', items.length, 4);
  eq('直方图计数', items.find((i) => i.r === 255 && i.g === 255 && i.b === 255).count, 4);

  const q4 = Q.quantize(items, 4);
  eq('量化到 4 色', q4.length, 4);
  const q2 = Q.quantize(items, 2);
  ok('量化到 2 色', q2.length <= 2, q2.length);
  const wsum = q2.reduce((s, c) => s + c.count, 0);
  eq('量化保持总权重', wsum, 10);

  // 合并：两张非常接近的豆色 + 一张反差色
  const list = [
    { code: 'A', name: 'a', hex: '#FFCCDD', r: 255, g: 204, b: 221, count: 10 },
    { code: 'B', name: 'b', hex: '#FAC7D7', r: 250, g: 199, b: 215, count: 6 },
    { code: 'C', name: 'c', hex: '#112233', r: 17, g: 34, b: 51, count: 4 }
  ];
  const merged = Q.mergeSimilar(list, 84, 4);
  eq('相近色合并后剩 2 色', merged.length, 2);
  eq('合并后豆量守恒', merged.reduce((s, c) => s + c.count, 0), 20);
  eq('保留豆量多的颜色', merged[0].code, 'A');

  const forced = Q.mergeSimilar(list, 1, 0);
  eq('强制压到 1 色', forced.length, 1);
  eq('压到 1 色豆量守恒', forced[0].count, 20);
}

/* ---------------- 像素化 + 映射 ---------------- */
section('像素化与色卡映射');
{
  // 100×100 四象限：红 / 绿 / 蓝 / 白
  const W = 100, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const left = x < 50, top = y < 50;
      if (top && left) { data[o] = 255; data[o + 1] = 0; data[o + 2] = 0; }
      else if (top && !left) { data[o] = 0; data[o + 1] = 200; data[o + 2] = 0; }
      else if (!top && left) { data[o] = 0; data[o + 1] = 0; data[o + 2] = 255; }
      else { data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; }
      data[o + 3] = 255;
    }
  }

  // 面积平均：10×10 网格，每格对应 10×10 像素，颜色应该很纯
  const cells = P.areaResample(data, W, H, 10, 10);
  eq('降采样格数', cells.r.length, 100);
  eq('左上角为红', Math.round(cells.r[0]) + ',' + Math.round(cells.g[0]) + ',' + Math.round(cells.b[0]), '255,0,0');
  eq('右下角为白', Math.round(cells.r[99]) + ',' + Math.round(cells.g[99]) + ',' + Math.round(cells.b[99]), '255,255,255');

  const pat = P.buildPattern({
    source: { data, width: W, height: H },
    cols: 10, rows: 10,
    palette: PAL.UNIVERSAL,
    maxColors: 8,
    mergeDeltaE: 0,
    dither: 0,
    background: 'white',
    adjust: { brightness: 0, contrast: 0, saturation: 0 }
  });
  eq('图纸列数', pat.cols, 10);
  eq('图纸总豆数', pat.total, 100);
  eq('四种颜色', pat.palette.length, 4);
  eq('豆量统计守恒', pat.palette.reduce((s, p) => s + p.count, 0), 100);
  ok('颜色按豆量降序', pat.palette.every((p, i, arr) => i === 0 || arr[i - 1].count >= p.count));
  ok('索引都在范围内', Array.from(pat.indices).every((v) => v >= 0 && v < pat.palette.length));
  ok('每颗豆都在色卡里', pat.palette.every((p) => PAL.UNIVERSAL.some((u) => u.code === p.code)));
  ok('红色映射到红系', (() => {
    const idx = pat.indices[0];
    const p = pat.palette[idx];
    return p.r > 180 && p.g < 90 && p.b < 90;
  })(), JSON.stringify(pat.palette[pat.indices[0]]));

  // 颜色数上限
  const limited = P.buildPattern({
    source: { data, width: W, height: H },
    cols: 10, rows: 10,
    palette: PAL.SOFT,
    maxColors: 2,
    mergeDeltaE: 0,
    dither: 0,
    background: 'white'
  });
  ok('颜色数不超过上限', limited.palette.length <= 2, limited.palette.length);
  eq('限制色数后豆量守恒', limited.total, 100);

  // 抖动
  const dithered = P.buildPattern({
    source: { data, width: W, height: H },
    cols: 24, rows: 24,
    palette: PAL.UNIVERSAL,
    maxColors: 4,
    mergeDeltaE: 0,
    dither: 2,
    background: 'white'
  });
  ok('抖动后索引合法', Array.from(dithered.indices).every((v) => v >= 0 && v < dithered.palette.length));
  eq('抖动后总豆数', dithered.total, 24 * 24);

  // 透明留空
  const trans = new Uint8ClampedArray(20 * 20 * 4);
  for (let i = 0; i < 20 * 20; i++) {
    const o = i * 4;
    const left = (i % 20) < 10;
    trans[o] = 200; trans[o + 1] = 60; trans[o + 2] = 60; trans[o + 3] = left ? 255 : 0;
  }
  const holey = P.buildPattern({
    source: { data: trans, width: 20, height: 20 },
    cols: 10, rows: 10,
    palette: PAL.UNIVERSAL,
    maxColors: 4, mergeDeltaE: 0, dither: 0,
    background: 'none'
  });
  ok('透明区域留空', holey.total > 0 && holey.total < 100, JSON.stringify({ total: holey.total, empty: holey.empty }));
  eq('豆数 + 空格 = 总格子', holey.total + holey.empty, 100);
}

/* ---------------- 去背景 ---------------- */
section('去背景（本地算法）');
{
  // 120×120 白底 + 正中红圆
  const W3 = 120, H3 = 120;
  const img = { width: W3, height: H3, data: new Uint8ClampedArray(W3 * H3 * 4) };
  for (let y = 0; y < H3; y++) {
    for (let x = 0; x < W3; x++) {
      const o = (y * W3 + x) * 4;
      const dx = x - 60, dy = y - 60;
      const inside = dx * dx + dy * dy <= 30 * 30;
      img.data[o] = inside ? 220 : 250;
      img.data[o + 1] = inside ? 40 : 250;
      img.data[o + 2] = inside ? 40 : 250;
      img.data[o + 3] = 255;
    }
  }

  const res = Rm.local(img, { tolerance: 40, keepLargest: true });
  eq('掩膜像素数', res.mask.length, W3 * H3);
  eq('角落被去掉', res.mask[0], 0);
  eq('中心主体保留', res.mask[60 * W3 + 60], 255);
  ok('去掉比例合理', res.ratio > 0.6 && res.ratio < 0.98, res.ratio.toFixed(3));

  const strict = Rm.local(img, { tolerance: 0, keepLargest: true });
  eq('强度 0 也能去掉纯白背景', strict.mask[0], 0);
  ok('强度低时保留得更多或持平', strict.ratio <= res.ratio + 0.02, strict.ratio.toFixed(3));

  // 两个色块：只保留最大主体
  const W4 = 60, H4 = 60;
  const img2 = { width: W4, height: H4, data: new Uint8ClampedArray(W4 * H4 * 4) };
  for (let i = 0; i < W4 * H4; i++) {
    const o = i * 4;
    img2.data[o] = 250; img2.data[o + 1] = 250; img2.data[o + 2] = 250; img2.data[o + 3] = 255;
  }
  const paint = (cx, cy, r) => {
    for (let y = 0; y < H4; y++) {
      for (let x = 0; x < W4; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const o = (y * W4 + x) * 4;
        img2.data[o] = 220; img2.data[o + 1] = 40; img2.data[o + 2] = 40;
      }
    }
  };
  paint(18, 18, 9);
  paint(45, 45, 4);

  const two = Rm.local(img2, { tolerance: 40, keepLargest: true });
  eq('最小的碎块被去掉', two.mask[45 * W4 + 45], 0);
  eq('最大主体保留', two.mask[18 * W4 + 18], 255);

  const both = Rm.local(img2, { tolerance: 40, keepLargest: false });
  eq('关掉「只保留主体」后两块都在', both.mask[45 * W4 + 45], 255);

  // 羽化：边界出现过渡值
  const fm = Rm.feather(Uint8Array.from([0, 0, 255, 255]), 4, 1, 1);
  eq('羽化左边界', fm[0], 0);
  eq('羽化过渡 1', fm[1], 85);
  eq('羽化过渡 2', fm[2], 170);
  eq('羽化内部', fm[3], 255);

  // 接进生成管线：背景变空格
  const masked = new Uint8ClampedArray(img.data);
  for (let i = 0; i < W3 * H3; i++) masked[i * 4 + 3] = res.mask[i];
  const patBg = P.buildPattern({
    source: { data: masked, width: W3, height: H3 },
    cols: 20, rows: 20,
    palette: PAL.SETS[0].colors,
    maxColors: 8, mergeDeltaE: 4, dither: 0,
    background: 'none'
  });
  eq('左上角背景格为空', patBg.indices[0], -1);
  ok('主体仍有豆', patBg.total > 0, patBg.total);
  ok('空格数量可观', patBg.empty > 0, patBg.empty);
}

/* ---------------- 渲染 ---------------- */
section('渲染与排版');
{
  const W = 64, H = 64;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const x = i % W, y = (i / W) | 0;
    data[o] = 60 + (x / W) * 190;
    data[o + 1] = 100 + (y / H) * 120;
    data[o + 2] = 200;
    data[o + 3] = 255;
  }
  const pat = P.buildPattern({
    source: { data, width: W, height: H },
    cols: 58, rows: 58,
    palette: PAL.UNIVERSAL, maxColors: 16, mergeDeltaE: 4, dither: 0, background: 'white'
  });

  const canvas = makeCanvas();
  const m = R.drawPreview(canvas, pat, { cell: 8, mode: 'beads', numbers: 'none', grid: true, rulers: true, thickEvery: 5 });
  ok('预览尺寸合理', m.width > 58 * 8 && m.height > 0, JSON.stringify(m));
  ok('预览画了格子', canvas.getContext().calls.fillRect >= 58 * 58);

  const sheet = makeCanvas();
  const L = R.drawSheet(sheet, pat, {
    cell: 26, mode: 'chart', numbers: 'num',
    split: true, pageCols: 29, pageRows: 29, overlap: 1,
    legend: true, title: '测试图纸', subtitle: '测试'
  });
  ok('图纸宽高 > 0', L.width > 0 && L.height > 0, L.width + 'x' + L.height);
  ok('分页数量 >= 4', L.totalPages >= 4, L.totalPages);
  eq('canvas 尺寸与排版一致', sheet.width === L.width && sheet.height === L.height, true);
  ok('画了标题文字', sheet.getContext().calls.fillText > 0);

  const page0 = R.sheetLayout(pat, { cell: 26, split: true, pageCols: 29, pageRows: 29, overlap: 1, legend: true });
  const single = R.sheetLayout(pat, {
    cell: 26, split: true, pageCols: 29, pageRows: 29, overlap: 1,
    legend: true, pageIndex: 0
  });
  eq('单页排版只有 1 页', single.pages.length, 1);
  eq('非末页不带图例', single.legend, false);
  eq('总页数一致', single.totalPages, page0.totalPages);

  const last = R.sheetLayout(pat, {
    cell: 26, split: true, pageCols: 29, pageRows: 29, overlap: 1,
    legend: true, pageIndex: page0.totalPages - 1
  });
  eq('末页带图例', last.legend, true);

  const noSplit = R.sheetLayout(pat, { cell: 20, split: false, legend: false });
  eq('不分页只有 1 页', noSplit.totalPages, 1);
  eq('不分页不带图例', noSplit.legend, false);

  const symSheet = makeCanvas();
  const L2 = R.drawSheet(symSheet, pat, { cell: 30, mode: 'beads', numbers: 'sym', legend: true, split: false });
  ok('符号模式出图', L2.width > 0);
  ok('符号数量够用', R.SYMBOLS.length >= 84, R.SYMBOLS.length);
  eq('符号唯一', new Set(R.SYMBOLS).size, R.SYMBOLS.length);

  /* --- 图纸上的文字内容 --- */
  const opts = { cell: 26, mode: 'chart', numbers: 'num', split: true, pageCols: 29, pageRows: 29, overlap: 0, legend: true };
  const firstCanvas = makeCanvas();
  const firstL = R.drawSheet(firstCanvas, pat, Object.assign({}, opts, { pageIndex: 0, title: '拼豆图纸' }));
  const firstTexts = firstCanvas.getContext().texts.map((t) => t.text);
  eq('第 1 页共 4 页', firstL.totalPages, 4);
  ok('第 1 页标签正确', firstTexts.some((t) => t.indexOf('第 1/4 页') === 0), firstTexts.slice(0, 5).join(' | '));
  ok('第 1 页不画配色表', !firstTexts.includes('配色表 / Legend'));
  ok('画了标题', firstTexts.indexOf('拼豆图纸') >= 0);
  ok('画了格子编号', firstTexts.filter((t) => t === '1').length > 10, firstTexts.filter((t) => t === '1').length);

  const lastCanvas = makeCanvas();
  R.drawSheet(lastCanvas, pat, Object.assign({}, opts, { pageIndex: firstL.totalPages - 1 }));
  const lastTexts = lastCanvas.getContext().texts.map((t) => t.text);
  ok('末页带配色表', lastTexts.includes('配色表 / Legend'));
  ok('配色表列出色号', lastTexts.some((t) => /^[A-Z]{2}-\d{2}\s/.test(t)), lastTexts.filter((t) => /^[A-Z]{2}/.test(t)).slice(0, 3).join(','));
  ok('配色表列出用量', lastTexts.some((t) => t.indexOf('×') === 0), lastTexts.filter((t) => t.charAt(0) === '×').slice(0, 3).join(','));

  /* --- 简洁数字表：黑框 + 底部用量 --- */
  const plainOpts = {
    cell: 26, mode: 'chart', numbers: 'num',
    frame: true, legendStyle: 'compact', rulers: false,
    legend: true, split: false, footer: false, margin: 18
  };
  const plainCanvas = makeCanvas();
  const plainL = R.drawSheet(plainCanvas, pat, plainOpts);
  const plainTexts = plainCanvas.getContext().texts.map((t) => t.text);
  eq('简洁样式没有刻度', plainL.rulerSize, 0);
  ok('简洁样式没有标题', !plainTexts.some((t) => t.indexOf('拼豆图纸') === 0));
  ok('简洁样式有黑色外框', plainL.frameW >= 2 && plainCanvas.getContext().calls.strokeRect > 0, plainL.frameW);
  ok('底部列出每种编号的用量', plainTexts.some((t) => /^×\d+$/.test(t)), plainTexts.filter((t) => t.charAt(0) === '×').slice(0, 3).join(','));
  eq('用量条数 = 颜色数', plainTexts.filter((t) => /^×\d+$/.test(t)).length, pat.palette.length);
  ok('格子编号是纯数字', plainTexts.includes('1'));

  const withFrame = R.sheetLayout(pat, { cell: 26, frame: true, rulers: false, legend: false, split: false, margin: 18 });
  const noFrame = R.sheetLayout(pat, { cell: 26, frame: false, rulers: false, legend: false, split: false, margin: 18 });
  eq('黑框在最外圈多留出边距', withFrame.width - noFrame.width, withFrame.frameW * 2);

  /* --- 分页后按原图位置拼成一张 --- */
  const gridOpts = {
    cell: 26, mode: 'chart', numbers: 'num',
    split: true, arrange: 'grid', pageCols: 29, pageRows: 29, overlap: 0,
    frame: true, legendStyle: 'compact', rulers: false, footer: false, margin: 18, legend: true
  };
  const G = R.sheetLayout(pat, gridOpts);
  eq('58×58 分页得到 4 页', G.totalPages, 4);
  eq('拼合为 2 列', G.gridCols, 2);
  eq('拼合为 2 行', G.gridRows, 2);
  eq('第 2 页紧贴第 1 页右侧', G.pages[1].x - G.pages[0].x, G.maxW);
  eq('第 3 页在第 1 页正下方', G.pages[2].y - G.pages[0].y, G.maxH);
  ok('第 4 页在右下角', G.pages[3].x > G.pages[0].x && G.pages[3].y > G.pages[0].y);
  ok('拼合图宽度≈两页', Math.abs(G.width - (G.margin * 2 + 2 * G.maxW)) <= 2, G.width);
  ok('拼合后是 2×2 的方块图', Math.abs(G.width - G.height) < G.maxH, G.width + 'x' + G.height);

  const gridCanvas = makeCanvas();
  const GL = R.drawSheet(gridCanvas, pat, gridOpts);
  const gridTexts = gridCanvas.getContext().texts.map((t) => t.text);
  ok('拼合模式不画分页标签', !gridTexts.some((t) => t.indexOf('第 1/4 页') === 0));
  ok('拼合模式仍有黑框', GL.frameW >= 2 && gridCanvas.getContext().calls.strokeRect >= 4);
  eq('拼合模式用量表只画一次', gridTexts.filter((t) => t === '×' + pat.palette[0].count).length, 1);

  const S = R.sheetLayout(pat, Object.assign({}, gridOpts, { arrange: 'stack' }));
  ok('竖排图比拼合图更高', S.height > G.height, S.height + ' vs ' + G.height);
  eq('竖排仍然是 4 页', S.totalPages, 4);
  ok('竖排每页有标签预留高度', S.labelH > 0 && G.labelH === 0);

  /* --- 小格子不画数字（避免糊成一团） --- */
  const small = makeCanvas();
  R.drawPreview(small, pat, { cell: 8, mode: 'chart', numbers: 'num', grid: true, rulers: true });
  const smallTexts = small.getContext().calls.fillText;
  const big = makeCanvas();
  R.drawPreview(big, pat, { cell: 20, mode: 'chart', numbers: 'num', grid: true, rulers: true });
  const bigTexts = big.getContext().calls.fillText;
  ok('格子小的时候省略编号', smallTexts < 100, smallTexts);
  ok('格子够大时画满编号', bigTexts > 58 * 58, bigTexts);
}

/* ---------------- 结果 ---------------- */
console.log('\n' + '─'.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

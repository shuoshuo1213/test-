/* ============================================================
 * 拼豆工坊 · 应用逻辑
 * 图片 → 像素化 → 相近色合并 → 色卡映射 → 图纸
 * ============================================================ */
(function () {
  'use strict';

  const C = window.PBColor;
  const P = window.PBPattern;
  const R = window.PBRender;
  const PAL = window.PBPalettes;
  const EX = window.PBExport;
  const RM = window.PBRemove;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const SETTINGS_KEY = 'pbg.settings.v2';
  const BOARD_FOR_BEAD = { '2.6': 50, '5': 29, '10': 14 };

  const DEFAULTS = {
    cols: 58,
    rows: 58,
    lockAspect: true,
    paletteId: 'mard221',
    maxColors: 16,
    mergeDeltaE: 4,
    dither: 0,
    background: 'white',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    mode: 'beads',
    numbers: 'num',
    grid: true,
    thick: true,
    board: false,
    ruler: true,
    zoom: 0,
    beadSize: '5',
    boardCols: 29,
    boardRows: 29,
    uiMode: 'simple',
    replaceMap: {},
    removeBg: false,
    bgMethod: 'local',
    bgTolerance: 40,
    bgKeepLargest: true,
    bgUrl: 'http://127.0.0.1:7000',
    sheet: {
      cell: 26,
      style: 'plain',
      follow: true,
      numbers: 'num',
      thick: false,
      split: false,
      arrange: 'grid',
      pageCols: 29,
      pageRows: 29,
      overlap: 0,
      legend: true,
      tint: false
    }
  };

  let settings = JSON.parse(JSON.stringify(DEFAULTS));

  const state = {
    source: null,      // {data, width, height}
    sourceCanvas: null,
    raw: null,         // 原图 RGBA（不被去背景修改）
    mask: null,        // 去背景掩膜，255=保留
    maskKey: '',
    sourceId: 0,
    aspect: 1,
    pattern: null,
    metrics: null,
    hover: null,
    focus: -1,
    imgName: '',
    palette: null
  };

  /* ---------------- 小工具 ---------------- */
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms || 2200);
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments, self = this;
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  }

  function fmt(n) {
    return Number(n).toLocaleString('en-US');
  }

  /* ---------------- 设置持久化 ---------------- */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        const rawSheet = obj.sheet || {};
        const sheet = Object.assign({}, DEFAULTS.sheet, rawSheet);
        // 旧版本用 sheet.mode，迁移到 sheet.style
        if (rawSheet.style == null) {
          sheet.style = ['beads', 'colorNum', 'chart'].indexOf(rawSheet.mode) >= 0 ? rawSheet.mode : 'plain';
        }
        settings = Object.assign({}, DEFAULTS, obj, { sheet });
      }
    } catch (e) { /* ignore */ }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
    noteHistory();
  }

  /* ---------------- 色卡 ---------------- */
  function allPalettes() {
    return PAL.SETS.concat(PAL.loadCustom());
  }

  function currentPalette() {
    const list = allPalettes();
    return list.find((p) => p.id === settings.paletteId) || list[0];
  }

  function populatePalettes() {
    const sel = $('selPalette');
    sel.innerHTML = '';
    const builtin = PAL.SETS;
    const custom = PAL.loadCustom();

    const g1 = document.createElement('optgroup');
    g1.label = PAL.isBrandData ? '品牌色卡' : '内置色卡';
    builtin.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + '（' + p.colors.length + ' 色）';
      if (p.desc) o.title = p.desc;
      g1.appendChild(o);
    });
    sel.appendChild(g1);

    if (custom.length) {
      const g2 = document.createElement('optgroup');
      g2.label = '我的色卡';
      custom.forEach((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name + '（' + p.colors.length + ' 色）';
        g2.appendChild(o);
      });
      sel.appendChild(g2);
    }

    const list = allPalettes();
    if (!list.some((p) => p.id === settings.paletteId)) settings.paletteId = list[0].id;
    sel.value = settings.paletteId;
    state.palette = currentPalette();
  }

  function syncColorLimit() {
    const pal = currentPalette();
    const max = pal.colors.length;
    const el = $('colorsRange');
    el.max = String(max);
    if (settings.maxColors > max) settings.maxColors = max;
    if (settings.maxColors < 2) settings.maxColors = 2;
    el.value = String(settings.maxColors);
    const numEl = $('colorsNum');
    if (numEl) {
      numEl.max = String(max);
      numEl.min = '2';
      setNum('colorsNum', settings.maxColors);
    }
  }

  /* ---------------- 图片载入 ---------------- */
  const MAX_SRC = 1800;

  function makeThumb(canvas) {
    const size = 136;
    const t = document.createElement('canvas');
    t.width = size;
    t.height = size;
    const ctx = t.getContext('2d');
    const scale = Math.max(size / canvas.width, size / canvas.height);
    const w = canvas.width * scale, h = canvas.height * scale;
    ctx.drawImage(canvas, (size - w) / 2, (size - h) / 2, w, h);
    return t.toDataURL('image/png');
  }

  function setSource(drawable, name) {
    const w = drawable.width || drawable.naturalWidth || 0;
    const h = drawable.height || drawable.naturalHeight || 0;
    if (!w || !h) { toast('这张图片读不出来'); return; }

    const scale = Math.min(1, MAX_SRC / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(drawable, 0, 0, sw, sh);

    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, sw, sh);
    } catch (e) {
      toast('浏览器禁止读取这张图的像素：请用本地服务器打开页面（见 README）', 6000);
      return;
    }

    state.raw = imgData.data;
    state.source = { data: state.raw, width: sw, height: sh };
    state.sourceCanvas = canvas;
    state.sourceId = (state.sourceId || 0) + 1;
    state.mask = null;
    state.maskKey = '';
    state.aspect = sw / sh;
    state.imgName = name || '未命名图片';

    const thumb = $('imgThumb');
    thumb.style.backgroundImage = 'url(' + makeThumb(canvas) + ')';
    thumb.classList.add('has-img');
    thumb.innerHTML = '';
    $('imgName').textContent = state.imgName;
    $('imgInfo').textContent = w + ' × ' + h + ' px' + (scale < 1 ? '（已缩放到 ' + sw + ' × ' + sh + ' 计算）' : '');

    $('emptyState').classList.add('hidden');
    $('preview').classList.remove('hidden');

    if (settings.lockAspect) {
      settings.rows = Math.max(2, Math.round(settings.cols / state.aspect));
      $('rowsRange').value = String(clamp(settings.rows, 8, 200));
    }
    // 第一次导入时提醒可以换品牌
    if (!settings.paletteAsked) {
      settings.paletteAsked = true;
      saveSettings();
      setTimeout(() => toast('提示：在「用几种颜色」里可以选你买的豆子品牌，默认 MARD 221', 4200), 900);
    }
    updateAdvice();
    updateMask();
  }

  /* ---------------- 去背景 ---------------- */
  function setStageBusy(on, msg) {
    const stage = document.querySelector('.stage');
    if (stage) stage.classList.toggle('busy', !!on);
    if (on) {
      $('stagePill').textContent = msg || '处理中…';
      $('perfInfo').textContent = '';
    }
  }

  /** 把掩膜乘进原图 alpha，得到下游要用的像素 */
  function applyMask() {
    const src = state.source;
    if (!src) return;
    if (!state.mask) { src.data = state.raw; return; }
    const n = src.width * src.height;
    const raw = state.raw;
    const m = state.mask;
    const out = new Uint8ClampedArray(raw.length);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      out[o] = raw[o];
      out[o + 1] = raw[o + 1];
      out[o + 2] = raw[o + 2];
      out[o + 3] = (raw[o + 3] * m[i]) / 255;
    }
    src.data = out;
  }

  let maskSeq = 0;

  /** 计算（或复用）掩膜，然后重算图纸 */
  async function updateMask() {
    const src = state.source;
    if (!src || !state.raw) return;
    const s = settings;
    const seq = ++maskSeq;

    if (!s.removeBg || !RM) {
      state.mask = null;
      state.maskKey = '';
      src.data = state.raw;
      rebuild();
      return;
    }

    const key = [s.bgMethod, s.bgTolerance, s.bgKeepLargest ? 1 : 0, state.sourceId].join('|');
    if (state.mask && state.maskKey === key) {
      applyMask();
      rebuild();
      return;
    }

    setStageBusy(true, s.bgMethod === 'rembg' ? '正在用 rembg 抠图…' : '正在去背景…');
    try {
      let res;
      if (s.bgMethod === 'rembg') {
        res = await RM.rembg(state.sourceCanvas, s.bgUrl, 90000);
      } else {
        res = RM.local(
          { data: state.raw, width: src.width, height: src.height },
          { tolerance: s.bgTolerance, keepLargest: s.bgKeepLargest }
        );
      }
      if (seq !== maskSeq) return;

      state.mask = res.mask;
      state.maskKey = key;
      applyMask();
      rebuild();
      if (res.ratio > 0.94) {
        toast('抠掉了 ' + Math.round(res.ratio * 100) + '% 的画面，可能抠过头了，把「去背景强度」调小试试', 3600);
      } else if (res.ratio < 0.02) {
        toast('几乎没抠掉东西：背景可能太花，试试调大强度或改用 rembg 服务', 3600);
      }
    } catch (e) {
      console.error(e);
      if (seq !== maskSeq) return;
      toast('去背景失败：' + e.message, 6000);
      settings.removeBg = false;
      $('chkRemoveBg').checked = false;
      $('bgOpts').hidden = true;
      state.mask = null;
      state.maskKey = '';
      src.data = state.raw;
      rebuild();
    } finally {
      if (seq === maskSeq) setStageBusy(false);
    }
  }

  const scheduleMask = debounce(function () {
    updateMask();
  }, 320);

  /** 面板联动：只有本地算法才显示强度/只保留主体，rembg 才显示地址 */
  function syncBgUI() {
    const on = !!settings.removeBg;
    $('chkRemoveBg').checked = on;
    $('bgOpts').hidden = !on;
    const local = settings.bgMethod !== 'rembg';
    $('bgTolField').hidden = !local;
    $('bgKeepLargestRow').hidden = !local;
    $('bgUrlField').hidden = local;
    $('bgHint').textContent = local
      ? '离线算法：从四边往里“吃掉”与背景色相近的区域，适合白底 / 纯色 / 简单渐变；背景越花越不准。'
      : '需要先在本机启动服务：pip install rembg fastapi uvicorn python-multipart，然后 python tools/rembg_server.py（首次会下载模型）。抠图在你的电脑上完成，图片不上传。';
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
      toast('请选择图片文件');
      return;
    }
    try {
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(file);
        setSource(bmp, file.name);
        if (bmp.close) bmp.close();
        return;
      }
    } catch (e) { /* 回退到 Image */ }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setSource(img, file.name); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('图片读取失败'); };
    img.src = url;
  }

  /* ---------------- 示例图 ---------------- */
  function makeDemoImage() {
    const W = 560, H = 560;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const horizon = Math.round(H * 0.62);

    // 天空：平涂色带
    const bands = ['#2b1b5e', '#452880', '#7c3a86', '#bf4f6b', '#ef8a5f', '#ffc681'];
    bands.forEach((col, i) => {
      x.fillStyle = col;
      x.fillRect(0, Math.round(horizon * i / bands.length), W, Math.round(horizon / bands.length) + 1);
    });

    // 太阳
    x.fillStyle = '#ffc172';
    x.beginPath();
    x.arc(W * 0.63, horizon - 66, 100, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#ffe7a8';
    x.beginPath();
    x.arc(W * 0.63, horizon - 66, 68, 0, Math.PI * 2);
    x.fill();

    // 云
    const cloud = (cx, cy, s, color) => {
      x.fillStyle = color;
      [[0, 0, 1], [0.95, 0.16, 0.74], [-0.95, 0.18, 0.68], [0.45, -0.42, 0.56], [-0.4, -0.34, 0.48]].forEach(([dx, dy, k]) => {
        x.beginPath();
        x.ellipse(cx + dx * s, cy + dy * s, s * k, s * k * 0.6, 0, 0, Math.PI * 2);
        x.fill();
      });
    };
    cloud(W * 0.2, H * 0.19, 52, '#c69ad0');
    cloud(W * 0.8, H * 0.13, 40, '#e5a6bd');

    // 远山
    x.fillStyle = '#4a2f68';
    x.beginPath();
    x.moveTo(0, horizon);
    x.lineTo(0, H * 0.48);
    x.lineTo(W * 0.14, H * 0.31);
    x.lineTo(W * 0.28, H * 0.47);
    x.lineTo(W * 0.42, H * 0.33);
    x.lineTo(W * 0.57, H * 0.49);
    x.lineTo(W * 0.72, H * 0.31);
    x.lineTo(W * 0.88, H * 0.47);
    x.lineTo(W, H * 0.37);
    x.lineTo(W, horizon);
    x.closePath();
    x.fill();

    // 近山（更深）
    x.fillStyle = '#2a1a44';
    x.beginPath();
    x.moveTo(0, horizon);
    x.lineTo(0, H * 0.56);
    x.lineTo(W * 0.22, H * 0.44);
    x.lineTo(W * 0.4, H * 0.57);
    x.lineTo(W * 0.62, H * 0.43);
    x.lineTo(W * 0.82, H * 0.56);
    x.lineTo(W, H * 0.5);
    x.lineTo(W, horizon);
    x.closePath();
    x.fill();

    // 海
    const seaBands = ['#e0873f', '#b25a4f', '#7a3460', '#46224f', '#2a1a44'];
    let y = horizon;
    seaBands.forEach((col, i) => {
      const h = Math.round((H - horizon) * (0.13 + i * 0.055));
      x.fillStyle = col;
      x.fillRect(0, y, W, Math.min(h, H - y));
      y += h;
    });

    // 太阳倒影
    for (let i = 0; i < 8; i++) {
      const ry = horizon + 14 + i * 24;
      if (ry > H - 12) break;
      const wid = 170 * (1 - i / 10);
      x.fillStyle = i % 2 === 0 ? '#ffd98f' : '#f0a35e';
      x.fillRect(W * 0.63 - wid / 2, ry, wid, 9 + i * 1.6);
    }

    // 飞鸟
    x.strokeStyle = '#1d1230';
    x.lineWidth = 4;
    x.lineCap = 'round';
    const bird = (bx, by, s) => {
      x.beginPath();
      x.moveTo(bx - s, by);
      x.quadraticCurveTo(bx - s * 0.42, by - s * 0.78, bx, by - s * 0.06);
      x.quadraticCurveTo(bx + s * 0.42, by - s * 0.78, bx + s, by);
      x.stroke();
    };
    bird(W * 0.26, H * 0.28, 20);
    bird(W * 0.34, H * 0.23, 14);
    bird(W * 0.2, H * 0.34, 11);

    return c;
  }

  function loadDemo() {
    const c = makeDemoImage();
    setSource(c, '示例：日落海岸');
    toast('已载入示例图，试试调整「最多颜色数」和「相近色合并」');
  }

  /* ---------------- 生成 ---------------- */
  function rebuild() {
    if (!state.source) return;
    const s = settings;
    const pal = currentPalette();
    state.palette = pal;

    const cols = clamp(s.cols | 0, 2, 400);
    let rows = s.rows | 0;
    if (s.lockAspect) rows = Math.max(2, Math.round(cols / state.aspect));
    rows = clamp(rows, 2, 400);

    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let pat;
    try {
      pat = P.buildPattern({
        source: state.source,
        cols,
        rows,
        palette: pal.colors,
        maxColors: s.maxColors,
        mergeDeltaE: s.mergeDeltaE,
        dither: s.dither | 0,
        background: s.background,
        adjust: {
          brightness: s.brightness | 0,
          contrast: s.contrast | 0,
          saturation: s.saturation | 0
        }
      });
    } catch (e) {
      console.error(e);
      toast('生成失败：' + e.message);
      return;
    }
    const dt = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);

    state.pattern = pat;
    state.focus = -1;
    state.ms = dt;
    if (state.pattern) {
      try { applyReplacements(state.pattern); } catch (e) { console.warn(e); }
    }
    $('rowsRange').value = String(clamp(pat.rows, 8, 200));
    // 正在输入时不要抢用户的文字
    if (document.activeElement !== $('rowsNum')) setNum('rowsNum', pat.rows);
    if (document.activeElement !== $('colsNum')) setNum('colsNum', pat.cols);

    renderPreview();
    renderStats();
    renderLegend();
  }

  /* ---------------- 预览渲染 ---------------- */
  function computeCell(pat) {
    if (settings.zoom > 0) return settings.zoom;
    const wrap = $('canvasWrap');
    const availW = Math.max(180, (wrap ? wrap.clientWidth : 900) - 44);
    const availH = Math.max(180, (wrap ? wrap.clientHeight : 600) - 44);
    const cw = Math.floor(availW / (pat.cols + 1.6));
    const ch = Math.floor(availH / (pat.rows + 1.6));
    // 图纸 / 彩色+编号 模式：至少保证编号看得清，放不下就横向滚动
    const needNumbers = settings.mode !== 'beads' && settings.numbers !== 'none';
    const minCell = needNumbers ? 13 : 2;
    return clamp(Math.min(cw, ch), minCell, 56);
  }

  function renderPreview() {
    const pat = state.pattern;
    if (!pat) return;
    const cell = computeCell(pat);
    const chart = settings.mode === 'chart';
    const numbers = settings.mode === 'beads' ? 'none' : settings.numbers;

    const metrics = R.drawPreview($('preview'), pat, {
      cell,
      mode: chart ? 'chart' : 'beads',
      numbers,
      grid: settings.grid,
      thickEvery: settings.thick ? 5 : 0,
      boardCols: settings.board ? settings.boardCols : 0,
      boardRows: settings.board ? settings.boardRows : 0,
      rulers: settings.ruler,
      rulerStep: 5,
      focus: state.focus,
      hover: state.hover
    });
    state.metrics = metrics;

    $('stageTitle').textContent = pat.cols + ' × ' + pat.rows + ' 格';
    const pill = pat.palette.length + ' 色 · ' + fmt(pat.total) + ' 颗' +
      (pat.empty ? ' · 空 ' + fmt(pat.empty) + ' 格' : '');
    $('stagePill').textContent = (numbers !== 'none' && cell < 12) ? pill + ' · 放大后显示编号' : pill;
    $('perfInfo').textContent = (state.ms != null ? state.ms + ' ms · ' : '') +
      cell + 'px/格' + (settings.zoom > 0 ? '' : '（自动）');
  }

  function updateHoverbar() {
    const bar = $('hoverbar');
    const pat = state.pattern;
    const h = state.hover;
    if (!pat || !h) {
      bar.innerHTML = '<span class="muted">鼠标悬停或点一下格子，就能看到坐标和色号</span>';
      return;
    }
    const idx = pat.indices[h.r * pat.cols + h.c];
    if (idx < 0) {
      bar.innerHTML = '<span class="hover-chip"><b class="mono">(' + (h.c + 1) + ', ' + (h.r + 1) + ')</b> 空格（不排豆）</span>';
      return;
    }
    const p = pat.palette[idx];
    const label = settings.numbers === 'sym' ? R.symbolFor(idx) : '#' + (idx + 1);
    bar.innerHTML =
      '<span class="hover-chip"><b class="mono">(' + (h.c + 1) + ', ' + (h.r + 1) + ')</b></span>' +
      '<span class="hover-chip"><span class="sw" style="background:' + p.hex + '"></span>' +
      '<b class="mono">' + label + '</b> ' + p.code + (p.name ? ' · ' + p.name : '') + '</span>' +
      '<span class="mono muted">' + p.hex + '</span>';
  }

  /* ---------------- 概览 / 色号表 ---------------- */
  function renderStats() {
    const pat = state.pattern;
    if (!pat) return;
    const beadSize = parseFloat(settings.beadSize) || 5;
    const bc = Math.max(1, settings.boardCols | 0);
    const br = Math.max(1, settings.boardRows | 0);
    const boards = Math.ceil(pat.cols / bc) * Math.ceil(pat.rows / br);

    $('statSize').textContent = pat.cols + ' × ' + pat.rows;
    $('statBeads').textContent = fmt(pat.total) + (pat.empty ? ' (+' + fmt(pat.empty) + ' 空)' : '');
    $('statColors').textContent = pat.palette.length + ' 色';
    $('statBoards').textContent = boards + ' 块';
    $('statPhysical').textContent =
      (pat.cols * beadSize / 10).toFixed(1) + ' × ' + (pat.rows * beadSize / 10).toFixed(1) + ' cm';
    $('statTime').textContent = timeText(pat.total);

    // 简单模式的“实际几色”
    $('simpleColorVal').textContent = '实际 ' + pat.palette.length + ' 色';
  }

  /** 3 秒一颗的粗略估算 */
  function timeText(total) {
    const sec = Math.max(0, total) * 3;
    if (sec < 90) return '几分钟';
    if (sec < 3600) return Math.round(sec / 60) + ' 分钟';
    return (sec / 3600).toFixed(1) + ' 小时';
  }

  function renderLegend() {
    const pat = state.pattern;
    const list = $('legendList');
    if (!pat) return;
    const total = pat.total || 1;
    const replaced = Object.keys(settings.replaceMap || {});

    list.innerHTML = '';
    pat.palette.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'legend-item' + (state.focus === i ? ' active' : '');
      row.title = p.code + (p.name ? ' ' + p.name : '') + ' ' + p.hex + ' · ' + p.count + ' 颗';
      row.innerHTML =
        '<span class="sw" style="background:' + p.hex + '"></span>' +
        '<span class="num">' + (settings.numbers === 'sym' ? R.symbolFor(i) : '#' + (i + 1)) + '</span>' +
        '<span class="name">' + (p.name ? '<small>' + p.code + '</small>' + p.name : p.code) + '</span>' +
        '<span class="cnt"><strong>' + fmt(p.count) + '</strong></span>' +
        '<button type="button" class="swap" title="换成相近的另一种豆">换</button>';

      row.querySelector('.sw').addEventListener('click', (e) => {
        e.stopPropagation();
        state.focus = state.focus === i ? -1 : i;
        renderPreview();
        renderLegend();
      });
      row.querySelector('.name').addEventListener('click', (e) => {
        e.stopPropagation();
        state.focus = state.focus === i ? -1 : i;
        renderPreview();
        renderLegend();
      });
      row.querySelector('.cnt').addEventListener('click', (e) => {
        e.stopPropagation();
        state.focus = state.focus === i ? -1 : i;
        renderPreview();
        renderLegend();
      });
      row.querySelector('.swap').addEventListener('click', (e) => {
        e.stopPropagation();
        openReplace(p.code);
      });
      list.appendChild(row);
    });
    $('legendCount').textContent = pat.palette.length + ' 种 · ' + fmt(pat.total) + ' 颗';
    $('btnClearReplace').disabled = replaced.length === 0;
    $('btnClearReplace').textContent = replaced.length ? '清除换色（' + replaced.length + '）' : '清除换色';
  }

  /* ---------------- 简单 / 专业模式 ---------------- */
  function setUIMode(mode, silent) {
    settings.uiMode = mode === 'pro' ? 'pro' : 'simple';
    document.body.setAttribute('data-mode', settings.uiMode);
    Array.from($('modeSwitch').children).forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-mode') === settings.uiMode);
    });
    if (!silent) saveSettings();
    if (state.pattern) renderPreview();
  }

  /* ---------------- 撤销 / 重做 ---------------- */
  const hist = { undo: [], redo: [], last: '', timer: 0, quiet: false };

  function snapshot() { return JSON.stringify(settings); }

  function updateHistButtons() {
    $('btnUndo').disabled = hist.undo.length === 0;
    $('btnRedo').disabled = hist.redo.length === 0;
  }

  function noteHistory() {
    if (hist.quiet) return;
    clearTimeout(hist.timer);
    hist.timer = setTimeout(pushHistory, 700);
  }

  function pushHistory() {
    clearTimeout(hist.timer);
    const cur = snapshot();
    if (cur === hist.last) return false;
    hist.undo.push(hist.last);
    if (hist.undo.length > 60) hist.undo.shift();
    hist.redo.length = 0;
    hist.last = cur;
    updateHistButtons();
    return true;
  }

  function applySnapshot(snap) {
    hist.quiet = true;
    try { settings = JSON.parse(snap); } catch (e) { hist.quiet = false; return; }
    applySettingsToUI();
    hist.last = snap;
    hist.quiet = false;
    saveSettings();
    updateHistButtons();
    updateMask();
  }

  function undo() {
    pushHistory();
    if (!hist.undo.length) { toast('已经是最早的状态了'); return; }
    hist.redo.push(snapshot());
    applySnapshot(hist.undo.pop());
    toast('已撤销');
  }

  function redo() {
    if (!hist.redo.length) { toast('没有可以重做的了'); return; }
    hist.undo.push(snapshot());
    applySnapshot(hist.redo.pop());
    toast('已重做');
  }

  /* ---------------- 简单模式：颜色精简程度 ---------------- */
  function levelFromColors() {
    const c = clamp(settings.maxColors | 0, 4, 24);
    return clamp(Math.round((24 - c) * 5), 0, 100);
  }

  function colorsFromLevel(L) {
    const c = clamp(Math.round(24 - L / 5), 4, 24);
    const max = currentPalette().colors.length;
    return Math.min(c, max);
  }

  function applySimpleLevel(L, silent) {
    settings.maxColors = colorsFromLevel(L);
    settings.mergeDeltaE = clamp(Math.round(L / 10), 0, 10);
    $('simpleColorRange').value = String(L);
    if (document.activeElement !== $('simpleColorNum')) setNum('simpleColorNum', L);
    if (!silent) { saveSettings(); scheduleRebuild(); }
  }

  function syncSimpleColorUI() {
    const L = levelFromColors();
    $('simpleColorRange').value = String(L);
    if (document.activeElement !== $('simpleColorNum')) setNum('simpleColorNum', L);
  }

  /** 分析这张图适合几种颜色 */
  function updateAdvice() {
    const el = $('colorAdvice');
    if (!el) return;
    if (!state.source) {
      el.innerHTML = '往右拉 = 颜色更少、更好买豆；往左拉 = 更像原图';
      return;
    }
    let rec = null;
    try {
      const rows = Math.max(8, Math.round(40 / (state.aspect || 1)));
      const pat = P.buildPattern({
        source: state.source,
        cols: 40,
        rows: Math.min(120, rows),
        palette: currentPalette().colors,
        maxColors: 24,
        mergeDeltaE: 3,
        dither: 0,
        background: settings.background
      });
      const total = pat.total || 1;
      const sig = pat.palette.filter((p) => p.count / total >= 0.02).length;
      rec = clamp(sig + 1, 6, 24);
    } catch (e) { rec = null; }
    state.advice = rec;
    el.innerHTML = rec
      ? '这张图建议 <b>约 ' + rec + ' 色</b>：往右拉颜色更少、更好买豆，往左拉更像原图。'
      : '往右拉 = 颜色更少、更好买豆；往左拉 = 更像原图';
  }

  /* ---------------- 换色（颜色替换） ---------------- */
  let replaceCode = null;

  function openReplace(code) {
    const pal = currentPalette();
    const cur = pal.colors.find((c) => c.code === code);
    if (!cur || !state.pattern) return;
    replaceCode = code;

    const used = Object.keys(settings.replaceMap || {}).indexOf(code) >= 0;
    $('replaceInfo').innerHTML = '现在用的是 <b>' + code + '</b>' + (used ? '（已经换过一次）' : '') +
      '，下面是颜色最接近的几种豆：';

    const grid = $('replaceGrid');
    grid.innerHTML = '';
    const here = C.rgbToLab(cur.r, cur.g, cur.b);
    const cand = pal.colors
      .filter((c) => c.code !== code)
      .map((c) => ({ c, de: C.deltaE2000(here, C.rgbToLab(c.r, c.g, c.b)) }))
      .sort((a, b) => a.de - b.de)
      .slice(0, 36);

    cand.forEach(({ c, de }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'replace-item';
      b.innerHTML = '<span class="sw" style="background:' + c.hex + '"></span>' +
        '<b>' + c.code + '</b><small>差 ' + de.toFixed(1) + '</small>';
      b.addEventListener('click', () => {
        const map = Object.assign({}, settings.replaceMap || {});
        map[code] = c.code;
        settings.replaceMap = map;
        saveSettings();
        $('replaceDialog').close();
        rebuild();
        toast('已把 ' + code + ' 换成 ' + c.code);
      });
      grid.appendChild(b);
    });

    $('replaceDialog').showModal();
  }

  /** 把换色结果合并进图纸：同色号合并、按豆量重新编号 */
  function applyReplacements(pat) {
    const map = settings.replaceMap || {};
    const keys = Object.keys(map);
    if (!keys.length) return pat;
    const pal = currentPalette().colors;
    const byCode = new Map(pal.map((c) => [c.code, c]));

    let changed = false;
    const mapped = pat.palette.map((p) => {
      const to = map[p.code];
      if (!to) return p;
      const t = byCode.get(to);
      if (!t) return p;
      changed = true;
      return Object.assign({}, p, {
        code: t.code, name: t.name || '', hex: t.hex, r: t.r, g: t.g, b: t.b
      });
    });
    if (!changed) return pat;

    const groups = new Map();
    const merged = [];
    const remap = new Int32Array(pat.palette.length).fill(-1);
    mapped.forEach((p, i) => {
      let gi = groups.get(p.code);
      if (gi === undefined) {
        gi = merged.length;
        groups.set(p.code, gi);
        merged.push({
          code: p.code, name: p.name, hex: p.hex, r: p.r, g: p.g, b: p.b, count: 0
        });
      }
      merged[gi].count += p.count;
      remap[i] = gi;
    });

    const order = merged.map((_, i) => i).sort((a, b) => merged[b].count - merged[a].count);
    const remap2 = new Int32Array(merged.length);
    order.forEach((oldI, newI) => { remap2[oldI] = newI; });

    const idx = pat.indices;
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i];
      if (v >= 0) idx[i] = remap2[remap[v]];
    }

    let total = 0;
    pat.palette = order.map((oldI, newI) => {
      const p = merged[oldI];
      total += p.count;
      return { index: newI, code: p.code, name: p.name, hex: p.hex, r: p.r, g: p.g, b: p.b, count: p.count };
    });
    pat.total = total;
    return pat;
  }

  /* ---------------- 色卡对照图 ---------------- */
  function openChart() {
    const pal = currentPalette();
    $('chartTitle').textContent = pal.name + ' · ' + pal.colors.length + ' 色';
    drawChart($('chartCanvas'), pal.colors);
    $('chartDialog').showModal();
  }

  function drawChart(canvas, colors) {
    const cols = colors.length > 220 ? 20 : (colors.length > 100 ? 16 : 12);
    const cw = 92;
    const ch = 64;
    const pad = 18;
    const rows = Math.ceil(colors.length / cols);
    canvas.width = pad * 2 + cols * cw;
    canvas.height = pad + 34 + rows * ch + 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.font = '700 16px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('色卡对照（参考色）', pad, pad + 8);

    const top = pad + 26;
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      const x = pad + (i % cols) * cw;
      const y = top + Math.floor(i / cols) * ch;
      ctx.fillStyle = c.hex;
      ctx.fillRect(x + 2, y + 2, cw - 10, ch - 28);
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2.5, y + 2.5, cw - 11, ch - 29);
      ctx.fillStyle = '#222';
      ctx.font = '700 12px ui-monospace, Consolas, monospace';
      ctx.fillText(c.code, x + 5, y + ch - 10);
    }
  }

  /* ---------------- 购买清单 ---------------- */
  function drawShopping(canvas) {
    const pat = state.pattern;
    if (!pat) return null;
    const pal = currentPalette();
    const cols = pat.palette.length > 26 ? 3 : 2;
    const rowH = 34;
    const colW = 288;
    const pad = 26;
    const rows = Math.ceil(pat.palette.length / cols);
    canvas.width = pad * 2 + cols * colW;
    canvas.height = pad + 74 + rows * rowH + 30;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    ctx.fillStyle = '#111';
    ctx.font = '700 22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('拼豆购买清单', pad, pad + 12);

    ctx.fillStyle = '#555';
    ctx.font = '500 13px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(pal.name + ' · ' + pat.cols + '×' + pat.rows + ' 格 · ' + pat.palette.length + ' 色 · ' +
      fmt(pat.total) + ' 颗 · 大概要做 ' + timeText(pat.total), pad, pad + 38);

    const top = pad + 62;
    pat.palette.forEach((p, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const x = pad + col * colW;
      const y = top + row * rowH;

      ctx.fillStyle = p.hex;
      ctx.fillRect(x, y - 12, 26, 26);
      ctx.strokeStyle = 'rgba(0,0,0,.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y - 11.5, 25, 25);

      ctx.fillStyle = '#111';
      ctx.font = '700 14px ui-monospace, Consolas, monospace';
      ctx.fillText(p.code, x + 36, y);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#111';
      ctx.font = '700 14px ui-monospace, Consolas, monospace';
      ctx.fillText(fmt(p.count) + ' 颗', x + colW - 20, y);
      ctx.textAlign = 'left';
    });

    ctx.fillStyle = '#999';
    ctx.font = '500 11px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('拼豆工坊 · ' + new Date().toLocaleDateString('zh-CN') + ' · 色号以实际购买品牌为准', pad, canvas.height - 18);

    return canvas;
  }

  function openShopping() {
    if (!state.pattern) { toast('先导入一张图片'); return; }
    const pat = state.pattern;
    const meta = currentPalette().name + ' · ' + pat.palette.length + ' 色 · ' + fmt(pat.total) + ' 颗';
    $('shoppingMeta').textContent = meta + ' · 大概要做 ' + timeText(pat.total);
    drawShopping($('shoppingCanvas'));
    $('shoppingDialog').showModal();
  }

  /* ---------------- 保存 / 我的图纸 ---------------- */
  const SAVES_KEY = 'pbg.saves.v1';

  function loadSaves() {
    try {
      const raw = localStorage.getItem(SAVES_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function writeSaves(list) {
    try {
      localStorage.setItem(SAVES_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      toast('保存失败：浏览器存储满了，先删几张旧的', 4000);
      return false;
    }
  }

  function downscale(canvas, max) {
    const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
    if (scale >= 1) return canvas;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * scale));
    c.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }

  function openSaveDialog() {
    if (!state.source) { toast('先导入一张图片'); return; }
    const nm = (state.imgName || '').replace(/\.[^.]+$/, '');
    $('saveName').value = nm && nm !== '未命名图片' ? nm : '';
    $('saveDialog').showModal();
    setTimeout(() => { try { $('saveName').focus(); } catch (e) { /* ignore */ } }, 60);
  }

  function doSave() {
    const name = ($('saveName').value || '').trim() || '未命名图纸';
    const small = downscale(state.sourceCanvas, 720);
    const item = {
      id: 'p' + Date.now().toString(36),
      name,
      at: Date.now(),
      settings: JSON.parse(JSON.stringify(settings)),
      thumb: makeThumb(state.sourceCanvas),
      source: small.toDataURL('image/jpeg', 0.82)
    };
    const list = loadSaves();
    list.unshift(item);
    if (writeSaves(list.slice(0, 40))) {
      $('saveDialog').close();
      toast('已存到「我的图纸」');
    }
  }

  function openSaves() {
    const list = loadSaves();
    const box = $('savesList');
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<p class="muted pad">还没有保存过图纸。点右上角「保存图纸」试试。</p>';
    }
    list.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'save-item';
      const s = it.settings || {};
      const when = new Date(it.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      row.innerHTML =
        (it.thumb ? '<img src="' + it.thumb + '" alt="">' : '<div class="ph"></div>') +
        '<div class="meta"><b></b><span>' + when + ' · ' + (s.cols || '?') + ' 格 · ' + (s.paletteId || '') + '</span></div>' +
        '<div class="acts"><button type="button" class="btn small">打开</button>' +
        '<button type="button" class="btn small ghost">删除</button></div>';
      row.querySelector('b').textContent = it.name;
      row.querySelectorAll('button')[0].addEventListener('click', () => loadSave(it));
      row.querySelectorAll('button')[1].addEventListener('click', () => {
        const rest = loadSaves().filter((x) => x.id !== it.id);
        writeSaves(rest);
        openSaves();
      });
      box.appendChild(row);
    });
    $('savesDialog').showModal();
  }

  function loadSave(item) {
    if (!item || !item.settings) return;
    settings = Object.assign({}, DEFAULTS, item.settings, {
      sheet: Object.assign({}, DEFAULTS.sheet, item.settings.sheet || {})
    });
    saveSettings();
    populatePalettes();
    applySettingsToUI();
    $('savesDialog').close();
    if (item.source) {
      const img = new Image();
      img.onload = () => { state.imgName = item.name; setSource(img, item.name); };
      img.onerror = () => toast('这张图纸的原图读取失败');
      img.src = item.source;
    } else {
      updateMask();
    }
  }

  /* ---------------- 新手引导 ---------------- */
  const GUIDE_KEY = 'pbg.guide.v1';

  function showGuide(force) {
    let seen = false;
    try { seen = !!localStorage.getItem(GUIDE_KEY); } catch (e) { /* ignore */ }
    if (!force && seen) return;
    const dlg = $('guideDialog');
    if (!dlg.open) dlg.showModal();
  }

  function closeGuide() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* ignore */ }
    $('guideDialog').close();
  }

  /* ---------------- 旋转 / 镜像 ---------------- */
  function transformSource(kind) {
    if (!state.source) { toast('先导入一张图片'); return; }
    const src = state.sourceCanvas;
    const w = src.width;
    const h = src.height;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (kind === 'rotate') {
      c.width = h;
      c.height = w;
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      c.width = w;
      c.height = h;
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(src, 0, 0);
    setSource(c, state.imgName);
    toast(kind === 'rotate' ? '已旋转 90°' : '已左右镜像');
  }

  /* ---------------- 色卡模板 ---------------- */
  function downloadPaletteTemplate() {
    const pal = currentPalette();
    const lines = ['色号,名称,颜色'];
    pal.colors.forEach((c) => {
      lines.push(c.code + ',' + (c.name || '') + ',' + c.hex);
    });
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    EX.download(blob, '色卡模板-' + pal.name + '.csv');
    toast('模板已下载：改成你手上豆子的颜色，再点「导入」传回来', 4000);
  }

  /* ---------------- 交互 ---------------- */
  const scheduleRebuild = debounce(rebuild, 90);
  const schedulePreview = debounce(renderPreview, 50);

  function bindRange(rangeId, labelId, key, after) {
    const el = $(rangeId);
    el.addEventListener('input', () => {
      const v = parseInt(el.value, 10);
      settings[key] = v;
      if (labelId) $(labelId).textContent = v;
      saveSettings();
      if (after) after(v);
    });
  }

  /* 数字输入框回填（不触发事件） */
  function setNum(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value === '' || value == null ? '' : String(value);
  }

  /**
   * 滑块 + 数字输入框双向联动：
   *  - 拖滑块 → 输入框实时跟随
   *  - 输入框手输 → 滑块跟随、立刻重算（输入过程中不强行改写用户的文字，失焦后再规范化）
   *  - autoZero: 0 / 清空 表示「自动」（格子大小用）
   */
  function wireSliderNumber(cfg) {
    const range = $(cfg.rangeId);
    const num = $(cfg.numId);
    const key = cfg.key;

    const limits = () => ({
      min: parseInt(range.min, 10) || 0,
      max: parseInt(range.max, 10) || 100
    });

    function write(v) {
      settings[key] = v;
      saveSettings();
      if (cfg.after) cfg.after(v);
    }

    function commit(v, rewriteInput) {
      const lim = limits();
      v = clamp(Math.round(v), lim.min, lim.max);
      range.value = String(clamp(v, parseInt(range.min, 10), parseInt(range.max, 10)));
      if (rewriteInput) setNum(cfg.numId, cfg.autoZero && v === 0 ? '' : v);
      write(v);
    }

    // 拖动滑块
    range.addEventListener('input', () => {
      const v = parseInt(range.value, 10) || 0;
      setNum(cfg.numId, cfg.autoZero && v === 0 ? '' : v);
      write(clamp(v, limits().min, limits().max));
    });

    // 手输
    num.addEventListener('input', () => {
      const raw = num.value.trim();
      if (raw === '') {
        if (cfg.autoZero) {           // 清空 = 自动
          range.value = String(parseInt(range.min, 10) || 0);
          write(0);
        }
        return;
      }
      const v = parseInt(raw, 10);
      if (Number.isNaN(v)) return;
      const lim = limits();
      const vv = clamp(v, lim.min, lim.max);
      range.value = String(clamp(vv, parseInt(range.min, 10), parseInt(range.max, 10)));
      write(vv);
    });

    // 失焦 / 回车：把输入框内容规范化（比如输 1 会变成最小值）
    function normalize() {
      const lim = limits();
      let v = parseInt(num.value, 10);
      if (Number.isNaN(v)) v = cfg.autoZero ? 0 : settings[key];
      commit(clamp(v, lim.min, lim.max), true);
    }
    num.addEventListener('blur', normalize);
    num.addEventListener('change', normalize);
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); num.blur(); }
      if (e.key === 'Escape') { setNum(cfg.numId, cfg.autoZero && settings[key] === 0 ? '' : settings[key]); num.blur(); }
    });

    // 初始回填
    setNum(cfg.numId, cfg.autoZero && settings[key] === 0 ? '' : settings[key]);
  }

  function applySettingsToUI() {
    $('colsRange').value = String(clamp(settings.cols, 8, 200));
    setNum('colsNum', settings.cols);
    $('rowsRange').value = String(clamp(settings.rows || settings.cols, 8, 200));
    setNum('rowsNum', settings.rows || settings.cols);
    $('chkAspect').checked = !!settings.lockAspect;
    $('rowsRange').disabled = !!settings.lockAspect;
    $('rowsNum').disabled = !!settings.lockAspect;

    $('selPalette').value = settings.paletteId;
    syncColorLimit();
    $('mergeRange').value = String(settings.mergeDeltaE);
    $('mergeVal').textContent = settings.mergeDeltaE;
    $('selDither').value = String(settings.dither);
    $('selBg').value = settings.background;
    $('brightRange').value = String(settings.brightness);
    $('brightVal').textContent = settings.brightness;
    $('contrastRange').value = String(settings.contrast);
    $('contrastVal').textContent = settings.contrast;
    $('saturRange').value = String(settings.saturation);
    $('saturVal').textContent = settings.saturation;

    $('selMode').value = settings.mode;
    $('selNumbers').value = settings.numbers;
    $('chkGrid').checked = !!settings.grid;
    $('chkThick').checked = !!settings.thick;
    $('chkBoard').checked = !!settings.board;
    $('chkRuler').checked = !!settings.ruler;
    $('zoomRange').value = String(clamp(settings.zoom, 0, 48));
    setNum('zoomNum', settings.zoom > 0 ? settings.zoom : '');
    $('selBead').value = String(settings.beadSize);

    // 去背景
    $('bgTolRange').value = String(clamp(settings.bgTolerance, 0, 100));
    setNum('bgTolNum', settings.bgTolerance);
    $('bgUrl').value = settings.bgUrl || 'http://127.0.0.1:7000';
    $('chkKeepLargest').checked = settings.bgKeepLargest !== false;
    $('selBgMethod').value = settings.bgMethod === 'rembg' ? 'rembg' : 'local';
    syncBgUI();

    const board = BOARD_FOR_BEAD[String(settings.beadSize)] || 29;
    settings.boardCols = board;
    settings.boardRows = board;
    const boardLabel = $('chkBoard').parentNode.lastChild;
    if (boardLabel && boardLabel.nodeType === 3) {
      boardLabel.textContent = ' 标出拼豆板分界（一块 ' + board + '×' + board + '）';
    }

    // 界面模式 / 简单色阶 / 导出面板
    const uiMode = settings.uiMode === 'pro' ? 'pro' : 'simple';
    document.body.setAttribute('data-mode', uiMode);
    Array.from($('modeSwitch').children).forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-mode') === uiMode);
    });
    syncSimpleColorUI();
    $('sdFollow').checked = settings.sheet.follow !== false;
    $('sdNumbersOn').checked = settings.sheet.numbers !== 'none';
  }

  function bindUI() {
    // 图片
    $('btnOpen').addEventListener('click', () => $('fileInput').click());
    $('btnOpen2').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) loadFile(f);
      e.target.value = '';
    });
    $('btnDemo').addEventListener('click', loadDemo);
    $('btnClear').addEventListener('click', () => {
      state.source = null;
      state.sourceCanvas = null;
      state.raw = null;
      state.mask = null;
      state.maskKey = '';
      state.pattern = null;
      state.hover = null;
      state.focus = -1;
      $('preview').classList.add('hidden');
      $('emptyState').classList.remove('hidden');
      $('imgThumb').classList.remove('has-img');
      $('imgThumb').style.backgroundImage = '';
      $('imgThumb').innerHTML = '<span>未选择</span>';
      $('imgName').textContent = '还没有导入图片';
      $('imgInfo').textContent = '支持 JPG / PNG / WEBP，可直接 Ctrl+V 粘贴';
      $('legendList').innerHTML = '<p class="muted pad">导入图片后这里会列出每种豆要多少颗。</p>';
      $('statSize').textContent = $('statBeads').textContent = $('statColors').textContent = '—';
      $('statBoards').textContent = $('statPhysical').textContent = $('statTime').textContent = '—';
      $('stagePill').textContent = '未导入图片';
      $('legendCount').textContent = '';
      $('perfInfo').textContent = '';
      $('simpleColorVal').textContent = '约 16 色';
      updateHoverbar();
    });

    // 恢复默认
    $('btnResetAll').addEventListener('click', () => {
      if (!window.confirm('把所有参数恢复成默认值？（图片和已保存的图纸不受影响）')) return;
      const ui = settings.uiMode;
      settings = JSON.parse(JSON.stringify(DEFAULTS));
      settings.uiMode = ui;
      settings.replaceMap = {};
      saveSettings();
      populatePalettes();
      applySettingsToUI();
      updateMask();
      toast('已恢复默认设置');
    });

    // 模式切换
    Array.from($('modeSwitch').children).forEach((b) => {
      b.addEventListener('click', () => setUIMode(b.getAttribute('data-mode')));
    });

    // 撤销 / 重做 / 帮助
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnHelp').addEventListener('click', () => showGuide(true));
    $('btnGuideOk').addEventListener('click', closeGuide);
    $('btnGuideDemo').addEventListener('click', () => { closeGuide(); loadDemo(); });
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
    });

    // 简单模式：颜色精简程度
    $('simpleColorRange').addEventListener('input', (e) => {
      applySimpleLevel(parseInt(e.target.value, 10) || 0);
    });
    $('simpleColorNum').addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isNaN(v)) return;
      applySimpleLevel(clamp(v, 0, 100));
    });

    // 色卡对照图
    $('btnPaletteChart').addEventListener('click', openChart);
    $('btnChartClose').addEventListener('click', () => $('chartDialog').close());
    $('btnChartDownload').addEventListener('click', () => {
      const c = $('chartCanvas');
      EX.canvasToBlob(c, 'image/png').then((b) => {
        EX.download(b, '色卡对照-' + currentPalette().name + '.png');
        toast('色卡图已保存');
      });
    });

    // 换色
    $('btnReplaceClose').addEventListener('click', () => $('replaceDialog').close());
    $('btnReplaceReset').addEventListener('click', () => {
      if (!replaceCode) { $('replaceDialog').close(); return; }
      const map = Object.assign({}, settings.replaceMap || {});
      delete map[replaceCode];
      settings.replaceMap = map;
      saveSettings();
      $('replaceDialog').close();
      rebuild();
      toast('已恢复 ' + replaceCode + ' 的原色');
    });
    $('btnClearReplace').addEventListener('click', () => {
      if (!Object.keys(settings.replaceMap || {}).length) return;
      settings.replaceMap = {};
      saveSettings();
      rebuild();
      toast('已清除所有换色');
    });

    // 购买清单
    $('btnShopping').addEventListener('click', openShopping);
    $('btnShoppingClose').addEventListener('click', () => $('shoppingDialog').close());
    $('btnShoppingPng').addEventListener('click', () => {
      const c = document.createElement('canvas');
      if (!drawShopping(c)) return;
      EX.canvasToBlob(c, 'image/png').then((b) => {
        EX.download(b, '购买清单-' + new Date().toLocaleDateString('zh-CN').replace(/\//g, '-') + '.png');
        toast('购买清单已保存');
      });
    });
    $('btnShoppingPrint').addEventListener('click', () => {
      const c = document.createElement('canvas');
      if (!drawShopping(c)) return;
      EX.printCanvases([c], '购买清单').then(() => toast('已发送到打印机'));
    });

    // 保存 / 我的图纸
    $('btnProjectSave').addEventListener('click', openSaveDialog);
    $('btnSaveCancel').addEventListener('click', () => $('saveDialog').close());
    $('btnSaveOk').addEventListener('click', doSave);
    $('btnProjectLoad').addEventListener('click', openSaves);
    $('btnSavesClose').addEventListener('click', () => $('savesDialog').close());
    $('btnExportFile').addEventListener('click', saveProject);
    $('btnImportFile').addEventListener('click', () => $('projectInput').click());

    // 旋转 / 镜像
    $('btnRotate').addEventListener('click', () => transformSource('rotate'));
    $('btnFlipH').addEventListener('click', () => transformSource('flipH'));

    // 导出预设 / 分页导出
    Array.from($('sdPresets').children).forEach((b) => {
      b.addEventListener('click', () => {
        applyExportPreset(b.getAttribute('data-preset'));
        syncSheetUI();
        updateSheetPreview();
      });
    });
    $('btnSheetMulti').addEventListener('click', exportMulti);

    // 去背景
    $('chkRemoveBg').addEventListener('change', (e) => {
      settings.removeBg = e.target.checked;
      saveSettings();
      syncBgUI();
      if (settings.removeBg && settings.background === 'white') {
        settings.background = 'none';
        $('selBg').value = 'none';
        saveSettings();
        toast('已把「透明区域」改成留空：去掉的部分不排豆', 3000);
      }
      updateMask();
    });
    $('selBgMethod').addEventListener('change', (e) => {
      settings.bgMethod = e.target.value === 'rembg' ? 'rembg' : 'local';
      saveSettings();
      syncBgUI();
      updateMask();
    });
    $('chkKeepLargest').addEventListener('change', (e) => {
      settings.bgKeepLargest = e.target.checked;
      saveSettings();
      updateMask();
    });
    $('bgUrl').addEventListener('change', (e) => {
      settings.bgUrl = e.target.value.trim() || 'http://127.0.0.1:7000';
      e.target.value = settings.bgUrl;
      saveSettings();
      if (settings.removeBg && settings.bgMethod === 'rembg') updateMask();
    });
    wireSliderNumber({
      rangeId: 'bgTolRange', numId: 'bgTolNum', key: 'bgTolerance',
      after: () => { if (settings.removeBg) scheduleMask(); }
    });

    // 拖放 + 粘贴
    ['dragenter', 'dragover'].forEach((ev) => {
      document.addEventListener(ev, (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        $('canvasWrap').style.outline = '2px dashed var(--accent)';
      });
    });
    ['dragleave', 'dragend'].forEach((ev) => {
      document.addEventListener(ev, () => { $('canvasWrap').style.outline = ''; });
    });
    document.addEventListener('drop', (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      $('canvasWrap').style.outline = '';
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          const f = items[i].getAsFile();
          if (f) { loadFile(f); e.preventDefault(); }
          return;
        }
      }
    });

    // 尺寸
    wireSliderNumber({
      rangeId: 'colsRange', numId: 'colsNum', key: 'cols',
      after: () => {
        if (settings.lockAspect && state.source) {
          settings.rows = Math.max(2, Math.round(settings.cols / state.aspect));
          $('rowsRange').value = String(clamp(settings.rows, 8, 200));
          setNum('rowsNum', settings.rows);
        }
        scheduleRebuild();
      }
    });
    wireSliderNumber({
      rangeId: 'rowsRange', numId: 'rowsNum', key: 'rows',
      after: () => scheduleRebuild()
    });
    $('chkAspect').addEventListener('change', (e) => {
      settings.lockAspect = e.target.checked;
      $('rowsRange').disabled = settings.lockAspect;
      $('rowsNum').disabled = settings.lockAspect;
      saveSettings();
      if (settings.lockAspect && state.source) {
        settings.rows = Math.max(2, Math.round(settings.cols / state.aspect));
        $('rowsRange').value = String(clamp(settings.rows, 8, 200));
        setNum('rowsNum', settings.rows);
      }
      scheduleRebuild();
    });
    Array.from(document.querySelectorAll('#sizePresets .chip')).forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.cols = parseInt(btn.dataset.cols, 10);
        if (settings.lockAspect && state.source) settings.rows = Math.max(2, Math.round(settings.cols / state.aspect));
        applySettingsToUI();
        saveSettings();
        rebuild();
      });
    });
    $('selBead').addEventListener('change', (e) => {
      settings.beadSize = e.target.value;
      const b = BOARD_FOR_BEAD[settings.beadSize] || 29;
      settings.boardCols = b;
      settings.boardRows = b;
      $('chkBoard').parentNode.lastChild.textContent = ' 显示 ' + b + '×' + b + ' 拼豆板分界';
      saveSettings();
      rebuild();
    });

    // 配色
    $('selPalette').addEventListener('change', (e) => {
      settings.paletteId = e.target.value;
      syncColorLimit();
      saveSettings();
      rebuild();
    });
    wireSliderNumber({
      rangeId: 'colorsRange', numId: 'colorsNum', key: 'maxColors',
      after: () => scheduleRebuild()
    });
    bindRange('mergeRange', 'mergeVal', 'mergeDeltaE', () => scheduleRebuild());
    $('selDither').addEventListener('change', (e) => {
      settings.dither = parseInt(e.target.value, 10);
      saveSettings();
      rebuild();
    });
    $('selBg').addEventListener('change', (e) => {
      settings.background = e.target.value;
      saveSettings();
      rebuild();
    });
    bindRange('brightRange', 'brightVal', 'brightness', () => scheduleRebuild());
    bindRange('contrastRange', 'contrastVal', 'contrast', () => scheduleRebuild());
    bindRange('saturRange', 'saturVal', 'saturation', () => scheduleRebuild());

    // 显示
    $('selMode').addEventListener('change', (e) => {
      settings.mode = e.target.value;
      saveSettings();
      renderPreview();
    });
    $('selNumbers').addEventListener('change', (e) => {
      settings.numbers = e.target.value;
      saveSettings();
      renderPreview();
      renderLegend();
    });
    ['chkGrid', 'chkThick', 'chkBoard', 'chkRuler'].forEach((id) => {
      const key = { chkGrid: 'grid', chkThick: 'thick', chkBoard: 'board', chkRuler: 'ruler' }[id];
      $(id).addEventListener('change', (e) => {
        settings[key] = e.target.checked;
        saveSettings();
        renderPreview();
      });
    });
    wireSliderNumber({
      rangeId: 'zoomRange', numId: 'zoomNum', key: 'zoom', autoZero: true,
      after: () => schedulePreview()
    });

    // 鼠标悬停 / 手指点按（手机也能看色号）
    const pv = $('preview');
    const pickAt = (e) => {
      const m = state.metrics;
      const pat = state.pattern;
      if (!m || !pat) return false;
      const x = e.offsetX - m.originX;
      const y = e.offsetY - m.originY;
      if (x < 0 || y < 0) { setHover(null); return false; }
      const c = Math.floor(x / m.cell);
      const r = Math.floor(y / m.cell);
      if (c < 0 || c >= pat.cols || r < 0 || r >= pat.rows) { setHover(null); return false; }
      setHover({ c, r });
      return true;
    };
    pv.addEventListener('mousemove', pickAt);
    pv.addEventListener('mouseleave', () => setHover(null));
    pv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      pickAt(e);
      e.preventDefault();
    });
    pv.style.touchAction = 'manipulation';

    // 双击循环缩放：适应窗口 → 18 → 28 → 40
    pv.title = '双击切换缩放，放大后可以看到格子编号';
    pv.addEventListener('dblclick', () => {
      const order = [0, 18, 28, 40];
      const i = (order.indexOf(settings.zoom) + 1) % order.length;
      settings.zoom = order[i];
      $('zoomRange').value = String(settings.zoom);
      setNum('zoomNum', settings.zoom > 0 ? settings.zoom : '');
      saveSettings();
      renderPreview();
      toast('缩放：' + (settings.zoom ? settings.zoom + ' px/格' : '适应窗口'), 1200);
    });

    // 窗口尺寸变化
    window.addEventListener('resize', debounce(() => {
      if (state.pattern) renderPreview();
    }, 140));

    // 色卡导入
    $('btnPalette').addEventListener('click', () => {
      $('paletteText').value = '';
      $('paletteName').value = '';
      $('paletteFileInfo').textContent = '支持 .json / .csv / .txt';
      $('paletteDialog').showModal();
    });
    $('btnPaletteCancel').addEventListener('click', () => $('paletteDialog').close());
    $('btnPaletteFile').addEventListener('click', () => $('paletteFileInput').click());
    $('paletteFileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        $('paletteText').value = String(reader.result || '');
        if (!$('paletteName').value) $('paletteName').value = f.name.replace(/\.[^.]+$/, '');
        $('paletteFileInfo').textContent = f.name + ' · ' + Math.round(f.size / 1024) + ' KB';
      };
      reader.readAsText(f);
    });
    $('btnPaletteImport').addEventListener('click', () => {
      const text = $('paletteText').value.trim();
      if (!text) { toast('请先粘贴或选择色卡内容'); return; }
      let colors;
      try {
        if (text[0] === '[' || (text[0] === '{' && text.indexOf('"colors"') >= 0)) {
          colors = JSON.parse(text);
        } else {
          colors = PAL.parseCsv(text);
        }
      } catch (err) {
        toast('解析失败：' + err.message);
        return;
      }
      let pal;
      try {
        pal = PAL.normalize(colors, $('paletteName').value || '我的色卡');
      } catch (err) {
        toast('解析失败：' + err.message);
        return;
      }
      if ($('paletteName').value.trim()) pal.name = $('paletteName').value.trim();
      const custom = PAL.loadCustom().filter((p) => p.id !== pal.id && p.name !== pal.name);
      custom.push(pal);
      PAL.saveCustom(custom);
      settings.paletteId = pal.id;
      settings.maxColors = Math.min(settings.maxColors, pal.colors.length);
      populatePalettes();
      syncColorLimit();
      saveSettings();
      $('paletteDialog').close();
      rebuild();
      toast('已导入「' + pal.name + '」共 ' + pal.colors.length + ' 色');
    });
    $('btnPaletteClean').addEventListener('click', () => {
      PAL.saveCustom([]);
      if (!allPalettes().some((p) => p.id === settings.paletteId)) settings.paletteId = 'universal';
      populatePalettes();
      syncColorLimit();
      saveSettings();
      rebuild();
      $('paletteDialog').close();
      toast('已清除导入的色卡');
    });

    // 导出
    $('btnCsv').addEventListener('click', () => {
      if (!state.pattern) { toast('先导入一张图片'); return; }
      const pat = state.pattern;
      EX.exportCsv(pat, '拼豆配色表-' + pat.cols + 'x' + pat.rows + '-' + EX.timestamp() + '.csv', [
        ['格子', pat.cols + ' × ' + pat.rows],
        ['总豆数', pat.total],
        ['色卡', currentPalette().name],
        ['大概要做', timeText(pat.total)],
        ['成品尺寸', (pat.cols * parseFloat(settings.beadSize) / 10).toFixed(1) + '×' +
          (pat.rows * parseFloat(settings.beadSize) / 10).toFixed(1) + ' cm']
      ]);
      toast('配色表已导出');
    });
    $('btnQuickPng').addEventListener('click', () => exportSheet());
    $('btnSheetDialog').addEventListener('click', openSheetDialog);
    $('btnPrint').addEventListener('click', printSheet);

    // 图纸弹窗
    $('sheetDialog').addEventListener('close', () => { /* noop */ });
    $('btnSheetCancel').addEventListener('click', () => $('sheetDialog').close());
    ['sdCell', 'sdStyle', 'sdNumbers', 'sdThick', 'sdSplit', 'sdArrange', 'sdPageCols', 'sdPageRows', 'sdOverlap', 'sdLegend', 'sdTint', 'sdFollow', 'sdNumbersOn']
      .forEach((id) => {
        $(id).addEventListener('input', () => { syncSheetUI(); updateSheetPreview(); });
        $(id).addEventListener('change', () => { syncSheetUI(); updateSheetPreview(); });
      });
    $('btnSheetExport').addEventListener('click', () => exportSheet(true));
    $('btnSheetPrint').addEventListener('click', printSheet);

    // 色卡导入 / 模板
    $('btnPaletteTemplate').addEventListener('click', downloadPaletteTemplate);
    $('projectInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) loadProject(f);
    });
  }

  let hoverRaf = 0;
  function setHover(h) {
    if (!h && !state.hover) return;
    if (h && state.hover && h.c === state.hover.c && h.r === state.hover.r) return;
    state.hover = h;
    updateHoverbar();
    if (!hoverRaf) {
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        renderPreview();
      });
    }
  }

  /* ---------------- 图纸导出 ---------------- */
  function sheetOptions() {
    const s = settings;
    const sh = s.sheet;
    const pat = state.pattern;
    const bead = parseFloat(s.beadSize) || 5;
    const wcm = (pat.cols * bead / 10).toFixed(1);
    const hcm = (pat.rows * bead / 10).toFixed(1);
    const cell = clamp(sh.cell, 10, 64);

    const style = sh.style || 'plain';
    const plain = style === 'plain';            // 纯数字表 + 黑框 + 底部用量
    const colored = style === 'beads' || style === 'colorNum';

    return {
      cell,
      mode: colored ? 'beads' : 'chart',
      // 彩色底可以不要编号；白底/数字表必须留编号，否则整张是空白格
      numbers: ((style === 'plain' || style === 'chart') && sh.numbers === 'none') ? 'num' : sh.numbers,
      grid: true,
      thickEvery: sh.thick ? 5 : 0,
      frame: plain,
      legendStyle: plain ? 'compact' : 'table',
      boardCols: s.board ? s.boardCols : 0,
      boardRows: s.board ? s.boardRows : 0,
      split: !!sh.split,
      arrange: sh.arrange === 'stack' ? 'stack' : 'grid',
      pageCols: clamp(sh.pageCols, 4, 400),
      pageRows: clamp(sh.pageRows, 4, 400),
      // 拼回一张时重叠没有意义，强制 0
      overlap: (sh.arrange === 'grid' || !sh.split) ? 0 : clamp(sh.overlap, 0, 20),
      legend: !!sh.legend,
      rulers: !plain,
      rulerStep: 5,
      tint: style === 'chart' ? !!sh.tint : false,
      margin: plain ? Math.max(10, Math.round(cell * 0.7)) : undefined,
      footer: !plain,
      title: plain ? '' : '拼豆图纸 · ' + pat.cols + ' × ' + pat.rows + ' 格',
      subtitle: plain ? '' : pat.palette.length + ' 色 · 共 ' + fmt(pat.total) + ' 颗 · 成品 ' + wcm + ' × ' + hcm + ' cm',
      footerText: '拼豆工坊 · ' + new Date().toLocaleDateString('zh-CN') + ' · ' + currentPalette().name,
      footerRight: '1 格 = 1 颗豆'
    };
  }

  function fileName(pat) {
    const d = new Date();
    return '我的拼豆图纸-' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日.png';
  }

  const EXPORT_PRESETS = {
    wechat: { cell: 14, split: false, pageCols: 29, pageRows: 29, overlap: 0 },
    print: { cell: 24, split: true, pageCols: 29, pageRows: 29, overlap: 0 },
    hd: { cell: 40, split: false, pageCols: 29, pageRows: 29, overlap: 0 }
  };

  function applyExportPreset(name) {
    const p = EXPORT_PRESETS[name] || EXPORT_PRESETS.print;
    const sh = settings.sheet;
    sh.cell = p.cell;
    sh.split = p.split;
    sh.pageCols = p.pageCols;
    sh.pageRows = p.pageRows;
    sh.overlap = p.overlap;
    sh.preset = name;
    $('sdCell').value = String(sh.cell);
    $('sdSplit').checked = sh.split;
    $('sdPageCols').value = String(sh.pageCols);
    $('sdPageRows').value = String(sh.pageRows);
    $('sdOverlap').value = String(sh.overlap);
    saveSettings();
  }

  function markPreset(name) {
    Array.from($('sdPresets').children).forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-preset') === name);
    });
  }

  function exportSheet(fromDialog) {
    if (!state.pattern) { toast('先导入一张图片'); return; }
    if (fromDialog) syncSheetUI();
    const opts = sheetOptions();
    const canvas = document.createElement('canvas');
    let L;
    try {
      L = R.drawSheet(canvas, state.pattern, opts);
    } catch (e) {
      console.error(e);
      toast('生成图纸失败：' + e.message);
      return;
    }
    if (L.width * L.height > 140e6) {
      toast('图纸太大了（' + L.width + '×' + L.height + '），把「每格像素」调小或启用分页再导出', 5000);
      return;
    }
    EX.exportPng(canvas, fileName(state.pattern))
      .then(() => {
        toast('图纸已保存（' + L.width + ' × ' + L.height + ' px）', 3000);
        if (fromDialog) $('sheetDialog').close();
      })
      .catch((e) => toast('导出失败：' + e.message, 4000));
  }

  /** 分页存成多张 PNG */
  async function exportMulti() {
    if (!state.pattern) { toast('先导入一张图片'); return; }
    syncSheetUI();
    const opts = sheetOptions();
    if (!opts.split) {
      toast('先在高级选项里勾选「按拼豆板分页」，才能分页导出', 3600);
      return;
    }
    const L = R.sheetLayout(state.pattern, opts);
    const base = fileName(state.pattern).replace(/\.png$/, '');
    for (let i = 0; i < L.totalPages; i++) {
      const c = document.createElement('canvas');
      R.drawSheet(c, state.pattern, Object.assign({}, opts, { pageIndex: i, arrange: 'stack' }));
      try {
        const blob = await EX.canvasToBlob(c, 'image/png');
        EX.download(blob, base + '-第' + (i + 1) + '页.png');
      } catch (e) {
        toast('第 ' + (i + 1) + ' 页导出失败：' + e.message);
        return;
      }
      await new Promise((r) => setTimeout(r, 420));
    }
    toast('已导出 ' + L.totalPages + ' 张（浏览器可能会问是否允许下载多个文件）', 4000);
  }

  function printSheet() {
    if (!state.pattern) { toast('先导入一张图片'); return; }
    const opts = sheetOptions();
    const L = R.sheetLayout(state.pattern, opts);
    const pages = L.totalPages;
    if (!window.confirm('会打印 ' + pages + ' 页（每页 ' + opts.pageCols + '×' + opts.pageRows +
      ' 格）。\n打印对话框里选「另存为 PDF」就能存成 PDF 发给打印店。\n\n继续吗？')) return;
    const canvases = [];
    for (let i = 0; i < pages; i++) {
      const c = document.createElement('canvas');
      R.drawSheet(c, state.pattern, Object.assign({}, opts, { pageIndex: i, arrange: 'stack' }));
      canvases.push(c);
    }
    EX.printCanvases(canvases, '拼豆图纸').then(() => toast('已发送到打印机对话框')).catch((e) => toast('打印失败：' + e.message));
  }

  function styleFromPreview() {
    const m = settings.mode;
    if (m === 'beads') return 'beads';
    if (m === 'colorNum') return 'colorNum';
    return 'chart';
  }

  function openSheetDialog() {
    if (!state.pattern) { toast('先导入一张图片'); return; }
    const sh = settings.sheet;
    if (sh.follow !== false) sh.style = styleFromPreview();
    $('sdCell').value = String(sh.cell);
    $('sdCellVal').textContent = sh.cell;
    $('sdStyle').value = sh.style || 'plain';
    $('sdNumbers').value = sh.numbers === 'none' ? 'num' : sh.numbers;
    $('sdNumbersOn').checked = sh.numbers !== 'none';
    $('sdFollow').checked = sh.follow !== false;
    $('sdThick').checked = !!sh.thick;
    $('sdSplit').checked = !!sh.split;
    $('sdArrange').value = sh.arrange === 'stack' ? 'stack' : 'grid';
    $('sdPageCols').value = String(sh.pageCols);
    $('sdPageRows').value = String(sh.pageRows);
    $('sdOverlap').value = String(sh.overlap);
    $('sdOverlapVal').textContent = sh.overlap;
    $('sdLegend').checked = !!sh.legend;
    $('sdTint').checked = !!sh.tint;
    markPreset(sh.preset || 'print');
    syncSheetUI();
    $('sheetDialog').showModal();
    updateSheetPreview();
  }

  function syncSheetUI() {
    const sh = settings.sheet;
    sh.follow = $('sdFollow').checked;
    sh.cell = clamp(parseInt($('sdCell').value, 10) || 26, 10, 64);
    sh.style = sh.follow ? styleFromPreview() : $('sdStyle').value;
    sh.numbers = $('sdNumbersOn').checked ? ($('sdNumbers').value === 'none' ? 'num' : $('sdNumbers').value) : 'none';
    sh.thick = $('sdThick').checked;
    sh.split = $('sdSplit').checked;
    sh.arrange = $('sdArrange').value === 'stack' ? 'stack' : 'grid';
    sh.pageCols = clamp(parseInt($('sdPageCols').value, 10) || 29, 4, 400);
    sh.pageRows = clamp(parseInt($('sdPageRows').value, 10) || 29, 4, 400);
    sh.overlap = clamp(parseInt($('sdOverlap').value, 10) || 0, 0, 20);
    sh.legend = $('sdLegend').checked;
    sh.tint = $('sdTint').checked;

    if (sh.follow) $('sdStyle').value = sh.style;
    $('sdStyle').disabled = sh.follow;
    $('sdCellVal').textContent = sh.cell;
    $('sdOverlapVal').textContent = sh.overlap;
    const noOverlap = !sh.split || sh.arrange === 'grid';
    $('sdPageCols').disabled = !sh.split;
    $('sdPageRows').disabled = !sh.split;
    $('sdArrange').disabled = !sh.split;
    $('sdOverlap').disabled = noOverlap;
    $('sdOverlap').parentNode.style.opacity = noOverlap ? '.45' : '';
    $('sdTint').disabled = sh.style !== 'chart';
    $('sdTint').parentNode.style.opacity = sh.style === 'chart' ? '' : '.45';
    saveSettings();
  }

  const updateSheetPreview = debounce(function () {
    const pat = state.pattern;
    if (!pat) return;
    const opts = sheetOptions();
    const L = R.sheetLayout(pat, opts);
    const c = $('sdPreview');
    const area = L.width * L.height;

    if (area > 60e6) {
      c.width = 10; c.height = 10;
      $('sdDims').textContent = '图纸过大（' + L.width + ' × ' + L.height + ' px），请调小「每格像素」';
      return;
    }
    try {
      R.drawSheet(c, pat, opts);
    } catch (e) {
      $('sdDims').textContent = '预览失败：' + e.message;
      return;
    }
    const pageTxt = opts.split ? ' · 每页 ' + opts.pageCols + '×' + opts.pageRows + ' 格' : '';
    $('sdDims').textContent = L.width + ' × ' + L.height + ' px · ' + L.totalPages + ' 页' + pageTxt;
    if (!opts.split) {
      $('sdInfo').textContent = '单张图纸，编号为色号，底部列出每种编号的颗数。';
    } else if (opts.arrange === 'grid') {
      $('sdInfo').textContent = '分 ' + L.totalPages + ' 页（' + L.gridCols + ' × ' + L.gridRows +
        '），按原图位置拼成一张，每块周边有边框；底部用量表只出现一次。';
    } else {
      $('sdInfo').textContent = '分 ' + L.totalPages + ' 页（' + opts.pageCols + '×' + opts.pageRows +
        ' 格），一页接一页竖排；可留 ' + opts.overlap + ' 格重叠方便对位。';
    }
  }, 160);

  /* ---------------- 项目存档 ---------------- */
  function saveProject() {
    if (!state.source) { toast('请先导入图片'); return; }
    const proj = {
      app: 'pindou-studio',
      version: 1,
      savedAt: new Date().toISOString(),
      name: state.imgName,
      settings: settings,
      source: {
        width: state.source.width,
        height: state.source.height,
        dataURL: state.sourceCanvas.toDataURL('image/png')
      }
    };
    EX.exportJson(proj, '拼豆项目_' + EX.timestamp() + '.json');
    toast('项目已保存（含原图与全部参数）');
  }

  function loadProject(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let proj;
      try { proj = JSON.parse(String(reader.result)); } catch (e) { toast('项目文件损坏'); return; }
      if (!proj || proj.app !== 'pindou-studio') { toast('不是本软件的项目文件'); return; }

      if (proj.settings) {
        const rawSheet = proj.settings.sheet || {};
        const sheet = Object.assign({}, DEFAULTS.sheet, rawSheet);
        if (rawSheet.style == null) {
          sheet.style = ['beads', 'colorNum', 'chart'].indexOf(rawSheet.mode) >= 0 ? rawSheet.mode : 'plain';
        }
        settings = Object.assign({}, DEFAULTS, proj.settings, { sheet });
      }
      saveSettings();
      populatePalettes();
      applySettingsToUI();

      if (proj.source && proj.source.dataURL) {
        const img = new Image();
        img.onload = () => setSource(img, proj.name || '项目图片');
        img.onerror = () => toast('项目里的原图读取失败');
        img.src = proj.source.dataURL;
      } else {
        toast('项目已载入参数，但没有原图');
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- 分享 / 调试参数 ---------------- */
  function handleHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw);
    if (params.has('mode')) {
      const m = params.get('mode');
      if (['beads', 'chart', 'colorNum'].indexOf(m) >= 0) { settings.mode = m; $('selMode').value = m; }
    }
    if (params.has('colors')) {
      settings.maxColors = clamp(parseInt(params.get('colors'), 10) || 16, 2, 200);
      syncColorLimit();
    }
    if (params.has('merge')) {
      settings.mergeDeltaE = clamp(parseInt(params.get('merge'), 10) || 0, 0, 24);
      $('mergeRange').value = String(settings.mergeDeltaE);
      $('mergeVal').textContent = settings.mergeDeltaE;
    }
    if (params.has('demo')) loadDemo();
    if (params.has('sheet') && state.pattern) openSheetDialog();
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    loadSettings();
    populatePalettes();
    applySettingsToUI();
    bindUI();
    updateHoverbar();
    updateHistButtons();
    hist.last = snapshot();
    setUIMode(settings.uiMode, true);
    updateAdvice();
    handleHash();
    setTimeout(() => showGuide(false), 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

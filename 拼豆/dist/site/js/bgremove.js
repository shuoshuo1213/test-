/* ============================================================
 * 拼豆工坊 · 去背景
 *
 *  1) local()  —— 纯前端离线算法：边缘种子色 + Lab 色差泛洪 + 局部漂移，
 *     适合纯色/渐变背景（白底商品图、证件照、插画）；
 *     没有模型依赖，单文件版也能用。
 *  2) rembg()  —— 调用本机启动的 rembg 服务（tools/rembg_server.py），
 *     真正的 AI 抠图，复杂背景效果好，但需要本机装 Python + rembg。
 *
 *  返回：Uint8Array 掩膜（255 = 保留，0 = 背景），后续交给生成管线。
 * ============================================================ */
(function (g) {
  'use strict';

  const C = g.PBColor;

  /* ---------------- 基础工具 ---------------- */

  /** 批量转 Lab（一次分配，避免每像素建对象） */
  function toLabBulk(data, n) {
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const lab = C.rgbToLab(data[o], data[o + 1], data[o + 2]);
      out[i * 3] = lab.L;
      out[i * 3 + 1] = lab.a;
      out[i * 3 + 2] = lab.b;
    }
    return out;
  }

  /** 采样四周边缘像素，聚成最多 maxSeeds 种背景色 */
  function collectSeeds(lab, W, H, maxSeeds) {
    const buckets = new Map();
    const add = (i) => {
      const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
      const Lb = Math.min(7, Math.max(0, Math.round(L / 12.6)));
      const ab = Math.min(15, Math.max(0, Math.round((a + 128) / 16)));
      const bb = Math.min(15, Math.max(0, Math.round((b + 128) / 16)));
      const key = (Lb << 8) | (ab << 4) | bb;
      let s = buckets.get(key);
      if (!s) { s = { n: 0, L: 0, a: 0, b: 0 }; buckets.set(key, s); }
      s.n++; s.L += L; s.a += a; s.b += b;
    };

    for (let x = 0; x < W; x++) {
      add(x);
      add((H - 1) * W + x);
    }
    for (let y = 1; y < H - 1; y++) {
      add(y * W);
      add(y * W + W - 1);
    }

    const limit = maxSeeds || 8;
    return Array.from(buckets.values())
      .sort((p, q) => q.n - p.n)
      .slice(0, limit)
      .map((s) => ({ L: s.L / s.n, a: s.a / s.n, b: s.b / s.n, n: s.n }));
  }

  /* ---------------- 边缘泛洪 ---------------- */

  function floodFromBorder(lab, W, H, seeds, tol) {
    const N = W * H;
    const mask = new Uint8Array(N).fill(255);
    const seedDist = new Float32Array(N).fill(-1);
    const visited = new Uint8Array(N);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;

    const distToSeeds = (i) => {
      let d = seedDist[i];
      if (d >= 0) return d;
      const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
      let best = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const p = seeds[s];
        const dL = L - p.L, da = a - p.a, db = b - p.b;
        const dd = dL * dL + da * da + db * db;
        if (dd < best) best = dd;
      }
      d = Math.sqrt(best);
      seedDist[i] = d;
      return d;
    };

    const pushBg = (i) => {
      visited[i] = 1;
      mask[i] = 0;
      queue[qt++] = i;
    };

    // 边缘中与背景色接近的像素作为起点
    for (let x = 0; x < W; x++) {
      const i1 = x;
      const i2 = (H - 1) * W + x;
      if (!visited[i1] && distToSeeds(i1) < tol) pushBg(i1);
      if (!visited[i2] && distToSeeds(i2) < tol) pushBg(i2);
    }
    for (let y = 1; y < H - 1; y++) {
      const i1 = y * W;
      const i2 = y * W + W - 1;
      if (!visited[i1] && distToSeeds(i1) < tol) pushBg(i1);
      if (!visited[i2] && distToSeeds(i2) < tol) pushBg(i2);
    }

    const localTol = tol * 0.55;      // 相邻像素允许的色差（处理渐变）
    const hardLimit = tol * 2.2;      // 离背景色太远就不许再“漂”进去

    while (qh < qt) {
      const i = queue[qh++];
      const x = i % W;
      const y = (i / W) | 0;
      const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];

      const consider = (j) => {
        if (visited[j]) return;
        const ds = distToSeeds(j);
        if (ds < tol) { pushBg(j); return; }
        if (ds > hardLimit) return;
        const dL = lab[j * 3] - L, da = lab[j * 3 + 1] - a, db = lab[j * 3 + 2] - b;
        if (Math.sqrt(dL * dL + da * da + db * db) < localTol) pushBg(j);
      };

      if (x > 0) consider(i - 1);
      if (x < W - 1) consider(i + 1);
      if (y > 0) consider(i - W);
      if (y < H - 1) consider(i + W);
    }

    return { mask, removed: qt };
  }

  /* ---------------- 只保留最大主体 ---------------- */

  function keepLargestComponent(mask, W, H) {
    const N = W * H;
    const seen = new Uint8Array(N);
    const queue = new Int32Array(N);
    let best = null;
    let bestSize = 0;

    for (let start = 0; start < N; start++) {
      if (seen[start] || mask[start] === 0) continue;
      let qh = 0, qt = 0;
      queue[qt++] = start;
      seen[start] = 1;
      const comp = [];
      while (qh < qt) {
        const i = queue[qh++];
        comp.push(i);
        const x = i % W;
        const y = (i / W) | 0;
        if (x > 0) { const j = i - 1; if (!seen[j] && mask[j]) { seen[j] = 1; queue[qt++] = j; } }
        if (x < W - 1) { const j = i + 1; if (!seen[j] && mask[j]) { seen[j] = 1; queue[qt++] = j; } }
        if (y > 0) { const j = i - W; if (!seen[j] && mask[j]) { seen[j] = 1; queue[qt++] = j; } }
        if (y < H - 1) { const j = i + W; if (!seen[j] && mask[j]) { seen[j] = 1; queue[qt++] = j; } }
      }
      if (comp.length > bestSize) {
        bestSize = comp.length;
        best = comp;
      }
    }

    const out = new Uint8Array(N);
    if (best) for (let k = 0; k < best.length; k++) out[best[k]] = 255;
    return out;
  }

  /* ---------------- 边缘羽化 ---------------- */

  function feather(mask, W, H, radius) {
    const r = Math.max(1, radius | 0);
    const tmp = new Float32Array(W * H);
    const out = new Uint8Array(W * H);
    const win = r * 2 + 1;

    // 横向
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += mask[row + Math.min(W - 1, Math.max(0, k))];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = sum / win;
        const add = row + Math.min(W - 1, x + r + 1);
        const sub = row + Math.min(W - 1, Math.max(0, x - r));
        sum += mask[add] - mask[sub];
      }
    }
    // 纵向
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = Math.round(sum / win);
        const add = Math.min(H - 1, y + r + 1) * W + x;
        const sub = Math.min(H - 1, Math.max(0, y - r)) * W + x;
        sum += tmp[add] - tmp[sub];
      }
    }
    return out;
  }

  /* ---------------- 对外：本地算法 ---------------- */

  /**
   * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} img
   * @param {{tolerance?:number, keepLargest?:boolean}} opts tolerance 0..100
   * @returns {{mask:Uint8Array, removed:number, ratio:number}}
   */
  function local(img, opts) {
    opts = opts || {};
    const W = img.width | 0;
    const H = img.height | 0;
    const N = W * H;
    if (!N) throw new Error('图片为空');

    const tol = 4 + Math.max(0, Math.min(100, opts.tolerance == null ? 40 : opts.tolerance)) / 100 * 36;

    const lab = toLabBulk(img.data, N);
    const seeds = collectSeeds(lab, W, H, 8);
    const res = floodFromBorder(lab, W, H, seeds, tol);
    let mask = res.mask;

    if (opts.keepLargest !== false) {
      const kept = keepLargestComponent(mask, W, H);
      let keptN = 0;
      for (let i = 0; i < N; i++) if (kept[i]) keptN++;
      // 主体太小说明算法跑偏了（比如背景占满整张），保留原结果更安全
      if (keptN > N * 0.02) mask = kept;
    }

    mask = feather(mask, W, H, 1);

    let removed = 0;
    for (let i = 0; i < N; i++) if (mask[i] < 128) removed++;

    return { mask, removed, ratio: removed / N };
  }

  /* ---------------- 对外：rembg 服务 ---------------- */

  /**
   * 把画布发给本机 rembg 服务，取回带 alpha 的 PNG，返回掩膜
   * @param {HTMLCanvasElement} canvas 原图画布
   * @param {string} endpoint 例如 http://127.0.0.1:7000
   * @param {number} timeoutMs
   */
  async function rembg(canvas, endpoint, timeoutMs) {
    const url = String(endpoint || 'http://127.0.0.1:7000').replace(/\/+$/, '');
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布导出失败'))), 'image/png');
    });

    const form = new FormData();
    form.append('file', blob, 'input.png');
    form.append('model', 'u2net');

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 60000) : null;

    let res;
    try {
      res = await fetch(url + '/remove', {
        method: 'POST',
        body: form,
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      throw new Error('连不上 rembg 服务（' + url + '），请先运行 python tools/rembg_server.py');
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
      throw new Error('rembg 返回错误：' + msg);
    }

    const outBlob = await res.blob();
    const bmp = await createImageBitmap(outBlob);
    const W = canvas.width;
    const H = canvas.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, W, H);
    if (bmp.close) bmp.close();

    const data = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let removed = 0;
    for (let i = 0; i < mask.length; i++) {
      const a = data[i * 4 + 3];
      mask[i] = a;
      if (a < 128) removed++;
    }
    return { mask, removed, ratio: removed / mask.length };
  }

  g.PBRemove = {
    local,
    rembg,
    toLabBulk,
    collectSeeds,
    floodFromBorder,
    keepLargestComponent,
    feather
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================
 * 拼豆工坊 · 颜色基础库
 * sRGB ↔ CIELab(D65) · CIEDE2000 · 感知亮度 · 调色 · 最近色搜索
 * 同时兼容浏览器与 Node（便于单元测试）：挂载到全局 PBColor
 * ============================================================ */
(function (g) {
  'use strict';

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* ---------------- HEX / RGB ---------------- */
  function hexToRgb(hex) {
    let h = String(hex == null ? '' : hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function rgbToHex(r, gg, b) {
    const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return ('#' + h(r) + h(gg) + h(b)).toUpperCase();
  }

  /* ---------------- sRGB ↔ 线性光 ---------------- */
  function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return clamp(v * 255, 0, 255);
  }

  /* ---------------- sRGB ↔ CIELab (D65) ---------------- */
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const EPS = 216 / 24389, KAPPA = 24389 / 27;

  function rgbToLab(r, gg, b) {
    const R = srgbToLinear(r), G = srgbToLinear(gg), B = srgbToLinear(b);
    const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / Xn;
    const Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) / Yn;
    const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / Zn;
    const f = (t) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function labToRgb(L, a, b) {
    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const xr = Math.pow(fx, 3) > EPS ? Math.pow(fx, 3) : (116 * fx - 16) / KAPPA;
    const yr = L > KAPPA * EPS ? Math.pow((L + 16) / 116, 3) : L / KAPPA;
    const zr = Math.pow(fz, 3) > EPS ? Math.pow(fz, 3) : (116 * fz - 16) / KAPPA;
    const X = xr * Xn, Y = yr * Yn, Z = zr * Zn;
    const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
    const G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
    const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    return {
      r: Math.round(linearToSrgb(R)),
      g: Math.round(linearToSrgb(G)),
      b: Math.round(linearToSrgb(B))
    };
  }

  /* ---------------- 色差 ---------------- */
  /** CIE76：快，用于最近色搜索 */
  function deltaE76(p, q) {
    const dL = p.L - q.L, da = p.a - q.a, db = p.b - q.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  /** CIEDE2000：慢，用于「相近色合并」阈值判断 */
  function deltaE2000(p, q) {
    const RAD = Math.PI / 180, DEG = 180 / Math.PI;
    const L1 = p.L, a1 = p.a, b1 = p.b, L2 = q.L, a2 = q.a, b2 = q.b;

    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const Cbar = (C1 + C2) / 2;
    const Cbar7 = Math.pow(Cbar, 7);
    const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);

    const hue = (x, y) => {
      if (x === 0 && y === 0) return 0;
      const h = Math.atan2(y, x) * DEG;
      return h < 0 ? h + 360 : h;
    };
    const h1p = hue(a1p, b1), h2p = hue(a2p, b2);

    const dLp = L2 - L1;
    const dCp = C2p - C1p;

    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * RAD) / 2);

    const Lbarp = (L1 + L2) / 2;
    const Cbarp = (C1p + C2p) / 2;

    let hbarp;
    if (C1p * C2p === 0) {
      hbarp = h1p + h2p;
    } else if (Math.abs(h1p - h2p) <= 180) {
      hbarp = (h1p + h2p) / 2;
    } else if (h1p + h2p < 360) {
      hbarp = (h1p + h2p + 360) / 2;
    } else {
      hbarp = (h1p + h2p - 360) / 2;
    }

    const T = 1
      - 0.17 * Math.cos((hbarp - 30) * RAD)
      + 0.24 * Math.cos(2 * hbarp * RAD)
      + 0.32 * Math.cos((3 * hbarp + 6) * RAD)
      - 0.20 * Math.cos((4 * hbarp - 63) * RAD);

    const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    const Cbarp7 = Math.pow(Cbarp, 7);
    const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
    const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
    const SC = 1 + 0.045 * Cbarp;
    const SH = 1 + 0.015 * Cbarp * T;
    const RT = -Math.sin(2 * dTheta * RAD) * RC;

    const t1 = dLp / SL, t2 = dCp / SC, t3 = dHp / SH;
    return Math.sqrt(t1 * t1 + t2 * t2 + t3 * t3 + RT * t2 * t3);
  }

  /* ---------------- 亮度 / 文字对比色 ---------------- */
  function luminance(r, gg, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(gg) + 0.0722 * srgbToLinear(b);
  }

  /** 在该底色上写字，返回 #111 或 #FFF */
  function readableOn(r, gg, b) {
    return luminance(r, gg, b) > 0.42 ? '#141414' : '#FFFFFF';
  }

  /* ---------------- 调色（亮度 / 对比度 / 饱和度） ---------------- */
  /** o = {brightness:-100..100, contrast:-100..100, saturation:-100..100} */
  function adjust(r, gg, b, o) {
    if (!o) return { r, g: gg, b };
    let R = r, G = gg, B = b;

    if (o.contrast) {
      const c = (o.contrast / 100) * 255;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      R = f * (R - 128) + 128;
      G = f * (G - 128) + 128;
      B = f * (B - 128) + 128;
    }
    if (o.saturation) {
      const gray = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      const s = 1 + o.saturation / 100;
      R = gray + (R - gray) * s;
      G = gray + (G - gray) * s;
      B = gray + (B - gray) * s;
    }
    if (o.brightness) {
      const d = (o.brightness / 100) * 128;
      R += d; G += d; B += d;
    }
    return {
      r: clamp(Math.round(R), 0, 255),
      g: clamp(Math.round(G), 0, 255),
      b: clamp(Math.round(B), 0, 255)
    };
  }

  /* ---------------- 最近色搜索 ---------------- */
  /** 给颜色数组补上 lab 字段（原地 + 返回） */
  function withLab(list) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.lab) c.lab = rgbToLab(c.r, c.g, c.b);
    }
    return list;
  }

  /**
   * 生成最近色查找函数。
   * @param {Array<{r,g,b,lab?}>} list
   * @returns {(r:number,g:number,b:number)=>number}
   */
  function makeNearest(list) {
    withLab(list);
    const labs = list.map((c) => c.lab);
    const n = labs.length;
    return function nearest(r, gg, b) {
      const L = rgbToLab(r, gg, b);
      let best = 0, bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const p = labs[i];
        const dL = L.L - p.L, da = L.a - p.a, db = L.b - p.b;
        const d = dL * dL + da * da + db * db;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };
  }

  /** 已经有 Lab 的查询版本，省一次转换 */
  function makeNearestLab(list) {
    withLab(list);
    const labs = list.map((c) => c.lab);
    const n = labs.length;
    return function nearestLab(L, a, b) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const p = labs[i];
        const dL = L - p.L, da = a - p.a, db = b - p.b;
        const d = dL * dL + da * da + db * db;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };
  }

  g.PBColor = {
    clamp,
    hexToRgb,
    rgbToHex,
    srgbToLinear,
    linearToSrgb,
    rgbToLab,
    labToRgb,
    deltaE76,
    deltaE2000,
    luminance,
    readableOn,
    adjust,
    withLab,
    makeNearest,
    makeNearestLab
  };
})(typeof window !== 'undefined' ? window : globalThis);

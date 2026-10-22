/* ============================================================
 * 由 tools/data/palettes-brands.json 生成 js/palettes.brands.js
 * 数据来源：https://github.com/HansBug/pindou-color-data （CC BY 4.0）
 * 用法：node tools/build-palettes.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'data', 'palettes-brands.json');
const OUT = path.join(ROOT, 'js', 'palettes.brands.js');

/** 要放进下拉框的品牌（顺序即显示顺序），src 对应抓取时的 id */
const WANT = [
  { src: 'mardDoudou', id: 'mard221', name: 'MARD 221（马得）', desc: '马得 5mm 常用 221 色 · 社区推荐参考' },
  { src: 'mard291', id: 'mard291', name: 'MARD 291（马得·全色）', desc: '马得 5mm 全色 291 色' },
  { src: 'artkal197', id: 'artkal197', name: 'Artkal C 197（优肯）', desc: '优肯 Artkal C 系列 5mm · 官方 197 色' },
  { src: 'artkalm221', id: 'artkalm221', name: 'Artkal M 221（优肯·mini）', desc: '优肯 Artkal M 系列 2.6mm · 221 色' },
  { src: 'artkal418', id: 'artkal418', name: 'Artkal 418（优肯·全量）', desc: '优肯 C197 + M221 全量 418 色' },
  { src: 'coco291', id: 'coco291', name: 'COCO 291', desc: 'COCO 2.6mm mini · 291 色' },
  { src: 'manman278', id: 'manman278', name: '漫漫 278（漫漫家）', desc: '漫漫家 5mm · 278 色' },
  { src: 'mixiaowo290', id: 'mixiaowo290', name: '咪小窝 290', desc: '咪小窝 5mm · 290 色' },
  { src: 'panpan289', id: 'panpan289', name: '盼盼 289（盼盼家）', desc: '盼盼家 5mm · 289 色' }
];

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const byId = new Map(raw.brands.map((b) => [b.id, b]));

const HEX6 = /^#[0-9A-Fa-f]{6}$/;
const HEX8 = /^#[0-9A-Fa-f]{8}$/;

/** #RRGGBB 直接可用；#RRGGBBAA（半透明豆）按白底合成到 6 位 */
function normHex(value) {
  const h = String(value).toUpperCase();
  if (HEX6.test(h)) return h;
  if (HEX8.test(h)) {
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    const a = parseInt(h.slice(7, 9), 16) / 255;
    const mix = (c) => Math.round(c * a + 255 * (1 - a)).toString(16).padStart(2, '0').toUpperCase();
    return '#' + mix(r) + mix(g) + mix(b);
  }
  return null;
}

const sets = [];
for (const w of WANT) {
  const brand = byId.get(w.src);
  if (!brand) {
    console.warn('! 缺少数据：' + w.src);
    continue;
  }
  const colors = [];
  const seen = new Set();
  brand.colors.forEach(([code, hex]) => {
    const h = normHex(hex);
    if (!h) return;
    const key = String(code);
    if (seen.has(key)) return;
    seen.add(key);
    colors.push([key, h]);
  });
  if (!colors.length) {
    console.warn('! 无有效颜色：' + w.src);
    continue;
  }
  sets.push({ id: w.id, name: w.name, desc: w.desc, colors });
}

const payload = {
  source: 'https://github.com/HansBug/pindou-color-data',
  license: 'CC BY 4.0',
  fetchedAt: raw.fetchedAt || '',
  note: 'HEX 为社区整理的产品图/色卡近似值，非分光测色；下单前请对照实体色卡。',
  sets
};

const lines = [];
lines.push('/* ============================================================');
lines.push(' * 拼豆工坊 · 品牌色卡数据（自动生成，请勿手改）');
lines.push(' * 生成：node tools/build-palettes.js');
lines.push(' * 数据来源：' + payload.source);
lines.push(' * 许可：' + payload.license + '（保留署名即可使用）');
lines.push(' * 抓取时间：' + payload.fetchedAt);
lines.push(' * ' + payload.note);
lines.push(' * ============================================================ */');
lines.push('(function (g) {');
lines.push("  'use strict';");
lines.push('  g.PB_BRANDS = {');
lines.push('    source: ' + JSON.stringify(payload.source) + ',');
lines.push('    license: ' + JSON.stringify(payload.license) + ',');
lines.push('    fetchedAt: ' + JSON.stringify(payload.fetchedAt) + ',');
lines.push('    sets: [');

sets.forEach((s, i) => {
  lines.push('      {');
  lines.push('        id: ' + JSON.stringify(s.id) + ',');
  lines.push('        name: ' + JSON.stringify(s.name) + ',');
  lines.push('        desc: ' + JSON.stringify(s.desc) + ',');
  lines.push('        colors: [');
  const per = 6;
  for (let k = 0; k < s.colors.length; k += per) {
    const chunk = s.colors.slice(k, k + per)
      .map(([code, hex]) => '[' + JSON.stringify(code) + ',' + JSON.stringify(hex) + ']')
      .join(', ');
    lines.push('          ' + chunk + (k + per < s.colors.length ? ',' : ''));
  }
  lines.push('        ]');
  lines.push('      }' + (i < sets.length - 1 ? ',' : ''));
});

lines.push('    ]');
lines.push('  };');
lines.push("})(typeof window !== 'undefined' ? window : globalThis);");
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log('✓ js/palettes.brands.js  ' + sets.length + ' 套色卡，共 ' +
  sets.reduce((n, s) => n + s.colors.length, 0) + ' 色，' + kb + ' KB');
sets.forEach((s) => console.log('   · ' + s.name.padEnd(26) + s.colors.length + ' 色'));

/* ============================================================
 * 打包脚本：把 index.html + css + js 合成一个可直接双击的单文件
 * 用法：node tools/build-single.js
 * 产物：
 *   dist/拼豆工坊.html      单文件版（发给别人，双击即用）
 *   dist/site/              静态站点文件（传 GitHub Pages / Netlify 用）
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE = path.join(DIST, 'site');

const BANNER = [
  '<!--',
  '  拼豆工坊 · 单文件版',
  '  用法：双击用 Chrome / Edge 打开；点「示例图」可直接看效果，',
  '       点「导入图片」选一张照片即可生成图纸。所有计算都在本机完成。',
  '  兼容：Chrome / Edge / Firefox 最新版',
  '-->'
].join('\n');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ---------- 1. 单文件版 ---------- */
let html = read('index.html');

html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (m, href) => {
  return '<style>\n' + read(href).trim() + '\n</style>';
});

html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (m, src) => {
  const js = read(src).replace(/<\/script/gi, '<\\/script');
  return '<script>\n' + js.trim() + '\n</script>';
});

if (/<script\s+src=|<link[^>]+stylesheet/.test(html)) {
  console.error('× 还有外链资源没被内联，请检查 index.html');
  process.exit(1);
}

html = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + BANNER);

ensureDir(DIST);
const singleOut = path.join(DIST, '拼豆工坊.html');
fs.writeFileSync(singleOut, html, 'utf8');

/* ---------- 2. 静态站点（托管用） ---------- */
ensureDir(path.join(SITE, 'css'));
ensureDir(path.join(SITE, 'js'));

fs.writeFileSync(path.join(SITE, 'index.html'), read('index.html').replace(
  '<title>拼豆工坊 · 图片转拼豆图纸</title>',
  '<title>拼豆工坊 · 图片转拼豆图纸</title>'
), 'utf8');
fs.copyFileSync(path.join(ROOT, 'css', 'app.css'), path.join(SITE, 'css', 'app.css'));

const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
jsFiles.forEach((f) => fs.copyFileSync(path.join(ROOT, 'js', f), path.join(SITE, 'js', f)));

/* ---------- 3. 给朋友的一句话说明 ---------- */
const guide = [
  '拼豆工坊 · 怎么用',
  '',
  '1. 双击「拼豆工坊.html」，用 Chrome 或 Edge 打开（打不开就右键 → 打开方式 → 选浏览器）。',
  '   第一次打开会有一个三步引导，点「知道了」就行。',
  '2. 想看效果：点右上角「示例图」。用自己的图：点「导入图片」，或把图片拖进页面、Ctrl+V 粘贴。',
  '3. 简单模式下只用管两个滑块：',
  '   · 图多大（58 ≈ 29 cm 见方，正好一块标准拼豆板）',
  '   · 颜色精简程度（往右拉颜色更少、更好买豆；上面会给一个建议色数）',
  '4. 右边会显示总豆数、大概要做多久；下面的「购买清单」就是按色号买豆的清单，',
  '   点一行可以只看这个颜色，「换」可以把缺货的颜色换成相近的。',
  '5. 导出：点「导出图纸（含打印）」，选「发微信 / 打印 / 高清」，再点「导出 PNG」。',
  '   要打印就点「打印」，会先告诉你一共几页；打印对话框里选「另存为 PDF」就能发打印店。',
  '',
  '6. 想只留主体、不要背景：勾选「去掉背景」（白底/纯色背景效果最好，背景会变成镂空不排豆）。',
  '7. 调崩了别慌：左上角可以「撤销 / 重做」，导出卡片下面有「恢复默认设置」。',
  '8. 想继续改：点「保存图纸」存到浏览器，下次点「我的图纸」打开。',
  '',
  '所有处理都在你自己的电脑/手机里完成，图片不会上传到任何服务器。',
  '',
  '小提示：手机上也能用，点一下格子就能看坐标和色号。'
].join('\r\n');

fs.writeFileSync(path.join(DIST, '使用说明-给朋友.txt'), guide, 'utf8');

/* ---------- 结果 ---------- */
const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + ' KB';
console.log('✓ ' + path.relative(ROOT, singleOut) + '  (' + kb(singleOut) + ')');
console.log('✓ ' + path.relative(ROOT, path.join(DIST, '使用说明-给朋友.txt')));
console.log('✓ dist/site/  (' + (jsFiles.length + 2) + ' 个文件，用于静态托管)');

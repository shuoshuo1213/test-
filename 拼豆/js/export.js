/* ============================================================
 * 拼豆工坊 · 导出
 *  PNG 图纸 / CSV 配色表 / 项目 JSON / 浏览器打印
 * ============================================================ */
(function (g) {
  'use strict';

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败，画布可能过大'))), type || 'image/png', quality);
      } else {
        try {
          const data = canvas.toDataURL(type || 'image/png');
          const bin = atob(data.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: type || 'image/png' }));
        } catch (e) { reject(e); }
      }
    });
  }

  function exportPng(canvas, filename) {
    return canvasToBlob(canvas, 'image/png').then((blob) => download(blob, filename));
  }

  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /** 配色统计 CSV（带 BOM，Excel 中文不乱码） */
  function buildCsv(pat, extra) {
    const lines = [];
    lines.push('序号,色号,名称,HEX,R,G,B,数量,占比');
    pat.palette.forEach((p, i) => {
      lines.push([
        i + 1,
        p.code,
        '"' + p.name.replace(/"/g, '""') + '"',
        p.hex,
        p.r, p.g, p.b,
        p.count,
        (p.count / (pat.total || 1) * 100).toFixed(2) + '%'
      ].join(','));
    });
    lines.push('');
    lines.push('合计,,' + pat.palette.length + ' 色,,,,' + pat.total + ',100%');
    if (extra) extra.forEach((x) => lines.push(x.join(',')));
    return '\ufeff' + lines.join('\r\n');
  }

  function exportCsv(pat, filename, extra) {
    const blob = new Blob([buildCsv(pat, extra)], { type: 'text/csv;charset=utf-8' });
    download(blob, filename);
  }

  function exportJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
    download(blob, filename);
  }

  /** 打印：把每页图纸放进隐藏 iframe 打印 */
  function printCanvases(canvases, title) {
    if (!canvases.length) return Promise.reject(new Error('没有可打印的内容'));
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const imgs = canvases.map((c) => c.toDataURL('image/png'));

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + (title || '拼豆图纸') + '</title>' +
      '<style>' +
      '@page{size:auto;margin:8mm}' +
      'html,body{margin:0;padding:0;background:#fff}' +
      'img{display:block;width:100%;height:auto;page-break-after:always;break-after:page}' +
      'img:last-child{page-break-after:auto;break-after:auto}' +
      '</style></head><body>' +
      imgs.map((src) => '<img src="' + src + '">').join('') +
      '</body></html>';

    doc.open();
    doc.write(html);
    doc.close();

    const done = new Promise((resolve) => {
      const finish = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) { /* 用户取消 */ }
          setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1500);
          resolve(true);
        }, 120);
      };
      const list = doc.querySelectorAll('img');
      let pending = list.length;
      if (!pending) { finish(); return; }
      list.forEach((img) => {
        if (img.complete) { if (--pending === 0) finish(); }
        else {
          img.onload = img.onerror = () => { if (--pending === 0) finish(); };
        }
      });
    });
    return done;
  }

  g.PBExport = { download, canvasToBlob, exportPng, exportCsv, exportJson, buildCsv, printCanvases, timestamp };
})(typeof window !== 'undefined' ? window : globalThis);

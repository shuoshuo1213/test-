/* 极简 Canvas 2D 上下文替身：只为在 Node 里跑通绘制逻辑，不做真实像素输出 */
'use strict';

function makeContext(canvas) {
  const ctx = {
    canvas,
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    calls: { fillRect: 0, strokeRect: 0, fillText: 0, stroke: 0, fill: 0 },
    texts: [],
    _stack: [],

    setTransform() {},
    save() { this._stack.push(this.font); },
    restore() { this.font = this._stack.pop() || this.font; },
    clearRect() {},
    fillRect() { this.calls.fillRect++; },
    strokeRect() { this.calls.strokeRect++; },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    ellipse() {},
    stroke() { this.calls.stroke++; },
    fill() { this.calls.fill++; },
    clip() {},
    drawImage() {},
    fillText(text, x, y) {
      this.calls.fillText++;
      this.texts.push({ text: String(text), x, y, font: this.font, fill: this.fillStyle });
    },
    strokeText() { this.calls.fillText++; },
    setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    getImageData(x, y, w, h) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData() {},
    measureText(text) {
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
      const size = m ? parseFloat(m[1]) : 10;
      return { width: String(text).length * size * 0.6 };
    },
    toDataURL() { return 'data:image/png;base64,'; }
  };
  return ctx;
}

function makeCanvas(w, h) {
  const canvas = {
    width: w || 300,
    height: h || 150,
    style: {},
    getContext() { return canvas._ctx || (canvas._ctx = makeContext(canvas)); },
    toDataURL() { return 'data:image/png;base64,'; },
    toBlob(cb) { cb && cb(null); }
  };
  return canvas;
}

module.exports = { makeCanvas, makeContext };

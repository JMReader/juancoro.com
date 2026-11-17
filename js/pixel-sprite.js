/* pixel-sprite.js — runtime mínimo para sprite sheets de pixel art en <canvas>.
 * Sin dependencias. Uso:
 *
 *   const spr = new PixelSprite({
 *     sheet: img,            // HTMLImageElement o canvas con el sheet
 *     frameW: 32, frameH: 32, cols: 6, rows: 1,
 *     animations: {
 *       idle: { frames: [0, 1], fps: 2, loop: 'loop' },
 *       walk: { frames: [2, 3, 4, 5], durations: [120, 120, 120, 120], loop: 'loop' },
 *       jump: { frames: [6, 7], loop: 'once' },
 *     },
 *     scale: 4,              // px de pantalla por px de arte
 *     anchor: 'bottom-center'// o 'center'
 *   });
 *   spr.play('walk');
 *   // en el game loop:
 *   spr.update(dtMs);
 *   spr.draw(ctx, x, y, { flip: dir < 0 });   // x,y = punto de anclaje en px de arte
 *
 * durations (ms por frame) pisa a fps — el timing no uniforme es lo que da vida.
 * loop: 'loop' (default) | 'once' (queda en el último frame) | 'pingpong'.
 *
 * SpriteStack (pseudo-3D por slices, de spritecook.ai/blog/sprite-stacking-pixel-art):
 *
 *   const stack = new SpriteStack({ sheet: slicesImg, slices: 15, sliceW: 24, sliceH: 43, scale: 8 });
 *   stack.draw(ctx, x, y, { turn: anguloRad });   // x,y = punto de contacto con el suelo
 */
'use strict';

class PixelSprite {
  constructor(o) {
    this.sheet = o.sheet;
    this.frameW = o.frameW;
    this.frameH = o.frameH;
    this.cols = o.cols || 1;
    this.rows = o.rows || 1;
    this.scale = o.scale || 4;
    this.anchor = o.anchor || 'bottom-center';
    this.anims = o.animations || {};
    if (!Object.keys(this.anims).length) {
      const frames = [];
      for (let i = 0; i < this.cols * this.rows; i++) frames.push(i);
      this.anims.default = { frames, fps: o.fps || 8, loop: 'loop' };
    }
    for (const k in this.anims) {
      const an = this.anims[k];
      an.frames = an.frames || [];
      an.loop = an.loop || 'loop';
      an.fps = an.fps || 8;
      if (!an.frames.length) {
        for (let i = 0; i < this.cols * this.rows; i++) an.frames.push(i);
      }
    }
    this.current = 'default' in this.anims ? 'default' : Object.keys(this.anims)[0];
    this.idx = 0;
    this.acc = 0;
    this.dir = 1;
    this.done = false;
  }

  play(name, restart = true) {
    if (!this.anims[name]) return;
    if (restart || this.current !== name) { this.idx = 0; this.acc = 0; this.dir = 1; this.done = false; }
    this.current = name;
  }

  stop() { this.done = true; }

  _frameAt(an) {
    return an.frames[this.idx];
  }

  _advance(an, dtMs) {
    if (this.done && an.loop === 'once') return;
    this.acc += dtMs;
    const durs = an.durations;
    const step = () => {
      if (durs && durs.length) return durs[this.idx % durs.length];
      return 1000 / an.fps;
    };
    while (this.acc >= step()) {
      this.acc -= step();
      const n = an.frames.length;
      if (n <= 1) break;
      if (an.loop === 'once') {
        if (this.idx >= n - 1) { this.idx = n - 1; this.done = true; break; }
        this.idx++;
      } else if (an.loop === 'pingpong') {
        this.idx += this.dir;
        if (this.idx >= n) { this.idx = n - 2; this.dir = -1; }
        else if (this.idx < 0) { this.idx = 1; this.dir = 1; }
      } else {
        this.idx = (this.idx + 1) % n;
      }
    }
  }

  update(dtMs) {
    this._advance(this.anims[this.current], dtMs);
  }

  draw(ctx, x, y, opts = {}) {
    const an = this.anims[this.current];
    const f = this._frameAt(an);
    const sx = (f % this.cols) * this.frameW;
    const sy = Math.floor(f / this.cols) * this.frameH;
    const S = this.scale;
    const dw = this.frameW * S, dh = this.frameH * S;
    const px = Math.round(x * S), py = Math.round(y * S);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    ctx.translate(px, py);
    if (opts.flip) ctx.scale(-1, 1);
    const dx = -Math.floor(dw / 2);
    const dy = this.anchor === 'center' ? -Math.floor(dh / 2) : -dh;
    ctx.drawImage(this.sheet, sx, sy, this.frameW, this.frameH, dx, dy, dw, dh);
    ctx.restore();
  }

  /* Atajo: dibuja en coordenadas de pantalla (px de dispositivo), no de arte. */
  drawScreen(ctx, px, py, opts = {}) {
    this.draw(ctx, px / this.scale, py / this.scale, opts);
  }
}

class SpriteStack {
  constructor(o) {
    this.sheet = o.sheet;
    this.slices = o.slices;
    this.sliceW = o.sliceW;
    this.sliceH = o.sliceH;
    this.squash = o.squash != null ? o.squash : 0.75;
    this.spacing = o.spacing != null ? o.spacing : 1;
    this.scale = o.scale || 4;
  }

  /* x,y = punto donde el objeto toca el suelo (px de arte). turn en radianes. */
  draw(ctx, x, y, opts = {}) {
    const turn = opts.turn || 0;
    const S = this.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.scale(S, S);
    ctx.translate(Math.round(x), Math.round(y));
    for (let z = 0; z < this.slices; z++) {
      ctx.save();
      ctx.translate(0, -Math.round(z * this.spacing));
      ctx.scale(1, this.squash);
      ctx.rotate(turn);
      ctx.drawImage(this.sheet, z * this.sliceW, 0, this.sliceW, this.sliceH,
                    -Math.floor(this.sliceW / 2), -Math.floor(this.sliceH / 2),
                    this.sliceW, this.sliceH);
      ctx.restore();
    }
    ctx.restore();
  }
}

/* Carga un directorio producido por pixelize.py (manifest.json + sheet.png). */
async function loadSprite(dirUrl) {
  const base = dirUrl.endsWith('/') ? dirUrl : dirUrl + '/';
  const [manifest, img] = await Promise.all([
    fetch(base + 'manifest.json').then(r => r.json()),
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = base + 'sheet.png';
    }),
  ]);
  const spr = new PixelSprite({
    sheet: img,
    frameW: manifest.frame_w, frameH: manifest.frame_h,
    cols: manifest.cols, rows: manifest.rows,
    scale: manifest.scale || 4,
    anchor: manifest.anchor || 'bottom-center',
    animations: manifest.animations || undefined,
    fps: manifest.fps_default || 8,
  });
  return { sprite: spr, manifest };
}

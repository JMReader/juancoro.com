/* ============================================================================
 * koi.js — Agente Animaciones (demo-day "CÓMO SER MANIJA CAMBIA VIDAS")
 * Canvas #fx (z=2): kois, splash/burst ASCII, ripples y letras arrastradas.
 *
 * Consume el contrato window.OCEAN (si existe):
 *   OCEAN.surfaceY(x, tMs) -> y px de la superficie en columna x
 *   OCEAN.splash(x, power) -> splash nativo del fondo (power 0..1)
 * Si no hay OCEAN, usa una superficie plana de fallback (solo para desarrollo).
 *
 * API pública:
 *   await KOI.init({ canvas, assetsBase, ocean })
 *   KOI.playIntro(done)          — nadan → cruzan → picado → doble splash → cb
 *   KOI.skipIntro()
 *   KOI.leap({koi,dir,apex,chars,hooks}, done)   — un salto (pieza clave)
 *   KOI.leapTransition(i,{chars,hooks}, done)    — alterna koi/dir + apex[i]
 *   KOI.leapDouble({apex,chars,hooks}, done)     — cierre taijitu, 2 kois
 *   KOI.advance()                — interrumpe limpio: salta al estado final
 *   KOI.collectChars(el)         — DOM → [{ch,x,y,w,h,font,el}]
 *   KOI.setDirMode('alternate'|'ltr')            — flag KOI_DIR del spec
 *   KOI.state                    — 'idle' | 'intro' | 'leap' | 'leap2'
 *
 * chars: [{ch, x, y, w, h, font, el?}] en px de viewport (x,y = top-left del
 * box del carácter). KOI dibuja los chars salientes en #fx; el DOM debe
 * ocultarlos (ver collectChars/hideChars) y escuchar hooks.onEmerge para
 * hacer emerger los chars entrantes donde cayó el pez.
 *
 * hooks: { onSplash(x,power,'out'|'in'), onCharRelease(i,char),
 *          onEmerge(x, surfY), onDone }
 *
 * Determinista: timestep fijo 1/60 + RNG mulberry32 re-seedeado por escena.
 * B&W puro. Vanilla JS + pixel-sprite.js (loadSprite).
 * ========================================================================== */
'use strict';
window.KOI = (() => {

  /* ---------------- utils ---------------- */
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut  = t => 1 - Math.pow(1 - t, 3);
  const easeIn   = t => t * t * t;
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const smooth = t => t * t * (3 - 2 * t);

  function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  /* hash determinista por índice (para staggers/jitter sin consumir rng) */
  const hashI = i => {
    let h = 2166136261 ^ Math.imul(i + 1, 2654435761);
    h = Math.imul(h ^ h >>> 13, 16777619); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  /* ---------------- config ---------------- */
  const CFG = {
    frameW: 96, frameH: 96, cols: 4,
    swimScale: 2.15,          // px pantalla por px de arte nadando
    leapScaleMin: 1.35,       // × swimScale en salto de apex bajo
    leapScaleMax: 1.8,        // × swimScale en salto de apex 100%
    flightT: 0.82,            // s de vuelo (arco asimétrico en dos tramos)
    windupT: 0.14,            // s de anticipación (dip + breach)
    entryT: 0.42,             // s de sumersión (plunge → tail-whip → fade)
    /* arco asimétrico: apex a 46% del TIEMPO (sube rápido, cae largo) y a
       60% del RECORRIDO (la bajada es empinada hacia el punto de entrada) */
    apexT: 0.46, apexX: 0.60,
    riseLinX: 0.38,           // mezcla lineal en x subida → vel residual en apex
    risePowX: 1.55,
    fallLinX: 0.45,           // x bajada: easeIn → cae casi vertical al inicio
    fallPowX: 1.75,
    risePowY: 1.55,           // y subida: tensa/rápida, redondea al apex
    fallPowY: 2.05,           // y bajada: hang en la cresta → acelera (gravedad)
    /* agua: el impacto recorta la velocidad y luego frena por componente
       (dragX > dragY → el heading rota solo a vertical bajo la superficie) */
    vInX: 0.55, vInY: 0.50,
    dragX: 11.0, dragY: 5.5,
    staggerMin: 0.060,        // s — delay min tras el morro (spec 60–90ms)
    staggerMax: 0.092,
    surfaceFallback: 0.72,    // ×H si no hay OCEAN
    seed: 0xB1B0C0,           // seed base fija
  };
  const APEXS = [20, 30, 40, 55, 70, 85, 100];  // spec: apex progresivo %
  /* Ángulo (deg, y-down) hacia donde apunta la nariz EN EL ARTE de cada frame.
   * swim = 180 (nariz a -x). Del sheet compuesto 4×2. */
  const NOSE = { 0: 180, 1: 180, 2: 180, 3: 230, 4: 200, 5: 122, 6: 90, 7: 270 };
  const F = { SWIM0: 0, LEAP_UP: 3, LEAP_ARC: 4, LEAP_DOWN: 5, DIVE: 6, BREACH: 7 };
  const GLYPHS = '·.:*˘~oO°\'`';

  /* ---------------- módulo ---------------- */
  let cv, ctx, vw = 0, vh = 0, dpr = 1;
  let ocean = null;                    // window.OCEAN o fallback
  let sprites = { black: null, white: null };
  let ready = false;

  let scene = null;                    // escena activa (state machine)
  let running = false, last = 0, acc = 0;
  const STEP = 1 / 60;

  let parts = [];                      // partículas glyph (splash/burst)
  let ripples = [];                    // anillos expansivos
  let dirMode = (typeof window !== 'undefined' && window.KOI_DIR) || 'alternate';

  const tNow = () => performance.now();
  /* reloj interno del océano (s) — el t que espera surfaceY */
  const oceanT = () => (ocean && typeof ocean.time === 'function')
    ? ocean.time() : tNow() / 1000;

  function surf(x, t) {
    if (ocean && typeof ocean.surfaceY === 'function') {
      /* el t de surfaceY es el RELOJ INTERNO del océano (s), no wall-ms:
         usar OCEAN.time() si existe; si no, segundos desde epoch de perf */
      const tt = t != null ? t
        : (typeof ocean.time === 'function' ? ocean.time() : tNow() / 1000);
      try { return ocean.surfaceY(x, tt); } catch (e) { /* fallthrough */ }
    }
    return vh * CFG.surfaceFallback;   // fallback plano (dev only)
  }
  function nativeSplash(x, power) {
    if (ocean && typeof ocean.splash === 'function') {
      try { ocean.splash(x, power); } catch (e) { /* noop */ }
    }
  }

  /* ---------------- sprites ---------------- */
  function frameRect(i) {
    return [(i % CFG.cols) * CFG.frameW, ((i / CFG.cols) | 0) * CFG.frameH];
  }
  function curFrame(k) {
    const an = k.spr.anims[k.spr.current];
    return an.frames[k.spr.idx % an.frames.length];
  }

  function makeKoi(name) {
    return {
      name, spr: sprites[name],
      x: 0, y: 0, theta: null, rotOff: 0,
      mirror: false, scale: CFG.swimScale, stretch: 0,
      frame: 0, alpha: 1, visible: false, swimOn: false, diveDim: null,
    };
  }

  /* Dibuja un koi con rotación tangente al movimiento + flip + squash/stretch.
   * k.theta = ángulo de la velocidad (world, y-down). La nariz baked del frame
   * (NOSE[frame]) se alinea con theta: r = mirror ? θ-π+n : θ-n  (ver spec). */
  function drawKoi(c, k) {
    if (!k.visible || k.alpha <= 0) return;
    const m = k.mirror ? -1 : 1;
    const n = (NOSE[k.frame] != null ? NOSE[k.frame] : 180) * DEG;
    const r = k.theta != null
      ? (m > 0 ? k.theta - n : k.theta - Math.PI + n) + (k.rotOff || 0)
      : (k.rotOff || 0);
    const e = k.stretch || 0;
    c.save();
    c.translate(Math.round(k.x), Math.round(k.y));
    c.rotate(r);
    c.scale(m * k.scale * (1 + e), k.scale * (1 - e * 0.85));
    c.globalAlpha = clamp(k.alpha, 0, 1);
    c.imageSmoothingEnabled = false;
    const [sx, sy] = frameRect(k.frame);
    c.drawImage(k.spr.sheet, sx, sy, CFG.frameW, CFG.frameH, -48, -48, 96, 96);
    c.restore();
  }

  /* Dibuja el koi CORTADO por la línea de agua: la parte bajo la superficie
     se atenúa (dim) → la nariz desaparece bajo el agua mientras la cola
     queda visible un instante sobre la línea (sumersión real, sin arte
     nuevo: es clip + alpha, no otro sprite). */
  function drawKoiWater(c, k, dim) {
    if (!k.visible || k.alpha <= 0) return;
    const ys = surf(k.x);
    const half = 52 * k.scale;               // media envergadura del sprite
    const d = dim != null ? dim : (k.diveDim != null ? k.diveDim : 0.45);
    if (k.y + half <= ys) { drawKoi(c, k); return; }        // todo arriba
    const a0 = k.alpha;
    c.save(); c.beginPath(); c.rect(0, ys, vw, vh - ys); c.clip();
    k.alpha = a0 * d; drawKoi(c, k); k.alpha = a0;
    c.restore();
    if (k.y - half >= ys) return;                           // del todo abajo
    c.save(); c.beginPath(); c.rect(0, 0, vw, ys); c.clip();
    drawKoi(c, k);
    c.restore();
  }

  /* ---------------- fx: splash, ripples, glyphs ---------------- */
  function fxSplash(x, power, rng) {
    const y = surf(x);
    nativeSplash(x, power);
    /* burst de glyphs claros (ASCII) en cono ascendente */
    const n = Math.round(10 + 16 * power);
    for (let i = 0; i < n; i++) {
      const a = (-90 + (rng() - 0.5) * 110) * DEG;
      const v = (140 + rng() * 380) * (0.55 + 0.6 * power);
      parts.push({
        kind: 'g', g: GLYPHS[(rng() * GLYPHS.length) | 0],
        x: x + (rng() - 0.5) * 26, y: y - 4,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g_: 980, life: 0, ttl: 0.5 + rng() * 0.55,
        size: 11 + rng() * 15, spin: (rng() - 0.5) * 6, rot: rng() * 6.28,
      });
    }
    /* droplets pixel (cuadrados finos) */
    for (let i = 0; i < Math.round(6 * power); i++) {
      const a = (-90 + (rng() - 0.5) * 80) * DEG;
      const v = (240 + rng() * 420) * (0.5 + 0.6 * power);
      parts.push({
        kind: 'd', x, y: y - 2,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g_: 1100, life: 0, ttl: 0.4 + rng() * 0.4,
        size: 2 + rng() * 3,
      });
    }
    /* columna de agua PROPORCIONAL a la energía de entrada: más power →
       más pilares, más altos y más veloces (el "spout" que sigue al pez) */
    if (power > 0.55) {
      const ncol = Math.round(2 + 6 * power);
      for (let i = 0; i < ncol; i++) {
        parts.push({
          kind: 'col', x: x + (rng() - 0.5) * 34, y: y - 2,
          vx: (rng() - 0.5) * 60, vy: -(240 + rng() * 340) * (0.4 + 0.8 * power),
          g_: 1250, life: 0, ttl: 0.55 + rng() * 0.3,
          size: 3 + rng() * 4 * (0.5 + power),
        });
      }
    }
    /* ripples concéntricos (2) */
    for (let i = 0; i < 2; i++) {
      ripples.push({ x, y, r: 12 + i * 10, vr: 300 + i * 130, life: 0, ttl: 0.55 + i * 0.18, w: 2.5 - i });
    }
  }

  /* columna de agua alta (picada teatral): pilares anchos que suben ~1 frame
     alto de sprite antes de desplomarse */
  function fxGeyser(x, rng) {
    const y = surf(x);
    for (let i = 0; i < 4; i++) {
      parts.push({
        kind: 'col', x: x + (rng() - 0.5) * 18, y: y - 2,
        vx: (rng() - 0.5) * 46, vy: -(420 + rng() * 330),
        g_: 1500, life: 0, ttl: 0.55 + rng() * 0.25, size: 5 + rng() * 5,
      });
    }
  }
  /* ripple suelto (segunda onda de la picada / gota de letra al agua) */
  function fxRipple(x, s) {
    s = s || 1;
    ripples.push({ x, y: surf(x), r: 10 * s, vr: 340 * s, life: 0, ttl: 0.9, w: 2.2 * s });
  }

  function stepFx(dt) {
    for (const p of parts) {
      p.life += dt;
      if (p.kind === 'b') {               // burbuja: flota, mece, pop en la línea
        p.vy += p.g_ * dt;                // g_ negativo = empuje hacia arriba
        p.vy *= Math.exp(-0.9 * dt);      // drag → ascenso con terminal suave
        p.x += p.vx * dt + Math.sin(p.life * p.sw + p.ph) * p.swA * dt;
        p.y += p.vy * dt;
        if (p.y < surf(p.x) + 2) p.life = p.ttl;   // toca superficie → pop
        continue;
      }
      p.vy += p.g_ * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.spin) p.rot += p.spin * dt;
    }
    parts = parts.filter(p => p.life < p.ttl);
    for (const r of ripples) { r.life += dt; r.r += r.vr * dt; r.vr *= 0.92; }
    ripples = ripples.filter(r => r.life < r.ttl);
  }

  function drawFx(c) {
    c.save();
    for (const r of ripples) {
      const k = 1 - r.life / r.ttl;
      c.globalAlpha = 0.55 * k;
      c.strokeStyle = '#f2f2f2';
      c.lineWidth = Math.max(1, r.w * k);
      c.beginPath();
      c.ellipse(r.x, r.y, r.r, r.r * 0.30, 0, Math.PI, 2 * Math.PI);
      c.stroke();
      c.beginPath();
      c.ellipse(r.x, r.y, r.r * 0.62, r.r * 0.62 * 0.30, 0, Math.PI, 2 * Math.PI);
      c.stroke();
    }
    for (const p of parts) {
      const k = 1 - p.life / p.ttl;
      c.globalAlpha = Math.min(1, k * 1.6);
      if (p.kind === 'g') {
        c.font = `bold ${p.size | 0}px ui-monospace, monospace`;
        c.fillStyle = '#f5f5f5';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot || 0);
        c.fillText(p.g, 0, 0); c.restore();
      } else if (p.kind === 'col') {
        c.fillStyle = '#e8e8e8';
        const hgt = p.size * 2.4;
        c.fillRect((p.x - p.size / 2) | 0, p.y | 0, p.size | 0, hgt | 0);
      } else if (p.kind === 'b') {
        /* burbuja pixel: cuadrado hueco que sube meciéndose tras la entrada */
        c.strokeStyle = '#d8d8d8'; c.lineWidth = 1.5;
        const bs = p.size | 0;
        c.strokeRect((p.x - bs) | 0, (p.y - bs) | 0, bs * 2, bs * 2);
      } else {
        c.fillStyle = '#eaeaea';
        c.fillRect(p.x | 0, p.y | 0, p.size | 0, p.size | 0);
      }
    }
    c.restore();
  }

  /* ---------------- escena base ---------------- */
  function runScene(s) {
    if (scene && !scene.dead) scene.finish();       // interrumpe limpio
    scene = s; KOI.state = s.name;
    startLoop();
  }

  function baseScene(name, cb) {
    return {
      name, t: 0, dead: false, cb, _cbFired: false,
      events: [],                        // {t, fn, fired} ordenados por t
      schedule(t, fn) { this.events.push({ t, fn, fired: false }); this.events.sort((a, b) => a.t - b.t); },
      fireDue() {
        for (const e of this.events) if (!e.fired && this.t >= e.t - 1e-9) { e.fired = true; e.fn(); }
      },
      done() {
        if (this._cbFired) return; this._cbFired = true;
        const f = this.cb; this.cb = null; f && f();
      },
      finish() {                         // flush determinista de pendientes
        if (this.dead) return;
        this.dead = true;                // antes de fireDue: evita re-entrada
        this.t = this.ttl != null ? this.ttl : this.t;
        this.fireDue();
        this.snapEnd && this.snapEnd();
        if (scene === this) { scene = null; KOI.state = 'idle'; }
        this.done();
      },
    };
  }

  /* ---------------- trayectoria del salto ----------------
   * Arco ASIMÉTRICO en dos tramos (no parábola simétrica):
   *   subida (u ∈ [0, UA]):  x e y easeOut → gana altura rápido y tenso,
   *                          conserva velocidad residual al llegar al apex
   *   bajada (u ∈ [UA, 1]):  y = w^fallPowY → corona colgada y ACELERA en
   *                          una caída larga; x easeIn → arranca casi
   *                          vertical y recupera deriva hacia x1 al final
   * Apex desplazado a apexX (~60%) del recorrido → la caída cubre menos
   * horizontal y cae más empinada: "sube más y se clava con arco real".
   * Devuelve par/vel analíticos + vIn (velocidad de entrada al agua) +
   * uOfX (inversa numérica de x(u): u ya no es proporcional a x). */
  function makeArc(x0, x1, ys0, ys1, H, T) {
    const UA = CFG.apexT, XA = CFG.apexX;
    const xA = lerp(x0, x1, XA), yA = (ys0 + ys1) / 2 - H;
    const RX = CFG.riseLinX, RP = CFG.risePowX;
    const FX = CFG.fallLinX, FP = CFG.fallPowX;
    const RY = CFG.risePowY, FY = CFG.fallPowY;
    const exR = v => RX * v + (1 - RX) * (1 - Math.pow(1 - v, RP));
    const exF = w => FX * w + (1 - FX) * Math.pow(w, FP);
    const par = u => u <= UA
      ? { x: lerp(x0, xA, exR(u / UA)),
          y: lerp(ys0, yA, 1 - Math.pow(1 - u / UA, RY)) }
      : { x: lerp(xA, x1, exF((u - UA) / (1 - UA))),
          y: lerp(yA, ys1, Math.pow((u - UA) / (1 - UA), FY)) };
    const vel = u => {
      let dx, dy;
      if (u <= UA) {
        const v = u / UA;
        dx = (xA - x0) * (RX + (1 - RX) * RP * Math.pow(1 - v, RP - 1)) / UA;
        dy = (yA - ys0) * RY * Math.pow(1 - v, RY - 1) / UA;
      } else {
        const w = (u - UA) / (1 - UA);
        dx = (x1 - xA) * (FX + (1 - FX) * FP * Math.pow(w, FP - 1)) / (1 - UA);
        dy = (ys1 - yA) * FY * Math.pow(w, FY - 1) / (1 - UA);
      }
      const vx = dx / T, vy = dy / T, sp = Math.hypot(vx, vy);
      /* en la cresta sp≈0 → nariz hacia abajo: el pez "corona" y pica */
      return { vx, vy, sp, th: sp > 1 ? Math.atan2(vy, vx) : Math.PI / 2 };
    };
    const sgnx = Math.sign(x1 - x0) || 1;
    const uOfX = x => {                    // bisección sobre par(u).x (monótona)
      let lo = 0, hi = 1;
      for (let i = 0; i < 16; i++) {
        const m = (lo + hi) / 2;
        if ((par(m).x - x) * sgnx < 0) lo = m; else hi = m;
      }
      return (lo + hi) / 2;
    };
    return { x0, x1, xA, yA, ys0, ys1, H, T, par, vel, vIn: vel(1), uOfX };
  }

  /* Estado de sumersión a τ s de tocar el agua (todo analítico):
   *   · el impacto recorta la velocidad de entrada (vInX / vInY)
   *   · el agua frena por componente: dragX > dragY → lo horizontal muere
   *     antes y el heading rota solo a vertical mientras se hunde (la
   *     trayectoria subacuática es una curva, no una línea recta) */
  function subm(P, τ) {
    const vx0 = P.vIn.vx * CFG.vInX, vy0 = P.vIn.vy * CFG.vInY;
    const ex = 1 - Math.exp(-CFG.dragX * τ), ey = 1 - Math.exp(-CFG.dragY * τ);
    const vx = vx0 * Math.exp(-CFG.dragX * τ), vy = vy0 * Math.exp(-CFG.dragY * τ);
    return {
      x: P.x1 + vx0 * ex / CFG.dragX,
      y: P.ys1 - 4 + vy0 * ey / CFG.dragY,
      vx, vy, th: Math.atan2(vy, vx),
    };
  }

  /* ---------------- LEAP — la pieza clave ----------------
   * opts: { koi:'black'|'white', dir:'ltr'|'rtl', apex:0..1|0..100,
   *         chars:[{ch,x,y,w,h,font}], hooks:{...}, scaleMul }
   * Línea de tiempo (~1.5s):
   *   0.00–0.14  windup: breach desde el agua (frame BREACH, stretch) + splash out
   *   0.14–0.96  vuelo: arco asimétrico — sube tenso, corona ~46%, baja largo
   *              y empinado (frames 3→4→5→DIVE anticipando), letras en cinta
   *   0.96       splash de entrada ∝ velocidad vertical + columna + ripples
   *   0.96–1.38  sumersión: nose-down, el agua frena (drag exp), cola visible
   *              sobre la línea con latigazo amortiguado, estela + burbujas
   *   1.03       hooks.onEmerge(x1) — letras entrantes salen del agua
   *   ~1.46      fin (done)
   * ------------------------------------------------------------------ */
  function leap(opts, done) {
    /* positional: KOI.leap(dir, apexPct, cb) — spec API mínima */
    if (typeof opts === 'string') { opts = { dir: opts, apex: done }; done = arguments[2]; }
    const o = opts || {};
    const koiName = o.koi === 'white' ? 'white' : 'black';
    const dir = o.dir === 'rtl' ? 'rtl' : 'ltr';
    let apex = o.apex == null ? 0.3 : +o.apex;
    if (apex > 1.001) apex /= 100;
    apex = clamp(apex, 0.05, 1);
    const hooks = o.hooks || {};
    const charsIn = (o.chars || []).map((c, i) => ({
      ...c, i,
      cx: c.x + c.w / 2, cy: c.y + c.h / 2,
      released: false, gone: false, wet: false,
      u: 0, ox: c.x + c.w / 2, oy: c.y + c.h / 2, vx: 0, vy: 0,
      rot: 0, alpha: 1, sc: 1,
    }));

    const W = vw;
    const mirror = dir === 'ltr';            // sprite mira a -x nativo
    const sgn = mirror ? 1 : -1;
    const x0 = mirror ? W * 0.06 : W * 0.94;
    const x1 = W - x0;
    const rng = mulberry32(CFG.seed ^ (o.seedIdx || 0) ^ (mirror ? 0x11 : 0x77));
    const k = makeKoi(koiName);
    k.visible = true; k.mirror = mirror;
    k.scale = CFG.swimScale * lerp(CFG.leapScaleMin, CFG.leapScaleMax, apex) * (o.scaleMul || 1);

    const ocT0 = oceanT();
    const T = CFG.flightT, TW = CFG.windupT, TE = CFG.entryT;
    const ys0 = surf(x0, ocT0), ys1 = surf(x1, ocT0 + TW + T);
    const ysM = surf((x0 + x1) / 2, ocT0);
    const H = ysM * 0.97 * apex;             // altura del arco (apex% → roza el top)
    const ttl = TW + T + TE + 0.08;            // ~1.46s total

    const S = baseScene('leap', () => { k.visible = false; hooks.onDone && hooks.onDone(); done && done(); });
    S.ttl = ttl;
    S.chars = charsIn;                       // debug/testing
    S.koi = k;

    /* trayectoria asimétrica (compartida por pez y letras) */
    const P = makeArc(x0, x1, ys0, ys1, H, T);
    const par = P.par, vel = P.vel;

    /* energía de entrada = velocidad vertical al tocar la superficie →
       splash, columna de agua y geyser todos escalan con ella */
    const powIn = clamp(0.30 + P.vIn.vy / 4200, 0.45, 1);

    /* eventos */
    S.schedule(TW * 0.5, () => {
      fxSplash(x0, 0.55, rng);
      hooks.onSplash && hooks.onSplash(x0, 0.55, 'out');
    });
    const tLand = TW + T;
    S.schedule(tLand, () => {
      fxSplash(x1, powIn, rng);
      if (powIn > 0.82) fxGeyser(x1, rng);
      hooks.onSplash && hooks.onSplash(x1, powIn, 'in');
    });
    /* estela: dos anillos que persiguen al pez mientras se hunde */
    S.schedule(tLand + 0.10, () => fxRipple(x1 + sgn * 14, 0.7));
    S.schedule(tLand + 0.22, () => fxRipple(x1 + sgn * 26, 0.45));
    S.schedule(tLand + 0.07, () => {
      hooks.onEmerge && hooks.onEmerge(x1, ys1);
    });
    S.schedule(ttl, () => S.finish());

    /* release de letras: ~60–90ms tras el paso del morro por su columna
       (u ya no es ∝ x con el arco asimétrico → inversa numérica uOfX) */
    for (const c of charsIn) {
      const uHit = clamp(P.uOfX(c.cx), 0, 0.93);
      c.uRel = uHit;
      const stag = lerp(CFG.staggerMin, CFG.staggerMax, hashI(c.i * 31 + (mirror ? 7 : 3)));
      /* hold: las primeras en soltarse quedan un poco más atrás → la cinta
         abarca más recorrido desde el despegue (clave en apex bajo) */
      c.hold = (1 - uHit / 0.93) * 0.11;
      c.tRel = TW + uHit * T + stag + c.hold;
      /* velocidad propia <1: las atrapadas antes viajan más lento → la cinta
         se estira por todo el arco en vez de viajar en bulto tras el koi */
      c.spd = lerp(0.64, 0.99, clamp(uHit / 0.93, 0, 1)) * lerp(0.95, 1.05, hashI(c.i * 37 + 11));
      c.to = (hashI(c.i * 41 + 7) - 0.5) * 52;      // offset tangencial en el arco
      c.jx = (hashI(c.i * 13 + 5) - 0.5) * 40;
      c.jy = (hashI(c.i * 17 + 9) - 0.5) * 26;
      /* spin/tumble moderados: se leen volando, no quedan irreconocibles */
      c.spin = (hashI(c.i * 23 + 1) - 0.5) * 3.2;
      c.tumble = (hashI(c.i * 29 + 2) - 0.5) * 0.5;
    }

    S.update = dt => {
      const t = S.t;
      /* --- pez --- */
      if (t < TW) {                          // windup: anticipación + breach
        const p = t / TW;
        const dip = p < 0.32 ? p / 0.32 : 0;         // 1ª parte: se hunde un poco
        const rise = p < 0.32 ? 0 : smooth((p - 0.32) / 0.68);
        k.frame = F.BREACH; k.theta = null;
        k.rotOff = (mirror ? 1 : -1) * (1 - rise) * 18 * DEG;
        k.x = x0; k.y = lerp(ys0 + 44 + dip * 16, ys0 - 8, rise);
        k.stretch = -0.10 * dip + 0.16 * rise;       // squash dip → stretch launch
        k.alpha = 1; k.diveDim = 0.5;                // asoma por la línea de agua
      } else if (t < tLand) {                // vuelo (arco asimétrico)
        const u = clamp((t - TW) / T, 0, 1);
        const pos = par(u), v = vel(u);
        k.x = pos.x; k.y = pos.y; k.theta = v.th;
        /* frames: sube UP · corona ARC · baja DOWN · y cuando la caída ya va
           muy empinada pasa a DIVE → la nariz se planta ANTES de tocar agua */
        k.frame = u < CFG.apexT - 0.10 ? F.LEAP_UP
                : u < CFG.apexT + 0.07 ? F.LEAP_ARC
                : v.th > 60 * DEG ? F.DIVE
                : F.LEAP_DOWN;
        k.stretch = clamp((v.sp / 1500 - 0.35) * 0.5, -0.05, 0.16);
        k.alpha = 1; k.diveDim = 0.45;
        /* estela de gotas bajo el pez — espaciada y de vida corta para que
           se lea como gotas sueltas y no como mancha (determinista por step) */
        S._trail = (S._trail || 0) + dt;
        if (S._trail > 0.09) {
          S._trail = 0;
          parts.push({ kind: 'd', x: k.x - v.vx * 0.05 + (hashI((t * 977) | 0) - .5) * 16,
                       y: k.y + 16, vx: -v.vx * 0.06 + (hashI((t * 613) | 0) - .5) * 46,
                       vy: 80 + hashI((t * 331) | 0) * 110, g_: 950, life: 0,
                       ttl: 0.26, size: 1.6 });
        }
      } else {                               /* sumersión */
        const τ = t - tLand;
        const s = subm(P, τ);
        k.frame = F.DIVE; k.theta = s.th;
        /* cola: latigazo amortiguado al pasar la línea + resto del roll de
           entrada que se apaga — el último instante visible "ondula" */
        k.rotOff = Math.sin(τ * 30) * Math.exp(-τ * 8) * 0.16
                 + sgn * 10 * DEG * Math.exp(-τ * 4.5);
        k.x = s.x; k.y = s.y;
        k.stretch = -0.32 * Math.exp(-τ * 10) + 0.05 * Math.exp(-τ * 3);
        /* alpha por PROFUNDIDAD bajo la línea (no por tiempo): el agua se lo
           traga gradual + cola de fade temporal para cerrar la escena */
        const depth = s.y - P.ys1;
        k.alpha = clamp(1 - smooth(clamp((depth - 80) / 170, 0, 1))
                        - smooth(clamp((τ - 0.30) / 0.24, 0, 1)), 0, 1);
        k.diveDim = clamp(0.62 - depth / 420, 0.10, 0.55);
        if (τ > TE || k.alpha <= 0.01) k.visible = false;
        /* estela de espuma en el punto de entrada mientras cruza la línea */
        S._wake = (S._wake || 0) + dt;
        if (τ < 0.30 && S._wake > 0.045) {
          S._wake = 0;
          parts.push({ kind: 'g', g: GLYPHS[(rng() * 4) | 0],
            x: lerp(P.x1, s.x, 0.4) + (rng() - .5) * 18, y: P.ys1 - 2,
            vx: (rng() - .5) * 70, vy: -30 - rng() * 90,
            g_: 500, life: 0, ttl: .35 + rng() * .2, size: 9 + rng() * 8,
            spin: (rng() - .5) * 4, rot: rng() * 6.28 });
        }
        /* burbujas que suben un segundo tras la entrada (ASCII/pixel) */
        if (τ > 0.10 && τ < 0.60) {
          S._bub = (S._bub || 0) + dt;
          if (S._bub > 0.075) {
            S._bub = 0;
            parts.push({ kind: 'b',
              x: s.x + (rng() - .5) * 26,
              y: Math.max(s.y - 14 - rng() * 26, P.ys1 + 10),
              vx: (rng() - .5) * 14, vy: -(26 + rng() * 55), g_: -30,
              life: 0, ttl: .9 + rng() * .5, size: 1.6 + rng() * 2.6,
              sw: 5 + rng() * 4, ph: rng() * 6.28, swA: 12 + rng() * 10 });
          }
        }
      }

      /* --- letras arrastradas --- */
      for (const c of charsIn) {
        if (c.gone) continue;
        if (!c.released && t >= c.tRel) {
          c.released = true;
          hooks.onCharRelease && hooks.onCharRelease(c.i, c);
        }
        if (!c.released) continue;
        const since = t - c.tRel;
        /* su u en la parábola: arranca donde el morro la tocó y avanza a su
           propia velocidad → se separan a lo largo del arco (arrastre) */
        const u = c.uRel + since * c.spd / T;
        /* blend más largo: la letra barre desde su x en el DOM hasta el arco
           → abanico ancho al despegar en vez de snap instantáneo al bulto */
        const blend = smooth(clamp(since / 0.30, 0, 1));
        const uc = clamp(u, 0, 1);
        const pos = par(uc), v = vel(uc);
        const txu = v.vx / (v.sp || 1), tyu = v.vy / (v.sp || 1);
        let px, py;
        if (u <= 1) {
          px = lerp(c.cx, pos.x + txu * c.to * blend + c.jx * (1 - blend * 0.4), blend);
          py = lerp(c.cy, pos.y + tyu * c.to * blend + c.jy, blend);
          c.rot = lerp(c.rot, v.th + c.tumble, 0.35) + c.spin * dt * (1 - blend * 0.5);
          c.ox = px; c.oy = py;
          c.vx = v.vx; c.vy = v.vy;
        } else {
          /* pasó el borde del arco: balístico en el aire; al tocar el agua
             frena (mismo drag que el pez) y se hunde despacio tras él — las
             letras entran al agua, no desaparecen en seco */
          const uw = c.oy - surf(c.ox);
          if (uw > 0) {
            const dr = Math.exp(-4.2 * dt);
            c.vx *= dr; c.vy = Math.min(c.vy * dr, 110);
            c.spin *= Math.exp(-2.5 * dt);
            if (!c.wet) {                        // primer contacto: salpicón chico
              c.wet = true;
              if (hashI(c.i * 53 + 17) < 0.4) fxRipple(c.ox, 0.45);
              parts.push({ kind: 'd', x: c.ox, y: surf(c.ox),
                vx: (hashI(c.i * 59 + 3) - .5) * 90,
                vy: -60 - hashI(c.i * 61 + 5) * 120,
                g_: 900, life: 0, ttl: .3, size: 2 });
            }
          } else {
            c.vy += 1900 * dt;
          }
          c.ox += (c.vx * 0.55) * dt; c.oy += c.vy * dt;
          c.rot += c.spin * dt;
          px = c.ox; py = c.oy;
        }
        c.px = px; c.py = py;
        c.sc = lerp(1, 0.62, clamp(since / 0.9, 0, 1));
        const under = py - surf(px);
        c.alpha = under > 4 ? clamp(1 - (under - 4) / 70, 0, 1)
                          : clamp(1.1 - since / 1.0, 0, 1);
        if (c.alpha <= 0 || px < -160 || px > W + 160) c.gone = true;
      }
      if (t >= ttl) S.finish();
    };

    const drawCh = (c2, ch) => {
      c2.save();
      c2.translate(ch.px, ch.py);
      c2.rotate(ch.rot);
      c2.scale(ch.sc, ch.sc);
      c2.globalAlpha = clamp(ch.alpha * (ch._dim || 1), 0, 1);
      c2.font = ch.font || '900 64px sans-serif';
      c2.fillStyle = '#f5f5f5';
      c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText(ch.ch, 0, 0);
      c2.restore();
    };

    S.draw = c => {
      for (const ch of charsIn) {
        if (!ch.released || ch.gone || ch.alpha <= 0) continue;
        /* corte por la línea de agua: la letra se atenúa bajo la superficie
           igual que el pez → se hunde con él, no corta en seco */
        const ysC = surf(ch.px), hh = 42 * ch.sc;
        if (ch.py + hh <= ysC) { drawCh(c, ch); continue; }    // todo arriba
        c.save(); c.beginPath(); c.rect(0, ysC, W, vh - ysC); c.clip();
        ch._dim = 0.32; drawCh(c, ch); ch._dim = 1; c.restore();
        if (ch.py - hh >= ysC) continue;                       // del todo abajo
        c.save(); c.beginPath(); c.rect(0, 0, W, ysC); c.clip(); drawCh(c, ch); c.restore();
      }
      drawKoiWater(c, k);
    };

    S.snapEnd = () => {
      for (const c of charsIn) { c.released = true; c.gone = true; }
      k.visible = false;
    };

    runScene(S);
    return S;
  }

  /* ---------------- INTRO ---------------- */
  function playIntro(done, hooks) {
    const W = vw;
    const rng = mulberry32(CFG.seed ^ 0x1A);
    const kb = makeKoi('black'), kw = makeKoi('white');
    kb.visible = kw.visible = true;
    kb.mirror = true;                       // black nada L→R
    kw.mirror = false;                      // white nada R→L
    kb.scale = kw.scale = CFG.swimScale;
    kb.spr.play('swim'); kw.spr.play('swim');

    const ttl = 6.9;
    const S = baseScene('intro', done);
    S.ttl = ttl;
    /* fases: SWIM 0.4–3.9 (cruce taijitu) · TURN 3.9–4.55 · DIVE 4.55–5.05 ·
       RIPPLE→emerge 5.0–6.9 */
    const xB0 = -W * 0.12, xB1 = W * 0.60;  // black: izq → pasa al otro lado
    const xW0 =  W * 1.12, xW1 = W * 0.40;  // white: der → cruza
    const T0 = 0.4, T1 = 3.9, TD = 4.55;

    S.schedule(4.72, () => { fxSplash(xB1 + 55, 1.0, rng); fxGeyser(xB1 + 55, rng); });
    S.schedule(4.80, () => { fxSplash(xW1 - 55, 1.0, rng); fxGeyser(xW1 - 55, rng); });
    /* ripple doble: segundo anillo ~0.16s después (la onda que persigue) */
    S.schedule(4.88, () => { fxRipple(xB1 + 55); });
    S.schedule(4.96, () => { fxRipple(xW1 - 55); });
    S.schedule(5.45, () => {
      hooks && hooks.onEmerge && hooks.onEmerge(W * 0.5, surf(W * 0.5));
    });
    S.schedule(ttl, () => S.finish());

    S.update = dt => {
      const t = S.t;
      for (const [k, xa, xb, lane] of [[kb, xB0, xB1, 1], [kw, xW0, xW1, -1]]) {
        if (t < T0) {                        // espera fuera de pantalla
          k.x = xa; k.y = surf(xa) + 10; k.visible = false;
          continue;
        }
        k.visible = true;
        if (t < T1) {                        // nada + cruce
          const p = easeInOut(clamp((t - T0) / (T1 - T0), 0, 1));
          k.x = lerp(xa, xb, p);
          /* carril: durante el cruce uno baja y otro sube (guiño taijitu) */
          const cross = Math.sin(Math.PI * clamp((p - 0.35) / 0.3, 0, 1));
          const bob = Math.sin(t * 2.2 + lane) * 3;
          k.y = surf(k.x) + 10 + lane * 16 * cross + bob;
          /* heading: 0 (→) o π (←) + tilt por pendiente de ola y bob */
          const s1 = surf(k.x + 6), s0 = surf(k.x - 6);
          const tilt = Math.atan2(s1 - s0, 12) * 0.8 + Math.sin(t * 2.2 + lane) * 0.06;
          k.theta = (k.mirror ? 0 : Math.PI) + tilt;
          k.rotOff = 0;
          k.frame = curFrame(k);
          k.spr.update(dt * 1000);
          k.stretch = 0;
        } else if (t < TD) {                 // arco del salto → picada
          const p = smooth((t - T1) / (TD - T1));
          const dirX = k.mirror ? 1 : -1;
          /* teatro: se hunde un toque, sale en ARCO real (sube rápido y
             corona), deriva hacia adelante y cae nariz-abajo al agua */
          const dipW = Math.sin(Math.PI * clamp(p / 0.20, 0, 1)) * 10;
          const hopT = clamp((p - 0.20) / 0.65, 0, 1);
          const arc  = Math.sin(Math.PI * Math.pow(hopT, 0.9));
          const hopX = dirX * 55 * hopT;
          k.x = xb + hopX;
          k.y = surf(xb) + 10 + dipW - arc * 95;
          k.frame = p < 0.20 ? F.LEAP_DOWN
                  : hopT < 0.30 ? F.LEAP_UP
                  : hopT < 0.60 ? F.LEAP_ARC
                  : hopT < 0.85 ? F.LEAP_DOWN : F.DIVE;
          k.theta = lerp(k.mirror ? 0 : Math.PI, Math.PI / 2,
                         smooth(clamp((hopT - 0.50) / 0.50, 0, 1)));
          k.rotOff = 0;
          k.stretch = -0.10 * (dipW / 10) + 0.30 * arc;
        } else {                             // picado → bajo el agua
          const p = clamp((t - TD) / 0.7, 0, 1);
          const landX = xb + (k.mirror ? 1 : -1) * 55;
          k.frame = F.DIVE; k.theta = Math.PI / 2; k.rotOff = 0;
          k.x = landX; k.y = surf(landX) + 10 + easeIn(p) * 150;
          k.stretch = -0.28 * Math.exp(-p * 5);
          k.alpha = 1 - smooth(clamp((p - 0.45) / 0.5, 0, 1));
          if (p >= 1) k.visible = false;
        }
      }
      if (t >= ttl) S.finish();
    };

    S.draw = c => { drawKoiWater(c, kb); drawKoiWater(c, kw); };
    S.snapEnd = () => { kb.visible = kw.visible = false; };
    runScene(S);
    return S;
  }

  /* ---------------- loop fijo ---------------- */
  function tick(dt) {
    if (scene && !scene.dead) {
      scene.t += dt;
      scene.fireDue();
    }
    /* fireDue pudo terminar la escena (finish → scene=null): re-chequear */
    if (scene && !scene.dead && scene.update) scene.update(dt);
    stepFx(dt);
  }

  function render() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    drawFx(ctx);
    if (scene && !scene.dead && scene.draw) scene.draw(ctx);
  }

  function frame(ts) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - last) / 1000 || 0);
    last = ts; acc += dt;
    while (acc >= STEP) { acc -= STEP; tick(STEP); }
    render();
  }
  function startLoop() {
    if (running) return;
    running = true; last = performance.now(); acc = 0;
    requestAnimationFrame(frame);
  }

  /* ---------------- API ---------------- */
  const KOI = {
    state: 'idle',
    APEXS: APEXS.slice(),

    async init(o) {
      o = o || {};
      cv = o.canvas || document.getElementById('fx');
      ctx = cv.getContext('2d');
      ocean = o.ocean || window.OCEAN || null;
      const base = o.assetsBase || '../assets/pixel-art';
      const [b, w] = await Promise.all([
        loadSprite(`${base}/koi-black/`),
        loadSprite(`${base}/koi-white/`),
      ]);
      sprites.black = b.sprite; sprites.white = w.sprite;
      KOI.resize();
      window.addEventListener('resize', KOI.resize);
      ready = true;
      startLoop();
      return KOI;
    },

    resize() {
      if (!cv) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      vw = window.innerWidth; vh = window.innerHeight;
      cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
      cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    },

    playIntro(done, hooks) { return ready ? playIntro(done, hooks) : null; },
    skipIntro() { if (scene && scene.name === 'intro') scene.finish(); },
    leap(opts, done) { return ready ? leap(opts, done) : null; },

    leapDouble(opts, done) {
      /* cierre: ambos kois juntos — dos escenas en paralelo no se pueden
         (runScene interrumpe), así que leapDouble corre UNA escena con 2 actores */
      const o = opts || {};
      const hooks = o.hooks || {};
      let apex = o.apex == null ? 1 : +o.apex; if (apex > 1.001) apex /= 100;
      const charsIn = (o.chars || []).map((c, i) => ({ ...c, i, cx: c.x + c.w / 2, cy: c.y + c.h / 2, released: false, gone: false, wet: false, u: 0, rot: 0, alpha: 1, sc: 1, ox: c.x + c.w / 2, oy: c.y + c.h / 2, vx: 0, vy: 0 }));
      const W = vw, rng = mulberry32(CFG.seed ^ 0xF1);
      const kb = makeKoi('black'), kw = makeKoi('white');
      kb.visible = kw.visible = true;
      kb.mirror = true; kw.mirror = false;
      kb.scale = kw.scale = CFG.swimScale * lerp(CFG.leapScaleMin, CFG.leapScaleMax, apex);
      const T = CFG.flightT, TW = CFG.windupT, TE = CFG.entryT;
      const dl = 0.10;                    // white sale 100ms después → no se pisan
      const ttl = TW + T + dl + TE + 0.10;
      const ocT0 = oceanT();
      const mk = (mirror, apexF) => {
        const x0 = mirror ? W * 0.08 : W * 0.92, x1 = W - x0;
        const ys0 = surf(x0, ocT0), ys1 = surf(x1, ocT0 + TW + T);
        const H = surf((x0 + x1) / 2, ocT0) * 0.97 * apex * apexF;
        return makeArc(x0, x1, ys0, ys1, H, T);
      };
      /* arcos espejados: black alto L→R, white ~84% R→L con delay → se cruzan
         en el centro sin superponerse (lectura taijitu limpia) */
      const A = mk(true, 1), B = mk(false, 0.84);
      const powA = clamp(0.30 + A.vIn.vy / 4200, 0.45, 1);
      const powB = clamp(0.30 + B.vIn.vy / 4200, 0.45, 1);
      const S = baseScene('leap2', () => { kb.visible = kw.visible = false; hooks.onDone && hooks.onDone(); done && done(); });
      S.ttl = ttl;
      S.schedule(TW * 0.5, () => { fxSplash(A.x0, .6, rng); });
      S.schedule(TW * 0.5 + dl, () => { fxSplash(B.x0, .6, rng); });
      S.schedule(TW + T, () => { fxSplash(A.x1, powA, rng); if (powA > 0.82) fxGeyser(A.x1, rng); });
      S.schedule(TW + T + dl, () => { fxSplash(B.x1, powB, rng); if (powB > 0.82) fxGeyser(B.x1, rng); });
      S.schedule(TW + T + 0.10, () => fxRipple(A.x1 + 14, 0.7));
      S.schedule(TW + T + dl + 0.10, () => fxRipple(B.x1 - 14, 0.7));
      S.schedule(TW + T + dl + 0.07, () => { hooks.onEmerge && hooks.onEmerge(W * 0.5, surf(W * 0.5)); });
      S.schedule(ttl, () => S.finish());
      for (const c of charsIn) {
        const uA = clamp(A.uOfX(c.cx), 0, 0.93);
        const uB = clamp(B.uOfX(c.cx), 0, 0.93);
        /* cada koi arrastra las letras de SU mitad (izq→white, der→black):
           dos cintas simétricas que se abren hacia los bordes, no un centro
           cargado */
        const pickB = c.cx < W / 2;
        c.path = pickB ? B : A;
        c.uRel = pickB ? uB : uA;
        c.off = c.path === B ? dl : 0;
        c.hold = (1 - c.uRel / 0.93) * 0.11;
        c.spd = lerp(0.64, 0.99, clamp(c.uRel / 0.93, 0, 1)) * lerp(0.95, 1.05, hashI(c.i * 37 + 11));
        c.tRel = c.off + TW + c.uRel * T + lerp(CFG.staggerMin, CFG.staggerMax, hashI(c.i * 31)) + c.hold;
        c.to = (hashI(c.i * 41 + 7) - .5) * 52;
        c.jx = (hashI(c.i * 13 + 5) - .5) * 40; c.jy = (hashI(c.i * 17 + 9) - .5) * 26;
        c.spin = (hashI(c.i * 23 + 1) - .5) * 3.2; c.tumble = (hashI(c.i * 29 + 2) - .5) * .5;
      }
      S.update = dt => {
        const t = S.t, tLand = TW + T;
        for (const [k, P, mirror, off] of [[kb, A, true, 0], [kw, B, false, dl]]) {
          const lt = t - off;                    // reloj local del actor
          if (lt < 0) { k.visible = false; continue; }
          k.visible = true;
          if (lt < TW) {
            const p = lt / TW;
            const dip = p < 0.32 ? p / 0.32 : 0;
            const rise = p < 0.32 ? 0 : smooth((p - 0.32) / 0.68);
            k.frame = F.BREACH; k.theta = null;
            k.rotOff = (mirror ? 1 : -1) * (1 - rise) * 18 * DEG;
            k.x = P.x0; k.y = lerp(P.ys0 + 44 + dip * 16, P.ys0 - 8, rise);
            k.stretch = -.10 * dip + .16 * rise; k.alpha = 1; k.diveDim = 0.5;
          } else if (lt < tLand) {
            const u = clamp((lt - TW) / T, 0, 1), pos = P.par(u), v = P.vel(u);
            k.x = pos.x; k.y = pos.y; k.theta = v.th;
            k.frame = u < CFG.apexT - .10 ? F.LEAP_UP
                    : u < CFG.apexT + .07 ? F.LEAP_ARC
                    : v.th > 60 * DEG ? F.DIVE
                    : F.LEAP_DOWN;
            k.stretch = clamp((v.sp / 1500 - .35) * .5, -.05, .16); k.alpha = 1;
            /* estela liviana por koi (clave del buffer por actor) */
            const key = mirror ? '_trA' : '_trB';
            S[key] = (S[key] || 0) + dt;
            if (S[key] > 0.09) {
              S[key] = 0;
              parts.push({ kind: 'd', x: k.x - v.vx * .05 + (hashI(((t + off) * 977) | 0) - .5) * 16,
                           y: k.y + 16, vx: -v.vx * .06 + (hashI((t * 613) | 0) - .5) * 46,
                           vy: 80 + hashI((t * 331) | 0) * 110, g_: 950, life: 0,
                           ttl: .26, size: 1.6 });
            }
          } else {                              /* sumersión (misma física) */
            const τ = lt - tLand, s = subm(P, τ), sgn = mirror ? 1 : -1;
            k.frame = F.DIVE; k.theta = s.th;
            k.rotOff = Math.sin(τ * 30) * Math.exp(-τ * 8) * .16
                     + sgn * 10 * DEG * Math.exp(-τ * 4.5);
            k.x = s.x; k.y = s.y;
            k.stretch = -.32 * Math.exp(-τ * 10) + .05 * Math.exp(-τ * 3);
            const depth = s.y - P.ys1;
            k.alpha = clamp(1 - smooth(clamp((depth - 80) / 170, 0, 1))
                            - smooth(clamp((τ - .30) / .24, 0, 1)), 0, 1);
            k.diveDim = clamp(.62 - depth / 420, .10, .55);
            if (τ > TE || k.alpha <= .01) k.visible = false;
            /* espuma + burbujas por actor (buffers separados) */
            const wkey = mirror ? '_wkA' : '_wkB';
            S[wkey] = (S[wkey] || 0) + dt;
            if (τ < .30 && S[wkey] > .045) {
              S[wkey] = 0;
              parts.push({ kind: 'g', g: GLYPHS[(rng() * 4) | 0],
                x: lerp(P.x1, s.x, .4) + (rng() - .5) * 18, y: P.ys1 - 2,
                vx: (rng() - .5) * 70, vy: -30 - rng() * 90,
                g_: 500, life: 0, ttl: .35 + rng() * .2, size: 9 + rng() * 8,
                spin: (rng() - .5) * 4, rot: rng() * 6.28 });
            }
            const bkey = mirror ? '_bbA' : '_bbB';
            if (τ > .10 && τ < .60) {
              S[bkey] = (S[bkey] || 0) + dt;
              if (S[bkey] > .075) {
                S[bkey] = 0;
                parts.push({ kind: 'b',
                  x: s.x + (rng() - .5) * 26,
                  y: Math.max(s.y - 14 - rng() * 26, P.ys1 + 10),
                  vx: (rng() - .5) * 14, vy: -(26 + rng() * 55), g_: -30,
                  life: 0, ttl: .9 + rng() * .5, size: 1.6 + rng() * 2.6,
                  sw: 5 + rng() * 4, ph: rng() * 6.28, swA: 12 + rng() * 10 });
              }
            }
          }
        }
        for (const c of charsIn) {
          if (c.gone) continue;
          if (!c.released && t >= c.tRel) { c.released = true; hooks.onCharRelease && hooks.onCharRelease(c.i, c); }
          if (!c.released) continue;
          const since = t - c.tRel, P = c.path;
          const u = c.uRel + since * c.spd / T;
          const blend = smooth(clamp(since / .30, 0, 1));
          const uc = clamp(u, 0, 1);
          const pos = P.par(uc), v = P.vel(uc);
          const txu = v.vx / (v.sp || 1), tyu = v.vy / (v.sp || 1);
          let px, py;
          if (u <= 1) {
            px = lerp(c.cx, pos.x + txu * c.to * blend + c.jx * (1 - blend * .4), blend);
            py = lerp(c.cy, pos.y + tyu * c.to * blend + c.jy, blend);
            c.rot = lerp(c.rot, v.th + c.tumble, .35) + c.spin * dt * (1 - blend * .5);
            c.ox = px; c.oy = py; c.vx = v.vx; c.vy = v.vy;
          } else {
            const uw = c.oy - surf(c.ox);
            if (uw > 0) {                        // ya entró: drag de agua
              const dr = Math.exp(-4.2 * dt);
              c.vx *= dr; c.vy = Math.min(c.vy * dr, 110);
              c.spin *= Math.exp(-2.5 * dt);
              if (!c.wet) {
                c.wet = true;
                if (hashI(c.i * 53 + 17) < .4) fxRipple(c.ox, .45);
                parts.push({ kind: 'd', x: c.ox, y: surf(c.ox),
                  vx: (hashI(c.i * 59 + 3) - .5) * 90,
                  vy: -60 - hashI(c.i * 61 + 5) * 120,
                  g_: 900, life: 0, ttl: .3, size: 2 });
              }
            } else {
              c.vy += 1900 * dt;
            }
            c.ox += c.vx * .55 * dt; c.oy += c.vy * dt; c.rot += c.spin * dt;
            px = c.ox; py = c.oy;
          }
          c.px = px; c.py = py;
          c.sc = lerp(1, .62, clamp(since / .9, 0, 1));
          const under = py - surf(px);
          c.alpha = under > 4 ? clamp(1 - (under - 4) / 70, 0, 1) : clamp(1.1 - since / 1.0, 0, 1);
          if (c.alpha <= 0 || px < -160 || px > W + 160) c.gone = true;
        }
        if (t >= ttl) S.finish();
      };
      const drawCh = (c2, ch) => {
        c2.save(); c2.translate(ch.px, ch.py); c2.rotate(ch.rot); c2.scale(ch.sc, ch.sc);
        c2.globalAlpha = clamp(ch.alpha * (ch._dim || 1), 0, 1);
        c2.font = ch.font || '900 64px sans-serif';
        c2.fillStyle = '#f5f5f5'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
        c2.fillText(ch.ch, 0, 0); c2.restore();
      };
      S.draw = c => {
        for (const ch of charsIn) {
          if (!ch.released || ch.gone || ch.alpha <= 0) continue;
          const ysC = surf(ch.px), hh = 42 * ch.sc;
          if (ch.py + hh <= ysC) { drawCh(c, ch); continue; }
          c.save(); c.beginPath(); c.rect(0, ysC, W, vh - ysC); c.clip();
          ch._dim = .32; drawCh(c, ch); ch._dim = 1; c.restore();
          if (ch.py - hh >= ysC) continue;
          c.save(); c.beginPath(); c.rect(0, 0, W, ysC); c.clip(); drawCh(c, ch); c.restore();
        }
        drawKoiWater(c, kb); drawKoiWater(c, kw);
      };
      S.snapEnd = () => { for (const c of charsIn) { c.released = true; c.gone = true; } kb.visible = kw.visible = false; };
      runScene(S);
      return S;
    },

    /* transición i: black L→R, i+1: white R→L, apex = APEXS[i] */
    leapTransition(i, opts, done) {
      const o = opts || {};
      if (o.double || i >= APEXS.length) return KOI.leapDouble({ ...o, apex: 1 }, done);
      const apex = APEXS[clamp(i, 0, APEXS.length - 1)] / 100;
      const koi = i % 2 ? 'white' : 'black';
      const dir = dirMode === 'ltr' ? 'ltr' : (i % 2 ? 'rtl' : 'ltr');
      return leap({ ...o, koi, dir, apex, seedIdx: i }, done);
    },

    advance() { if (scene) scene.finish(); },   // interrumpe limpio
    cancel()  { if (scene) { const s = scene; s.cb = null; s.finish(); } },
    _dbg() { return scene; },                   // debug/testing
    /* debug/test: pausa el loop rAF y steppea la escena a mano — permite
       capturar un instante exacto de la animación (screenshots headless) */
    pause() { running = false; },
    _step(dt) { tick(dt == null ? STEP : dt); render(); },
    setDirMode(m) { dirMode = m === 'ltr' ? 'ltr' : 'alternate'; },
    setOcean(o) { ocean = o; },
    surfaceY(x, t) { return surf(x, t); },

    /* DOM → chars para el "se lleva las letras".
     * el: elemento con [data-ch] por carácter (o se splitea textContent). */
    collectChars(el) {
      const out = [];
      let nodes = el.querySelectorAll('[data-ch]');
      if (!nodes.length) {
        /* splitea en spans data-ch al vuelo (no muta si ya tiene) */
        const txt = el.textContent;
        el.textContent = '';
        for (const ch of txt) {
          const s = document.createElement('span');
          s.dataset.ch = ch; s.textContent = ch;
          el.appendChild(s);
        }
        nodes = el.querySelectorAll('[data-ch]');
      }
      nodes.forEach(n => {
        const r = n.getBoundingClientRect();
        if (!r.width && !r.height) return;
        const cs = getComputedStyle(n);
        out.push({
          ch: n.dataset.ch || n.textContent,
          x: r.left, y: r.top, w: r.width, h: r.height,
          font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
          el: n,
        });
      });
      return out;
    },
    hideChars(chars) { for (const c of chars) c.el && (c.el.style.visibility = 'hidden'); },
    showChars(chars) { for (const c of chars) c.el && (c.el.style.visibility = ''); },
  };

  return KOI;
})();

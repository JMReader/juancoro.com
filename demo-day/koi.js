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
    flightT: 0.84,            // s de vuelo parabólico
    windupT: 0.14,            // s de anticipación (dip + breach)
    entryT: 0.22,             // s de hundimiento tras el splash
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
      frame: 0, alpha: 1, visible: false, swimOn: false,
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
    /* columna de agua (solo impactos fuertes): pilar corto que sube y cae */
    if (power > 0.7) {
      for (let i = 0; i < 5; i++) {
        parts.push({
          kind: 'col', x: x + (rng() - 0.5) * 34, y: y - 2,
          vx: (rng() - 0.5) * 60, vy: -(260 + rng() * 300) * power,
          g_: 1250, life: 0, ttl: 0.55 + rng() * 0.3,
          size: 3 + rng() * 4,
        });
      }
    }
    /* ripples concéntricos (2) */
    for (let i = 0; i < 2; i++) {
      ripples.push({ x, y, r: 12 + i * 10, vr: 300 + i * 130, life: 0, ttl: 0.55 + i * 0.18, w: 2.5 - i });
    }
  }

  function stepFx(dt) {
    for (const p of parts) {
      p.life += dt;
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

  /* ---------------- LEAP — la pieza clave ----------------
   * opts: { koi:'black'|'white', dir:'ltr'|'rtl', apex:0..1|0..100,
   *         chars:[{ch,x,y,w,h,font}], hooks:{...}, scaleMul }
   * Línea de tiempo (~1.4s):
   *   0.00–0.10  windup: breach desde el agua (frame BREACH, stretch) + splash out
   *   0.10–0.95  vuelo parabólico, rotación tangente, frames 3→4→5, letras arrastradas
   *   0.95       splash de entrada (grande) + burst + ripples
   *   0.95–1.20  hundimiento nose-down con squash y fade
   *   1.02       hooks.onEmerge(x1) — letras entrantes salen del agua
   *   ~1.40      fin (done)
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
      released: false, gone: false,
      u: 0, ox: 0, oy: 0, rot: 0, alpha: 1, sc: 1,
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
    const ttl = TW + T + TE + 0.26;            // ~1.46s total

    const S = baseScene('leap', () => { k.visible = false; hooks.onDone && hooks.onDone(); done && done(); });
    S.ttl = ttl;
    S.chars = charsIn;                       // debug/testing
    S.koi = k;

    /* trayectoria parabólica (compartida por pez y letras) */
    const par = u => ({
      x: lerp(x0, x1, u),
      y: lerp(ys0, ys1, u) - H * 4 * u * (1 - u),
    });
    const vel = u => {
      const vx = (x1 - x0) / T;
      const vy = ((ys1 - ys0) - H * 4 * (1 - 2 * u)) / T;
      return { vx, vy, th: Math.atan2(vy, vx), sp: Math.hypot(vx, vy) };
    };

    /* eventos */
    S.schedule(TW * 0.5, () => {
      fxSplash(x0, 0.55, rng);
      hooks.onSplash && hooks.onSplash(x0, 0.55, 'out');
    });
    const tLand = TW + T;
    S.schedule(tLand, () => {
      fxSplash(x1, 0.95, rng);
      hooks.onSplash && hooks.onSplash(x1, 0.95, 'in');
    });
    S.schedule(tLand + 0.07, () => {
      hooks.onEmerge && hooks.onEmerge(x1, ys1);
    });
    S.schedule(ttl, () => S.finish());

    /* release de letras: ~60–90ms tras el paso del morro por su columna */
    for (const c of charsIn) {
      const uHit = clamp((c.cx - x0) / (x1 - x0), 0, 0.93);
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
        k.alpha = 1;
      } else if (t < tLand) {                // vuelo
        const u = (t - TW) / T;
        const pos = par(u), v = vel(u);
        k.x = pos.x; k.y = pos.y; k.theta = v.th;
        k.frame = u < 0.34 ? F.LEAP_UP : u < 0.62 ? F.LEAP_ARC : F.LEAP_DOWN;
        k.stretch = clamp((v.sp / 1500 - 0.35) * 0.5, -0.05, 0.16);
        k.alpha = 1;
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
      } else {                               // entrada + hundimiento
        const p = clamp((t - tLand) / TE, 0, 1);
        k.frame = F.DIVE; k.theta = Math.PI / 2; k.rotOff = sgn * 14 * DEG * (1 - p);
        k.x = x1 + sgn * 14 * p;
        k.y = ys1 - 8 + easeIn(p) * 120;
        k.stretch = -0.28 * Math.exp(-p * 6);           // squash al tocar agua
        k.alpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
        if (t > tLand + TE) k.visible = false;
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
          /* pasó el borde: balístico — se hunde tras el pez */
          c.vy += 1900 * dt;
          c.ox += (c.vx * 0.55) * dt; c.oy += c.vy * dt;
          c.rot += c.spin * dt;
          px = c.ox; py = c.oy;
        }
        c.px = px; c.py = py;
        c.sc = lerp(1, 0.62, clamp(since / 0.9, 0, 1));
        const under = py - surf(px);
        c.alpha = under > 4 ? clamp(1 - (under - 4) / 45, 0, 1)
                          : clamp(1.1 - since / 1.0, 0, 1);
        if (c.alpha <= 0 || px < -160 || px > W + 160) c.gone = true;
      }
      if (t >= ttl) S.finish();
    };

    S.draw = c => {
      for (const ch of charsIn) {
        if (!ch.released || ch.gone || ch.alpha <= 0) continue;
        c.save();
        c.translate(ch.px, ch.py);
        c.rotate(ch.rot);
        c.scale(ch.sc, ch.sc);
        c.globalAlpha = clamp(ch.alpha, 0, 1);
        c.font = ch.font || '900 64px sans-serif';
        c.fillStyle = '#f5f5f5';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(ch.ch, 0, 0);
        c.restore();
      }
      drawKoi(c, k);
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

    S.schedule(4.72, () => { fxSplash(xB1, 0.85, rng); });
    S.schedule(4.80, () => { fxSplash(xW1, 0.85, rng); });
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
        } else if (t < TD) {                 // giro a nose-down
          const p = smooth((t - T1) / (TD - T1));
          k.x = xb; k.y = surf(xb) + 10 + Math.sin(t * 6) * 1.5;
          k.frame = p < 0.5 ? F.LEAP_DOWN : F.DIVE;
          /* heading barre de 0|π a π/2 (nariz abajo, en su sentido de viaje) */
          k.theta = lerp(k.mirror ? 0 : Math.PI, Math.PI / 2, p);
          k.rotOff = 0;
          k.stretch = -0.12 * p;
        } else {                             // picado → bajo el agua
          const p = clamp((t - TD) / 0.7, 0, 1);
          k.frame = F.DIVE; k.theta = Math.PI / 2; k.rotOff = 0;
          k.x = xb; k.y = surf(xb) + 10 + easeIn(p) * 150;
          k.stretch = -0.28 * Math.exp(-p * 5);
          k.alpha = 1 - smooth(clamp((p - 0.45) / 0.5, 0, 1));
          if (p >= 1) k.visible = false;
        }
      }
      if (t >= ttl) S.finish();
    };

    S.draw = c => { drawKoi(c, kb); drawKoi(c, kw); };
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
      const charsIn = (o.chars || []).map((c, i) => ({ ...c, i, cx: c.x + c.w / 2, cy: c.y + c.h / 2, released: false, gone: false, u: 0, rot: 0, alpha: 1, sc: 1, ox: 0, oy: 0 }));
      const W = vw, rng = mulberry32(CFG.seed ^ 0xF1);
      const kb = makeKoi('black'), kw = makeKoi('white');
      kb.visible = kw.visible = true;
      kb.mirror = true; kw.mirror = false;
      kb.scale = kw.scale = CFG.swimScale * lerp(CFG.leapScaleMin, CFG.leapScaleMax, apex);
      const T = CFG.flightT, TW = CFG.windupT, TE = CFG.entryT;
      const dl = 0.10;                    // white sale 100ms después → no se pisan
      const ttl = TW + T + dl + TE + 0.34;
      const ocT0 = oceanT();
      const mk = (mirror, apexF) => {
        const x0 = mirror ? W * 0.08 : W * 0.92, x1 = W - x0;
        const ys0 = surf(x0, ocT0), ys1 = surf(x1, ocT0 + TW + T);
        const H = surf((x0 + x1) / 2, ocT0) * 0.97 * apex * apexF;
        return {
          x0, x1, ys0, ys1, H,
          par: u => ({ x: lerp(x0, x1, u), y: lerp(ys0, ys1, u) - H * 4 * u * (1 - u) }),
          vel: u => { const vx = (x1 - x0) / T; const vy = ((ys1 - ys0) - H * 4 * (1 - 2 * u)) / T; return { vx, vy, th: Math.atan2(vy, vx), sp: Math.hypot(vx, vy) }; },
        };
      };
      /* arcos espejados: black alto L→R, white ~84% R→L con delay → se cruzan
         en el centro sin superponerse (lectura taijitu limpia) */
      const A = mk(true, 1), B = mk(false, 0.84);
      const S = baseScene('leap2', () => { kb.visible = kw.visible = false; hooks.onDone && hooks.onDone(); done && done(); });
      S.ttl = ttl;
      S.schedule(TW * 0.5, () => { fxSplash(A.x0, .6, rng); });
      S.schedule(TW * 0.5 + dl, () => { fxSplash(B.x0, .6, rng); });
      S.schedule(TW + T, () => { fxSplash(A.x1, 1, rng); });
      S.schedule(TW + T + dl, () => { fxSplash(B.x1, 1, rng); });
      S.schedule(TW + T + dl + 0.07, () => { hooks.onEmerge && hooks.onEmerge(W * 0.5, surf(W * 0.5)); });
      S.schedule(ttl, () => S.finish());
      for (const c of charsIn) {
        const uA = clamp((c.cx - A.x0) / (A.x1 - A.x0), 0, 0.93);
        const uB = clamp((c.cx - B.x0) / (B.x1 - B.x0), 0, 0.93);
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
            k.stretch = -.10 * dip + .16 * rise; k.alpha = 1;
          } else if (lt < tLand) {
            const u = (lt - TW) / T, pos = P.par(u), v = P.vel(u);
            k.x = pos.x; k.y = pos.y; k.theta = v.th;
            k.frame = u < .34 ? F.LEAP_UP : u < .62 ? F.LEAP_ARC : F.LEAP_DOWN;
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
          } else {
            const p = clamp((lt - tLand) / TE, 0, 1);
            k.frame = F.DIVE; k.theta = Math.PI / 2;
            k.rotOff = (mirror ? 1 : -1) * 14 * DEG * (1 - p);
            k.x = P.x1 + (mirror ? 1 : -1) * 14 * p;
            k.y = P.ys1 - 8 + easeIn(p) * 120;
            k.stretch = -.28 * Math.exp(-p * 6);
            k.alpha = p < .55 ? 1 : 1 - (p - .55) / .45;
            if (lt > tLand + TE) k.visible = false;
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
            c.vy += 1900 * dt;
            c.ox += c.vx * .55 * dt; c.oy += c.vy * dt; c.rot += c.spin * dt;
            px = c.ox; py = c.oy;
          }
          c.px = px; c.py = py;
          c.sc = lerp(1, .62, clamp(since / .9, 0, 1));
          const under = py - surf(px);
          c.alpha = under > 4 ? clamp(1 - (under - 4) / 45, 0, 1) : clamp(1.1 - since / 1.0, 0, 1);
          if (c.alpha <= 0 || px < -160 || px > W + 160) c.gone = true;
        }
        if (t >= ttl) S.finish();
      };
      S.draw = c => {
        for (const ch of charsIn) {
          if (!ch.released || ch.gone || ch.alpha <= 0) continue;
          c.save(); c.translate(ch.px, ch.py); c.rotate(ch.rot); c.scale(ch.sc, ch.sc);
          c.globalAlpha = clamp(ch.alpha, 0, 1);
          c.font = ch.font || '900 64px sans-serif';
          c.fillStyle = '#f5f5f5'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(ch.ch, 0, 0); c.restore();
        }
        drawKoi(c, kb); drawKoi(c, kw);
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

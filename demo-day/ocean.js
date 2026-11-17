/* ============================================================
 * demo-day — FONDO: océano ASCII permanente  (agente fondo)
 * ------------------------------------------------------------
 * B&W puro sobre #050505. Determinista: seed fija + rAF con
 * timestep fijo (STEP=1/60). Vanilla JS, sin dependencias.
 *
 * Monta un canvas fullscreen (usa #bg si existe, si no lo crea)
 * y expone window.OCEAN (contrato specs/00-contrato.md):
 *
 *   OCEAN.surfaceY(x, t) → y px de la superficie en la columna x
 *                          en el instante t (segundos del reloj
 *                          interno; si se omite t → ahora).
 *                          Es exactamente la línea dibujada
 *                          (± media celda de grilla).
 *   OCEAN.splash(x, p)   → splash en x, p ∈ [0,1]: hunde la
 *                          línea, propaga un anillo, decae, y
 *                          tira un burst de glyphs claros.
 *   OCEAN.setIntensity(v)→ energía del oleaje, v ∈ [0,1]
 *                          (suavizada internamente, sin saltos).
 *   OCEAN.freeze(b)      → pausa/reanuda (b bool; sin arg → toggle)
 *
 *   extras: OCEAN.time() → reloj interno (el t de surfaceY)
 *           OCEAN.getIntensity() → intensidad actual suavizada
 *           OCEAN.mount(canvas)  → remontar en otro canvas
 *
 * Referencia visual: demo-day/moodboard/raw/ocean.png
 *   — cielo negro casi vacío, mar de crestas horizontales con
 *     clusters brillantes (#,*,=), valles oscuros con puntos
 *     sueltos, cortinas tenues de goteo bajo las crestas.
 * Campo de agua: port Canvas-2D de src/koi3d/water.wgsl
 *   (profundidad + textura fbm + brillo en crestas).
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------------- tunables ---------------------- */
  var SEED    = 0x0CEA4;          // seed fija → reproducible
  var STEP    = 1 / 60;           // timestep fijo (s)
  var MAX_DT  = 0.25;             // clamp de dt real

  // Rampa del contrato ' .·:;~≈+*#%@' afinada contra la referencia:
  // el moodboard usa mucho ' - = y dobles, así que se extiende con
  // "'", '-', '=' manteniendo el orden clara→oscura por densidad.
  var RAMP   = [' ', "'", '·', '.', ':', ';', '-', '~', '=', '≈', '+', '*', '#', '%', '@'];
  var NG     = RAMP.length;
  var SHADES = [0.34, 0.58, 0.80, 1.0];   // grises→blanco, horneados en atlas
  var NS     = SHADES.length;
  var BG     = '#050505';

  var HORIZON  = 0.52;    // línea de agua, fracción del alto
  var D0       = 55;      // perspectiva: separación de crestas crece con profundidad
  var RIDGE_K  = 3.4;     // densidad de crestas en log-depth (~8 visibles)
  var CREST_C  = 0.14;    // fase donde cae el filo de la cresta
  var CREST_W  = 0.34;    // ancho del decaimiento cresta→valle
  var CREST_P  = 1.55;    // exponente de dureza del brillo de cresta
  var LEAN     = 0.0022;  // inclinación diagonal de crestas con profundidad
  var EDGE_TH  = -0.45;   // umbral (×CS) para que la fila que contiene S dibuje

  var MAX_SPLASH = 12;
  var MAX_PART   = 384;
  var GRAV       = 560;   // px/s² partículas del splash

  /* ---------------- rng + ruido determinista ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(ix, iy) {
    var h = (ix * 374761393 + iy * 668265263 + SEED * 1013904223) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }
  // value-noise 2D (suave, barato) — el "fbmPerlin2d" del WGSL, en 2D JS
  function vn2(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy), b = hash2(ix + 1, iy);
    var c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm2(x, y) { // 2 octavas alcanzan para clusters de cresta
    return vn2(x, y) * 0.65 + vn2(x * 2.03 + 13.7, y * 2.03 + 71.3) * 0.35;
  }
  function vn1(x) { return vn2(x, 7.31); }

  /* ---------------------- estado ---------------------- */
  var canvas = null, ctx = null;
  var W = 0, H = 0, dpr = 1;
  var CS = 13, AC = 13;                 // celda CSS / celda atlas (device px)
  var cols = 0, rows = 0, horizon = 0;
  var atlas = null;

  var T = 0;                            // reloj interno (s), timestep fijo
  var I = 0.45, targetI = 0.45;         // intensidad (suavizada / objetivo)
  var frozen = false;
  var splashCount = 0;

  var surf, wob, drip, boil, swg, edgeTex; // arrays por columna (Float32Array)
  var starMap, starPh;                  // cielo: glyph por celda + fase
  var splashes = [];                    // {x0, t0, p}
  var parts = [];                       // pool partículas burst
  for (var pi = 0; pi < MAX_PART; pi++) {
    parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, ttl: 0, g: 0, s: 0 });
  }

  /* ---------------------- atlas ---------------------- */
  function buildAtlas() {
    AC = Math.max(8, Math.round(CS * dpr));
    atlas = document.createElement('canvas');
    atlas.width = NG * AC;
    atlas.height = NS * AC;
    var g = atlas.getContext('2d');
    var fs = Math.round(AC * 0.9);
    g.font = 'bold ' + fs + 'px ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (var s = 0; s < NS; s++) {
      g.fillStyle = 'rgba(255,255,255,' + SHADES[s] + ')';
      for (var c = 0; c < NG; c++) {
        if (RAMP[c] === ' ') continue;
        g.fillText(RAMP[c], c * AC + AC / 2, s * AC + AC / 2 + AC * 0.02);
      }
    }
  }

  /* ---------------- campo de superficie ---------------- */
  // swell base: 3 senos viajeros + noise lento (px). Escala con intensidad.
  function swellBase(x, t) {
    var amp = 0.55 + 0.75 * I;
    return (9.0 * Math.sin(x * 0.0105 - t * 0.85 + 1.7)
          + 5.0 * Math.sin(x * 0.0234 + t * 0.52 + 4.2)
          + 2.4 * Math.sin(x * 0.0520 - t * 1.30 + 0.5)
          + (vn1(x * 0.0038 + t * 0.028) - 0.5) * 13.0) * amp;
  }
  // desplazamiento por splashes: cavidad que rebota + anillo propagante
  function splashDisp(x, t) {
    var s = 0;
    for (var k = 0; k < splashes.length; k++) {
      var sp = splashes[k], tau = t - sp.t0;
      if (tau <= 0 || tau > 5) continue;
      var dx = x - sp.x0, p = sp.p;
      var env = Math.exp(-tau / 1.15) * (1 - Math.exp(-tau * 22));
      var A = (22 + 42 * p) * (0.7 + 0.6 * I);
      var w0 = 34 + 46 * p;
      var ring = Math.abs(dx) - 130 * tau;
      s += A * env * (Math.exp(-(dx * dx) / (w0 * w0)) * Math.cos(8.5 * tau)
                    + 0.55 * Math.exp(-(ring * ring) / (34 * 34)));
    }
    return s;
  }
  // LA superficie — la misma función para dibujar y para surfaceY()
  function surfaceAt(x, t) {
    if (t === undefined) t = T;
    return horizon + swellBase(x, t) + splashDisp(x, t);
  }

  /* ---------------------- partículas ---------------------- */
  function allocPart() {
    for (var i = 0; i < MAX_PART; i++) if (!parts[i].on) return parts[i];
    return null;
  }
  function spawnBurst(x0, pw) {
    var rng = mulberry32((SEED ^ Math.imul(splashCount + 1, 0x9E3779B1)) | 0);
    var yS = surfaceAt(x0, T);
    var gset = [10, 11, 12, 12, 13, 14, 11];          // + * # # % @ *
    var n = 22 + Math.round(70 * pw);
    for (var k = 0; k < n; k++) {
      var pt = allocPart(); if (!pt) return;
      var dir = rng() < 0.5 ? -1 : 1;
      var r = rng();
      pt.on = true;
      pt.x = x0 + (rng() - 0.5) * (16 + 70 * pw);
      pt.y = yS - 2 - rng() * 4;
      pt.vx = dir * (30 + 190 * pw) * r * r + (rng() - 0.5) * 40;
      pt.vy = -(140 + 420 * pw) * (0.35 + 0.65 * rng());
      pt.t = 0; pt.ttl = 0.7 + 0.9 * rng();
      pt.g = gset[(rng() * gset.length) | 0];
      pt.s = rng() < 0.6 ? 3 : 2;
    }
    // corona: pocas, bajas y laterales — el "beso" del impacto
    var n2 = 10 + Math.round(10 * pw);
    var cset = [6, 8, 9, 8];                          // - = ≈ =
    for (var k2 = 0; k2 < n2; k2++) {
      var p2 = allocPart(); if (!p2) return;
      var d2 = rng() < 0.5 ? -1 : 1;
      p2.on = true;
      p2.x = x0 + d2 * (6 + rng() * 24);
      p2.y = yS - 2;
      p2.vx = d2 * (190 + 430 * pw) * (0.4 + 0.6 * rng());
      p2.vy = -(30 + 120 * rng());
      p2.t = 0; p2.ttl = 0.6 + 0.45 * rng();
      p2.g = cset[(rng() * cset.length) | 0];
      p2.s = 2;
    }
  }

  /* ---------------------- resize ---------------------- */
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(80, window.innerWidth);
    H = Math.max(60, window.innerHeight);
    CS = (W * H > 2600000) ? 16 : 13;      // pantallas enormes: celda mayor
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / CS);
    rows = Math.ceil(H / CS);
    horizon = H * HORIZON;
    buildAtlas();
    surf = new Float32Array(cols);
    wob  = new Float32Array(cols);
    drip = new Float32Array(cols);
    boil = new Float32Array(cols);
    swg  = new Float32Array(cols);
    edgeTex = new Float32Array(cols);
    // cielo: estrellas rarísimas, deterministas por celda
    starMap = new Uint8Array(cols * rows);
    starPh  = new Float32Array(cols * rows);
    for (var j = 0; j < rows; j++) {
      var y = (j + 0.5) * CS;
      if (y > horizon + CS) break;
      for (var i = 0; i < cols; i++) {
        var h = hash2(i ^ 0x5A5A, j + 977);
        if (h < 0.0022) {
          var idx = j * cols + i;
          starMap[idx] = h < 0.0004 ? 2 : 1;   // '·' o "'"
          starPh[idx] = h * 61000;
        }
      }
    }
  }

  /* ---------------------- step (fijo) ---------------------- */
  function step() {
    I += (targetI - I) * Math.min(1, STEP * 2.0);   // sin saltos 0→1
    var rate = 0.8 + 0.5 * I;                        // intensidad = +velocidad
    T += STEP * rate;
    var dt = STEP * rate;
    for (var i = 0; i < MAX_PART; i++) {
      var p = parts[i];
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.ttl || p.x < -CS || p.x > W + CS) { p.on = false; continue; }
      p.vy += GRAV * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vy > 0 && p.y > surfaceAt(p.x, T) + 2) p.on = false; // reingresa
    }
  }

  /* ---------------------- render ---------------------- */
  function render() {
    var i, j, x, y;
    // ---- por columna: superficie, wobble de crestas, goteo, espuma
    for (i = 0; i < cols; i++) {
      x = (i + 0.5) * CS;
      surf[i] = surfaceAt(x, T);
      // grandes swells: las crestas cabalgan olas largas (la referencia
      // muestra bandas subiendo/bajando ±2-3 espacios de cresta en arcos)
      var sw1 = Math.sin(x * 0.0027 - T * 0.13 + 0.8);          // λ≈2300px
      var sw2 = Math.sin(x * 0.0061 + T * 0.10 + 3.3);          // λ≈1030px
      wob[i] = 1.10 * sw1
             + 0.55 * sw2
             + 0.35 * (vn1(x * 0.0055 - T * 0.045) - 0.5)
             + (0.08 + 0.22 * I) * Math.sin(x * 0.085 - T * 2.1);
      // cara del swell: los clusters brillantes se concentran ahí
      swg[i] = 0.5 + 0.5 * Math.sin(x * 0.0027 - T * 0.13 + 2.4);
      // modulación del filo: tramos brillantes/tenues pero nunca roto
      edgeTex[i] = vn1(x * 0.011 - T * 0.12 + 7.0);
      var dr = vn1(x * 0.021 + 40.7 - T * 0.007);
      drip[i] = dr > 0.82 ? (dr - 0.82) * 1.4 : 0;
      var b = 0;
      for (var s = 0; s < splashes.length; s++) {
        var sp = splashes[s], tau = T - sp.t0;
        if (tau <= 0 || tau > 5) continue;
        var dx = x - sp.x0;
        b += sp.p * 1.35 * Math.exp(-tau / 1.1) * (tau * 6 > 1 ? 1 : tau * 6)
           * Math.exp(-(dx * dx) / 3600);
      }
      boil[i] = b;
    }

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    var edgeW = CS * CS * 0.6;
    var tx0 = T * 0.055, ty0 = T * 0.012;
    var t2y = T * 0.018;

    for (j = 0; j < rows; j++) {
      y = (j + 0.5) * CS;
      var ty = y * 0.045 + ty0;
      var ty2 = y * 0.033 - t2y;
      var rowBase = j * cols;
      var ypx = j * CS;
      for (i = 0; i < cols; i++) {
        var d = y - surf[i];
        var cell = rowBase + i;
        if (d < EDGE_TH * CS) {
          // cielo: estrella ocasional
          var sv = starMap[cell];
          if (sv) {
            var tw = Math.sin(T * (0.3 + starPh[cell] % 0.9) + starPh[cell]);
            ctx.drawImage(atlas, sv * AC, tw > 0.3 ? AC : 0, AC, AC,
              i * CS, ypx, CS, CS);
          }
          continue;
        }
        // ---- agua ----
        var dd = d > 0 ? d : 0;
        var ph = RIDGE_K * Math.log(1 + dd / D0) + wob[i] + LEAN * dd;
        var ridgeN = Math.floor(ph);
        var f = ph - ridgeN;
        var u = f - CREST_C; if (u < 0) u += 1;
        var p = 0;
        if (u < CREST_W) p = Math.pow(Math.cos(u / CREST_W * 1.5707963), CREST_P);
        x = (i + 0.5) * CS;
        // textura anclada a la cresta → clusters continuos a lo largo
        // de cada banda (como la referencia), no estática 2D
        var tex = fbm2(x * 0.0065 - tx0 + ridgeN * 3.1, ridgeN * 9.7);
        tex = tex * tex * (3 - 2 * tex);   // smoothstep → clusters binarios
        var face = 0.32 + 1.05 * swg[i];   // contraste cara-iluminada vs valle
        tex *= face;
        var gain = 0.55 + 0.55 * (dd / (dd + 180));
        // zona somera: las primeras ~2 filas funden las crestas en una
        // banda luminosa continua (evita "static TV" bajo la línea)
        var k = dd < 4 ? 0 : dd > 26 ? 1 : (dd - 4) / 22;
        var pUse = p * (0.30 + 0.70 * k);
        var v = pUse * (0.42 + 0.28 * swg[i] + 1.15 * tex) * gain * 0.93;
        // en tormenta el foam somero se dispersa (evita bloque blanco)
        v += (1 - k) * (0.26 + 0.42 * tex) * (0.75 + 0.40 * swg[i])
           * (1 - 0.22 * I);
        // filo luminoso: garantizado continuo, modulado (no regla sólida)
        var e = Math.exp(-(d * d) / edgeW);
        var vEdge = e * (0.48 + 0.52 * edgeTex[i]);
        if (vEdge > v) v = vEdge;
        var t2 = vn2(x * 0.033 + 911.7, ty2);
        v += (t2 > 0.77 ? (t2 - 0.77) * 0.40 : 0) * (1.25 - 0.85 * swg[i]);
        if (drip[i] > 0) v += drip[i] * Math.exp(-dd / 120) * (1 - p) * (0.45 + 0.5 * tex);
        if (boil[i] > 0.01) v += boil[i] * Math.exp(-dd / 42) * (0.45 + 0.85 * tex);
        var lum = v * 1.22 + e * (0.55 + 0.30 * edgeTex[i]) + p * 0.24;
        if (v > 1) v = 1; if (lum > 1) lum = 1;
        var gi = (v * (NG - 1) + 0.5) | 0;
        if (gi <= 0) continue;
        var si = lum < 0.24 ? 0 : lum < 0.42 ? 1 : lum < 0.58 ? 2 : 3;
        ctx.drawImage(atlas, gi * AC, si * AC, AC, AC, i * CS, ypx, CS, CS);
      }
    }

    // ---- partículas del splash (snapeadas a la grilla)
    for (i = 0; i < MAX_PART; i++) {
      var pt = parts[i];
      if (!pt.on) continue;
      ctx.drawImage(atlas, pt.g * AC, pt.s * AC, AC, AC,
        Math.round(pt.x / CS) * CS, Math.round(pt.y / CS) * CS, CS, CS);
    }
  }

  /* ---------------------- loop ---------------------- */
  var last = -1, acc = 0, rafId = 0;
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (last < 0) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_DT) dt = MAX_DT;
    if (!frozen) {
      acc += dt;
      var n = 0;
      while (acc >= STEP && n < 8) { step(); acc -= STEP; n++; }
      if (n === 8) acc = 0;   // nunca espiral de la muerte
    }
    if (ctx) render();
  }

  /* ---------------------- API ---------------------- */
  var OCEAN = {
    surfaceY: function (x, t) { return surfaceAt(+x || 0, t); },
    splash: function (x, power) {
      var p = +power;
      if (power === undefined || power === null || !isFinite(p)) p = 0.5;
      if (p > 1) p = 1; if (p < 0) p = 0;
      splashCount++;
      splashes.push({ x0: Math.max(0, Math.min(W, +x || 0)), t0: T, p: p });
      if (splashes.length > MAX_SPLASH) splashes.shift();
      spawnBurst(+x || 0, p);
    },
    setIntensity: function (v) {
      targetI = Math.max(0, Math.min(1, +v || 0));
    },
    freeze: function (b) { frozen = (b === undefined) ? !frozen : !!b; },
    time: function () { return T; },
    getIntensity: function () { return I; },
    mount: function (cv) { mount(cv); },
    _bench: function (n) {   // debug: ms por render
      var t0 = performance.now();
      for (var i = 0; i < (n || 30); i++) render();
      return (performance.now() - t0) / (n || 30);
    },
  };
  window.OCEAN = OCEAN;

  /* ---------------------- boot ---------------------- */
  function mount(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    resize();
    if (!rafId) {
      last = -1; acc = 0;
      rafId = requestAnimationFrame(frame);
    }
  }
  function boot() {
    var cv = document.getElementById('bg');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'bg';
      cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;'
                       + 'z-index:1;pointer-events:none;';
      document.body.appendChild(cv);
    }
    mount(cv);
  }
  window.addEventListener('resize', resize);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

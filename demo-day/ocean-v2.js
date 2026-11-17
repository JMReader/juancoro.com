/* ============================================================
 * demo-day — FONDO v2: océano ASCII REALISTA  (agente fondo)
 * ------------------------------------------------------------
 * B&W puro sobre #050505. Determinista: seed fija + rAF con
 * timestep fijo (STEP=1/60). Vanilla JS, sin dependencias.
 *
 * Mismo contrato que ocean.js (window.OCEAN):
 *   surfaceY(x,t) · splash(x,p) · setIntensity(v) · freeze(b)
 *   extras: time() getIntensity() mount(canvas) _bench(n)
 *
 * Diferencias vs v1 — física de mar nocturno:
 *   1. ESPECTRO de armónicos direccionales con dispersión
 *      ω ∝ √k: trenes de olas viajan hacia el espectador con
 *      componentes oblicuos (interferencia de mar cruzado).
 *      Las crestas se desplazan con el campo, no son un fbm fijo.
 *   2. PAQUETES de olas discretos: una ola nace cerca del
 *      horizonte, viaja (también en diagonal), crece por
 *      shoaling, ROMPE (whitecap + chorro ~≈ hacia adelante)
 *      y muere dejando estela de espuma.
 *   3. FOAM persistente (buffer por celda): decae y difunde;
 *      crestas rompientes, ráfagas y splashes la alimentan.
 *   4. GUSTS de viento: parches que erizan la superficie,
 *      levantan micro-foam y spray lateral.
 *   5. Shading por pendiente del campo (∂H/∂z): caras hacia
 *      el espectador iluminadas, lomos en penumbra.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------------- tunables ---------------------- */
  var SEED    = 0x0CEA4;          // seed fija → reproducible (misma que v1)
  var STEP    = 1 / 60;           // timestep fijo (s)
  var MAX_DT  = 0.25;             // clamp de dt real

  // Misma rampa afinada de v1 (moodboard usa mucho ' - = ≈)
  var RAMP   = [' ', "'", '·', '.', ':', ';', '-', '~', '=', '≈', '+', '*', '#', '%', '@'];
  var NG     = RAMP.length;
  var SHADES = [0.34, 0.58, 0.80, 1.0];
  var NS     = SHADES.length;
  var BG     = '#050505';

  var HORIZON  = 0.52;
  var D0       = 55;      // perspectiva log-depth (igual que v1)
  var RIDGE_K  = 3.4;
  var CREST_C  = 0.14;
  var CREST_W  = 0.34;
  var CREST_P  = 1.55;
  var LEAN     = 0.0022;
  var EDGE_TH  = -0.45;

  var MAX_SPLASH = 12;
  var MAX_PART   = 448;           // +spill de rompedores
  var GRAV       = 560;

  var NW         = 10;            // armónicos del espectro
  var MAX_PK     = 9;             // paquetes de olas simultáneos
  var MAX_GUST   = 3;             // ráfagas simultáneas
  var FOAM_DECAY = 0.9935;        // por step → estela ~3-5 s
  var FOAM_DIFF  = 0.16;          // difusión horizontal por step
  var WIND_DIR   = 1;             // viento predominante (+x)

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
  function vn2(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy), b = hash2(ix + 1, iy);
    var c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm2(x, y) {
    return vn2(x, y) * 0.65 + vn2(x * 2.03 + 13.7, y * 2.03 + 71.3) * 0.35;
  }
  function vn1(x) { return vn2(x, 7.31); }

  /* ============ ESPECTRO DE OLEAJE (armónicos) ============
   * Cada componente: A·sin(kx·x + kl·ph − ω·t + φ).
   * kl > 0 → la fase baja por la pantalla (viaja hacia el
   * espectador). ω = c·√kl → dispersión: olas largas más
   * rápidas (física de aguas profundas). kx con sesgo de
   * dirección → crestas oblicuas + mar cruzado.           */
  var WV = (function () {
    var rng = mulberry32((SEED ^ 0x5EED) | 0);
    var a = [];
    for (var i = 0; i < NW; i++) {
      var P  = 1.45 + i * 0.30 + rng() * 0.55;    // período en unid. ph
      var kl = 6.28318 / P;
      var lx = 260 + rng() * 2100;                 // λ lateral (px)
      var kx = 6.28318 / lx * (rng() < 0.68 ? 1 : -1) * WIND_DIR;
      var om = 1.85 * Math.sqrt(kl);               // ω ∝ √k (dispersión)
      var am = 0.62 / (1 + i * i * 0.16) * (0.55 + 0.45 * rng());
      a.push({ kx: kx, kl: kl, w: om, a: am, ph: rng() * 6.28318 });
    }
    return a;
  })();

  // Campo H en (x,ph,t) → guarda shift y pendiente en wvS/wvD
  var wvS = 0, wvD = 0;
  function waveField(x, ph, t) {
    var s = 0, d = 0, q;
    for (var k = 0; k < NW; k++) {
      var w = WV[k];
      q = w.kx * x + w.kl * ph - w.w * t + w.ph;
      s += w.a * Math.sin(q);
      d += w.a * w.kl * Math.cos(q);
    }
    wvS = s; wvD = d;
  }

  /* ============ PAQUETES DE OLAS (hero waves) ============
   * Entidad discreta: nace en ph≈0.4 cerca del horizonte,
   * viaja (vph + deriva lateral vx), crece (shoaling) y al
   * superar brkPh rompe ~1.3 s (foam + spill) y muere.
   * Spawn/params por rng indexado → bit-determinista.      */
  var packets = [];
  for (var pki = 0; pki < MAX_PK; pki++) {
    packets.push({ on: false, x0: 0, w: 1, ph: 0, vph: 0, vx: 0,
                   amp: 0, age: 0, dur: 0, brkPh: 0, brk: 0, r: null });
  }
  var pkSpawnN = 0, pkNext = 1.2;   // primer paquete ~1 s

  function spawnPacket() {
    var rng = mulberry32((SEED ^ Math.imul(pkSpawnN + 101, 0x85EBCA77)) | 0);
    pkSpawnN++;
    for (var i = 0; i < MAX_PK; i++) {
      var p = packets[i];
      if (p.on) continue;
      p.on = true;
      p.x0 = 0.08 * W + rng() * 0.84 * W;
      p.w = 130 + rng() * 360;
      p.ph = 0.30 + rng() * 0.45;
      p.vph = 0.55 + rng() * 0.50;
      p.vx = (rng() - 0.5) * 34;                  // deriva lateral
      p.amp = 0.55 + rng() * 0.45;
      p.age = 0;
      p.dur = 13 + rng() * 5;
      p.brkPh = 2.0 + rng() * 3.4;
      p.brk = 0;
      p.r = rng;                                   // rng propio (determinista)
      return;
    }
  }

  /* ============ GUSTS (ráfagas de viento) ============ */
  var gusts = [];
  for (var gi0 = 0; gi0 < MAX_GUST; gi0++) {
    gusts.push({ on: false, x0: 0, w: 1, t0: 0, dur: 0, str: 0 });
  }
  var gSpawnN = 0, gNext = 3.5;
  function spawnGust() {
    var rng = mulberry32((SEED ^ Math.imul(gSpawnN + 977, 0xC2B2AE3D)) | 0);
    gSpawnN++;
    for (var i = 0; i < MAX_GUST; i++) {
      var g = gusts[i];
      if (g.on) continue;
      g.on = true;
      g.x0 = rng() * W;
      g.w = 260 + rng() * 520;
      g.t0 = T;
      g.dur = 1.6 + rng() * 1.8;
      g.str = 0.6 + rng() * 0.4;
      return;
    }
  }

  /* ---------------------- estado ---------------------- */
  var canvas = null, ctx = null;
  var W = 0, H = 0, dpr = 1;
  var CS = 13, AC = 13;
  var cols = 0, rows = 0, horizon = 0;
  var atlas = null;

  var T = 0;
  var I = 0.45, targetI = 0.45;
  var frozen = false;
  var splashCount = 0;

  var surf, wob, drip, boil, swg, edgeTex;
  var pkAmp, pkPh, pkBrk;                 // influencia de paquetes/columna
  var foam, foam2;                        // espuma persistente (ping-pong)
  var starMap, starPh;
  var splashes = [];
  var parts = [];
  for (var pi = 0; pi < MAX_PART; pi++) {
    parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, ttl: 0, g: 0, s: 0, sp: 0 });
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
  // Línea de agua: swells largos (mismos armónicos lentos del
  // espectro para que la línea respire con los trenes) + noise.
  function swellLine(x, t) {
    var amp = 0.55 + 0.75 * I;
    var s = 8.0 * Math.sin(x * 0.0105 - t * 0.85 + 1.7)
          + 4.5 * Math.sin(x * 0.0234 + t * 0.52 + 4.2);
    // componentes largos del espectro (los 3 primeros, kl bajo)
    for (var k = 0; k < 3; k++) {
      var w = WV[k];
      s += w.a * 7.5 * Math.sin(w.kx * x - w.w * t + w.ph);
    }
    s += (vn1(x * 0.0038 + t * 0.028) - 0.5) * 13.0;
    return s * amp;
  }
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
  function surfaceAt(x, t) {
    if (t === undefined) t = T;
    return horizon + swellLine(x, t) + splashDisp(x, t);
  }

  /* ---------------------- partículas ---------------------- */
  function allocPart() {
    for (var i = 0; i < MAX_PART; i++) if (!parts[i].on) return parts[i];
    return null;
  }
  function spawnBurst(x0, pw) {
    var rng = mulberry32((SEED ^ Math.imul(splashCount + 1, 0x9E3779B1)) | 0);
    var yS = surfaceAt(x0, T);
    var gset = [10, 11, 12, 12, 13, 14, 11];
    var n = 22 + Math.round(70 * pw);
    for (var k = 0; k < n; k++) {
      var pt = allocPart(); if (!pt) return;
      var dir = rng() < 0.5 ? -1 : 1;
      var r = rng();
      pt.on = true; pt.sp = 0;
      pt.x = x0 + (rng() - 0.5) * (16 + 70 * pw);
      pt.y = yS - 2 - rng() * 4;
      pt.vx = dir * (30 + 190 * pw) * r * r + (rng() - 0.5) * 40;
      pt.vy = -(140 + 420 * pw) * (0.35 + 0.65 * rng());
      pt.t = 0; pt.ttl = 0.7 + 0.9 * rng();
      pt.g = gset[(rng() * gset.length) | 0];
      pt.s = rng() < 0.6 ? 3 : 2;
    }
    var n2 = 10 + Math.round(10 * pw);
    var cset = [6, 8, 9, 8];
    for (var k2 = 0; k2 < n2; k2++) {
      var p2 = allocPart(); if (!p2) return;
      var d2 = rng() < 0.5 ? -1 : 1;
      p2.on = true; p2.sp = 0;
      p2.x = x0 + d2 * (6 + rng() * 24);
      p2.y = yS - 2;
      p2.vx = d2 * (190 + 430 * pw) * (0.4 + 0.6 * rng());
      p2.vy = -(30 + 120 * rng());
      p2.t = 0; p2.ttl = 0.6 + 0.45 * rng();
      p2.g = cset[(rng() * cset.length) | 0];
      p2.s = 2;
    }
  }
  // spill de rompedor: glyphs ~≈ cayendo hacia adelante
  function spawnSpill(xPx, yPx, r) {
    var pt = allocPart(); if (!pt) return;
    var sset = [7, 8, 9, 9, 7];                      // ~ = ≈ ≈ ~
    pt.on = true; pt.sp = 1;                          // no muere al reingresar
    pt.x = xPx;
    pt.y = yPx;
    pt.vx = (r() - 0.5) * 60 + WIND_DIR * 18;
    pt.vy = 24 + r() * 66;                            // cae hacia adelante
    pt.t = 0; pt.ttl = 0.45 + r() * 0.5;
    pt.g = sset[(r() * sset.length) | 0];
    pt.s = r() < 0.4 ? 3 : 2;
  }
  // spray de ráfaga: raya horizontal rápida sobre la superficie
  function spawnSpray(xPx, yPx, r) {
    var pt = allocPart(); if (!pt) return;
    var sset = [1, 2, 6];                             // ' · -
    pt.on = true; pt.sp = 1;
    pt.x = xPx;
    pt.y = yPx;
    pt.vx = WIND_DIR * (240 + r() * 260);
    pt.vy = -14 - r() * 30;
    pt.t = 0; pt.ttl = 0.35 + r() * 0.3;
    pt.g = sset[(r() * sset.length) | 0];
    pt.s = 1;
  }

  /* ---------------------- foam ---------------------- */
  function injectFoam(xPx, yPx, rx, ry, amt) {
    // mancha gaussiana en la grilla de celdas
    var i0 = Math.max(0, Math.floor((xPx - rx) / CS));
    var i1 = Math.min(cols - 1, Math.ceil((xPx + rx) / CS));
    var j0 = Math.max(0, Math.floor((yPx - ry) / CS));
    var j1 = Math.min(rows - 1, Math.ceil((yPx + ry) / CS));
    for (var j = j0; j <= j1; j++) {
      var dy = ((j + 0.5) * CS - yPx) / ry;
      var ey = dy * dy;
      if (ey > 3) continue;
      var rb = j * cols;
      for (var i = i0; i <= i1; i++) {
        var dx = ((i + 0.5) * CS - xPx) / rx;
        var e = dx * dx + ey;
        if (e > 3) continue;
        var idx = rb + i;
        foam[idx] += amt * Math.exp(-e);
        if (foam[idx] > 1.6) foam[idx] = 1.6;
      }
    }
  }
  function stepFoam(dt) {
    // decay + difusión horizontal (ping-pong)
    for (var j = 0; j < rows; j++) {
      var rb = j * cols;
      var prev = foam[rb] * FOAM_DECAY;
      for (var i = 0; i < cols; i++) {
        var idx = rb + i;
        var cur = foam[idx] * FOAM_DECAY;
        var nxt = (i + 1 < cols ? foam[idx + 1] * FOAM_DECAY : cur);
        foam2[idx] = cur + (0.5 * (prev + nxt) - cur) * FOAM_DIFF;
        prev = cur;
      }
    }
    var sw = foam; foam = foam2; foam2 = sw;
  }

  /* ---------------------- resize ---------------------- */
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(80, window.innerWidth);
    H = Math.max(60, window.innerHeight);
    CS = (W * H > 2600000) ? 16 : 13;
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
    pkAmp = new Float32Array(cols);
    pkPh  = new Float32Array(cols);
    pkBrk = new Float32Array(cols);
    foam  = new Float32Array(cols * rows);
    foam2 = new Float32Array(cols * rows);
    starMap = new Uint8Array(cols * rows);
    starPh  = new Float32Array(cols * rows);
    for (var j = 0; j < rows; j++) {
      var y = (j + 0.5) * CS;
      if (y > horizon + CS) break;
      for (var i = 0; i < cols; i++) {
        var h = hash2(i ^ 0x5A5A, j + 977);
        if (h < 0.0022) {
          var idx = j * cols + i;
          starMap[idx] = h < 0.0004 ? 2 : 1;
          starPh[idx] = h * 61000;
        }
      }
    }
  }

  /* ---------------------- step (fijo) ---------------------- */
  function step() {
    I += (targetI - I) * Math.min(1, STEP * 2.0);
    var rate = 0.8 + 0.5 * I;
    T += STEP * rate;
    var dt = STEP * rate;
    var i;

    // partículas
    for (i = 0; i < MAX_PART; i++) {
      var p = parts[i];
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.ttl || p.x < -CS || p.x > W + CS) { p.on = false; continue; }
      p.vy += GRAV * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!p.sp && p.vy > 0 && p.y > surfaceAt(p.x, T) + 2) p.on = false;
    }

    // paquetes: spawn + avance + ruptura
    pkNext -= dt;
    if (pkNext <= 0) {
      var rpk = mulberry32((SEED ^ Math.imul(pkSpawnN + 53, 0x27D4EB2F)) | 0);
      spawnPacket();
      pkNext = (1.7 + rpk() * 2.6) / (0.65 + 0.55 * I);
    }
    for (i = 0; i < MAX_PK; i++) {
      var pk = packets[i];
      if (!pk.on) continue;
      pk.age += dt;
      pk.ph += pk.vph * dt * (0.7 + 0.5 * I);
      pk.x0 += pk.vx * dt;
      var grow = Math.min(1, pk.age / 2.2);          // nace suave
      var eff = pk.amp * grow * (0.55 + 0.65 * I);
      // ruptura al alcanzar brkPh (shoaling): ~1.4 s rompiendo
      if (pk.brk === 0 && pk.ph >= pk.brkPh) pk.brk = 1e-4;
      if (pk.brk > 0) {
        pk.brk += dt / 1.4;
        if (pk.brk >= 1) pk.brk = 0;                 // rompió y murió
        else {
          // foam + chorro ~≈ cayendo hacia adelante (frente = +dd)
          var yC = horizon + D0 * (Math.exp(Math.min(pk.ph, 8) / RIDGE_K) - 1);
          var bfrac = Math.sin(pk.brk * 3.14159);     // pico a mitad
          var r = pk.r;
          var nsp = (bfrac * eff * 3.2) | 0;
          for (var s2 = 0; s2 <= nsp; s2++) {
            spawnSpill(pk.x0 + (r() - 0.5) * pk.w * 1.5,
                       yC + CS * (1 + r() * 2), r);
          }
          injectFoam(pk.x0, yC + CS, pk.w * 0.7, CS * 2.2,
                     0.10 * bfrac * eff + 0.02);
        }
      }
      if (pk.age > pk.dur || pk.ph > 9.5 ||
          pk.x0 < -pk.w * 3 || pk.x0 > W + pk.w * 3) pk.on = false;
    }

    // ráfagas: spawn + spray + microfoam
    gNext -= dt;
    if (gNext <= 0) {
      var rg = mulberry32((SEED ^ Math.imul(gSpawnN + 7, 0x9E3779B1)) | 0);
      spawnGust();
      gNext = (5 + rg() * 8) / (0.7 + 0.5 * I);
    }
    for (i = 0; i < MAX_GUST; i++) {
      var g = gusts[i];
      if (!g.on) continue;
      var tau = T - g.t0;
      if (tau > g.dur) { g.on = false; continue; }
      var env = Math.sin(Math.min(1, tau / g.dur) * 3.14159);
      env *= env * g.str * (0.5 + 0.7 * I);
      var c0 = Math.max(0, Math.floor((g.x0 - g.w) / CS));
      var c1 = Math.min(cols - 1, Math.ceil((g.x0 + g.w) / CS));
      var rr = mulberry32((SEED ^ ((i * 131071 + (T * 60) | 0) * 2654435761)) | 0);
      for (var ci = c0; ci <= c1; ci++) {
        var gx = (ci + 0.5) * CS;
        var env2 = Math.exp(-((gx - g.x0) * (gx - g.x0)) / (g.w * g.w * 0.4));
        if (env2 < 0.08 || rr() < 0.45) continue;
        var ys = surfaceAt(gx, T);
        var jf = Math.floor(ys / CS) + 1;
        if (jf < rows) {
          var fidx = jf * cols + ci;
          foam[fidx] += 0.05 * env * env2;
        }
      }
      if (env > 0.25) {
        var r2 = mulberry32((SEED ^ (((T * 60) | 0) * 40503 + i)) | 0);
        spawnSpray(g.x0 + (r2() - 0.5) * g.w * 1.6,
                   surfaceAt(g.x0, T) - CS * 0.5 - r2() * CS, r2);
      }
    }

    // splash → mancha de espuma persistente (además de boil)
    for (i = 0; i < splashes.length; i++) {
      var sp = splashes[i], tau = T - sp.t0;
      if (tau <= 0 || tau > 3) continue;
      if (tau < 0.6) {
        injectFoam(sp.x0, surfaceAt(sp.x0, T) + CS,
                   (40 + 80 * sp.p) + tau * 220, CS * 2,
                   0.09 * sp.p * (1 - tau / 0.6));
      }
    }

    stepFoam(dt);
  }

  /* ---------------------- render ---------------------- */
  function render() {
    var i, j, x, y;
    for (i = 0; i < cols; i++) {
      x = (i + 0.5) * CS;
      surf[i] = surfaceAt(x, T);
      var sw1 = Math.sin(x * 0.0027 - T * 0.13 + 0.8);
      var sw2 = Math.sin(x * 0.0061 + T * 0.10 + 3.3);
      wob[i] = 1.10 * sw1
             + 0.55 * sw2
             + 0.35 * (vn1(x * 0.0055 - T * 0.045) - 0.5)
             + (0.08 + 0.22 * I) * Math.sin(x * 0.085 - T * 2.1);
      swg[i] = 0.5 + 0.5 * Math.sin(x * 0.0027 - T * 0.13 + 2.4);
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
      pkAmp[i] = 0; pkPh[i] = 0; pkBrk[i] = 0;
    }

    // influencia de paquetes por columna (el más fuerte manda)
    for (var pki = 0; pki < MAX_PK; pki++) {
      var pk = packets[pki];
      if (!pk.on) continue;
      var grow = Math.min(1, pk.age / 2.2);
      var eff = pk.amp * grow * (0.55 + 0.65 * I);
      if (eff < 0.04) continue;
      var reach = pk.w * 1.9;
      var c0 = Math.max(0, Math.floor((pk.x0 - reach) / CS));
      var c1 = Math.min(cols - 1, Math.ceil((pk.x0 + reach) / CS));
      for (i = c0; i <= c1; i++) {
        var ddx = ((i + 0.5) * CS - pk.x0) / pk.w;
        var g = eff * Math.exp(-ddx * ddx * 1.6);
        if (g > pkAmp[i]) {
          pkAmp[i] = g;
          pkPh[i] = pk.ph;
          pkBrk[i] = pk.brk > 0 ? Math.sin(pk.brk * 3.14159) : 0;
        }
      }
    }

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    var edgeW = CS * CS * 0.6;
    var tx0 = T * 0.055;
    var t2y = T * 0.018;
    var pull = 0.62 + 0.35 * I;      // cuánto desplazan las olas a las crestas
    var slopeK = 0.055 + 0.05 * I;   // luz por pendiente del campo

    for (j = 0; j < rows; j++) {
      y = (j + 0.5) * CS;
      var ty2 = y * 0.033 - t2y;
      var rowBase = j * cols;
      var ypx = j * CS;
      for (i = 0; i < cols; i++) {
        var d = y - surf[i];
        var cell = rowBase + i;
        if (d < EDGE_TH * CS) {
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
        x = (i + 0.5) * CS;
        // campo armónico: desplaza la fase de cresta (olas que viajan)
        waveField(x, ph, T);
        var ph2 = ph + wvS * pull;
        var ridgeN = Math.floor(ph2);
        var f = ph2 - ridgeN;
        var u = f - CREST_C; if (u < 0) u += 1;
        var p = 0;
        if (u < CREST_W) p = Math.pow(Math.cos(u / CREST_W * 1.5707963), CREST_P);
        // textura anclada a la banda SIN shift → sin flicker al viajar
        var bandN = Math.floor(ph + 0.5);
        var tex = fbm2(x * 0.0065 - tx0 + bandN * 3.1, bandN * 9.7);
        tex = tex * tex * (3 - 2 * tex);
        var face = 0.32 + 1.05 * swg[i];
        tex *= face;
        var gain = 0.55 + 0.55 * (dd / (dd + 180));
        var k = dd < 4 ? 0 : dd > 26 ? 1 : (dd - 4) / 22;
        var pUse = p * (0.30 + 0.70 * k);
        var v = pUse * (0.42 + 0.28 * swg[i] + 1.15 * tex) * gain * 0.93;
        v += (1 - k) * (0.26 + 0.42 * tex) * (0.75 + 0.40 * swg[i])
           * (1 - 0.22 * I);
        var e = Math.exp(-(d * d) / edgeW);
        var vEdge = e * (0.48 + 0.52 * edgeTex[i]);
        if (vEdge > v) v = vEdge;
        var t2 = vn2(x * 0.033 + 911.7, ty2);
        v += (t2 > 0.77 ? (t2 - 0.77) * 0.40 : 0) * (1.25 - 0.85 * swg[i]);
        if (drip[i] > 0) v += drip[i] * Math.exp(-dd / 120) * (1 - p) * (0.45 + 0.5 * tex);
        if (boil[i] > 0.01) v += boil[i] * Math.exp(-dd / 42) * (0.45 + 0.85 * tex);
        var lum = v * 1.22 + e * (0.55 + 0.30 * edgeTex[i]) + p * 0.24;
        // luz por pendiente del campo: cara hacia el espectador gana,
        // lomo opuesto pierde — direccional, como luna adelante
        var sl = wvD * slopeK;
        if (sl > 0) { lum += sl; v += sl * 0.4; }
        else { v += sl * 0.5; }
        // cresta del paquete hero (local en ph, con envolvente x)
        var pa = pkAmp[i];
        if (pa > 0.03) {
          var dq = (ph - pkPh[i]) * 2.7;
          var pkc = pa * Math.exp(-dq * dq);
          if (pkc > p) p = pkc;
          v += pkc * (0.38 + 0.5 * tex);
          lum += pkc * 0.6;
          // whitecap activo: el frente rompiente quema blanco
          var bk = pkBrk[i];
          if (bk > 0.1) lum += bk * pkc * 0.5;
        }
        // foam persistente: estelas + whitecaps
        var fm = foam[cell];
        if (fm > 0.03) {
          var hf = hash2(i * 7 + j * 131, 4);      // moteado estable
          v += fm * (0.30 + 0.55 * hf);
          lum += fm * 0.85;
        }
        if (v > 1) v = 1; if (lum > 1) lum = 1;
        var gi = (v * (NG - 1) + 0.5) | 0;
        if (gi <= 0) continue;
        // foam espesa fuerza glyph denso (espuma = sólida)
        if (fm > 0.5) { var gf = 9 + ((fm - 0.5) * 6) | 0; if (gf > gi) gi = gf; if (gi > NG - 1) gi = NG - 1; }
        var si = lum < 0.24 ? 0 : lum < 0.42 ? 1 : lum < 0.58 ? 2 : 3;
        ctx.drawImage(atlas, gi * AC, si * AC, AC, AC, i * CS, ypx, CS, CS);
      }
    }

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
      if (n === 8) acc = 0;
    }
    if (ctx) render();
  }

  /* ---------------------- API (idéntica a v1) ---------------------- */
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
    _bench: function (n) {
      var t0 = performance.now();
      for (var i = 0; i < (n || 30); i++) render();
      return (performance.now() - t0) / (n || 30);
    },
    _state: function () {   // debug: paquetes/ráfagas/espuma
      var np = 0, nb = 0, fm = 0;
      for (var i = 0; i < MAX_PK; i++)
        if (packets[i].on) { np++; if (packets[i].brk > 0) nb++; }
      for (var c = 0; c < foam.length; c++) if (foam[c] > fm) fm = foam[c];
      var ng = 0;
      for (var g2 = 0; g2 < MAX_GUST; g2++) if (gusts[g2].on) ng++;
      return { packets: np, breaking: nb, gusts: ng, foamMax: +fm.toFixed(2), t: +T.toFixed(2) };
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

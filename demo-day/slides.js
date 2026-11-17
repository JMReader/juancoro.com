/*
 * slides.js — capa DOM de slides (#slides, z=3).
 * "CÓMO SER MANIJA CAMBIA VIDAS" — demo day Builders OFF The Record.
 *
 * Contrato: las letras de cada slide son <span class="ch"> para kinetic
 * type y para que KOI "se lleve las letras" (lee rects via SLIDES.chars).
 * El océano ASCII es la metáfora del promedio — slide 4 se hunde en él.
 */
window.SLIDES = (() => {
  'use strict';

  const PH = 'assets/photos/';

  /* Contenido aprobado por Juan (wording cerrado). */
  const DECK = [
    {
      id: 'intro',
      big: 'CÓMO SER MANIJA CAMBIA VIDAS',
      sub: '',
      photos: [],
    },
    {
      id: 'jujuy',
      big: 'JUJUY → MELI',
      sub: 'romper todos los techos',
      photos: ['movimiento-3.jpg', 'me21-1.jpg'],
    },
    {
      id: 'charla',
      big: 'EL PROMEDIO ARGENTINO:',
      sub: 'MELI O NARANJA X',
      photos: [],
    },
    {
      id: 'frase',
      big: 'EN EL PROMEDIO',
      sub: 'LOS PETISOS SE AHOGAN',
      photos: [],
      exit: 'sink',          // la frase se ahoga sola en el océano
      sink: true,
    },
    {
      id: 'proceso',
      big: 'SILVER.DEV → LAZO',
      sub: 'senior · día 3: prod',
      photos: ['li-lazo-join.jpg'],
    },
    {
      id: 'movimiento',
      big: '1200 KM — SIN ENTRADA',
      sub: '6–7 BA · TERRIA ★ · asado · CONTRATAR + PRESTAR',
      photos: [
        'win-hackcba-1.jpg', 'movimiento-2.jpg', 'artu-grokbot-futbol-2.jpg',
        'paisanos-legend.jpg', 'li-hackatwin.jpg',
      ],
      strip: true,
    },
    {
      id: 'casa',
      big: '30 BUILDERS',
      sub: 'no se quedan quietos',
      photos: ['xbh-desconectar-1.jpg', 'xbh-benja-1.jpg', 'xbh-desconectar-3.jpg'],
      strip: true,
    },
    {
      id: 'cierre',
      big: 'SI DUDABAN, HÁGANLO AHORA',
      sub: 'LA MANIJA SALVA CARRERAS Y VIDAS',
      photos: [],
      qr: 'assets/qr-links.png',
      qrLabel: 'links',
      double: true,          // entra con los dos kois (taijitu)
    },
  ];

  const INTENSITY = [0.30, 0.34, 0.38, 0.46, 0.55, 0.70, 0.85, 1.0];
  // océano sube con la manija — la slide 4 (el promedio) pica antes del quiebre

  let root = null;
  const els = [];

  function charsOf(el) {
    return [...el.querySelectorAll('.ch')];
  }

  /* chars en .word spans — las palabras no se cortan a mitad. */
  function appendWords(node, text) {
    for (const word of text.split(' ')) {
      const w = document.createElement('span');
      w.className = 'word';
      for (const c of word) {
        const sp = document.createElement('span');
        sp.className = 'ch';
        sp.dataset.ch = c;
        sp.textContent = c;
        w.appendChild(sp);
      }
      node.appendChild(w);
      node.appendChild(document.createTextNode(' '));
    }
  }

  function build(container) {
    root = container;
    root.className = 'slides-root';
    DECK.forEach((s, i) => {
      const sec = document.createElement('section');
      sec.className = 'slide' + (s.strip ? ' slide--strip' : '') +
        (s.sink ? ' slide--sink' : '') + (s.qr ? ' slide--qr' : '');
      sec.dataset.i = i;
      sec.dataset.id = s.id;
      if (s.exit) sec.dataset.exit = s.exit;

      const inner = document.createElement('div');
      inner.className = 'slide-inner';

      const h = document.createElement('h1');
      h.className = 'big';
      appendWords(h, s.big);
      inner.appendChild(h);

      if (s.sub) {
        const p = document.createElement('p');
        p.className = 'sub';
        appendWords(p, s.sub);
        inner.appendChild(p);
      }

      if (s.qr) {
        const fig = document.createElement('figure');
        fig.className = 'qr';
        const img = document.createElement('img');
        img.src = s.qr; img.alt = 'QR links';
        img.draggable = false;
        const cap = document.createElement('figcaption');
        cap.textContent = s.qrLabel || 'links';
        fig.appendChild(img); fig.appendChild(cap);
        inner.appendChild(fig);
      }

      if (s.photos.length) {
        const ph = document.createElement('div');
        ph.className = 'photos';
        s.photos.forEach(f => {
          const im = document.createElement('img');
          im.src = PH + f; im.alt = ''; im.draggable = false;
          ph.appendChild(im);
        });
        inner.appendChild(ph);
      }

      sec.appendChild(inner);
      root.appendChild(sec);
      els.push(sec);
    });
    return API;
  }

  /* Rects de chars en coords de viewport (lo que KOI necesita para
     "llevarse las letras"). */
  function rects(i) {
    const el = els[i];
    if (!el) return [];
    return charsOf(el).filter(s => !s.classList.contains('ch--space'))
      .map(s => {
        const r = s.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, el: s };
      });
  }

  /* Muestra slide i con chars ocultos (listos para emerger). */
  function show(i) {
    const el = els[i];
    if (!el) return;
    el.classList.add('is-active');
    charsOf(el).forEach(s => s.classList.add('ch--below'));
    el.querySelectorAll('.photos img, .qr').forEach(n => n.classList.add('ph--hide'));
  }

  /* Letras emergen del agua (stagger hacia arriba). originX opcional —
     centra el stagger alrededor del punto donde cayó el koi. */
  function reveal(i, originX) {
    const el = els[i];
    if (!el) return;
    const chs = charsOf(el);
    const cx = originX == null ? innerWidth / 2 : originX;
    chs.forEach(s => {
      const r = s.getBoundingClientRect();
      const d = Math.abs(r.x + r.width / 2 - cx);
      s.style.transitionDelay = `${Math.min(420, d * 0.45)}ms`;
      s.classList.remove('ch--below');
      s.classList.add('ch--in');
    });
    el.querySelectorAll('.photos img, .qr').forEach((n, j) => {
      n.style.transitionDelay = `${380 + j * 90}ms`;
      n.classList.remove('ph--hide');
    });
  }

  /* Slide 4: las letras se hunden bajo la línea del agua.
     Devuelve la duración ms para que el orquestador espere. */
  function sink(i, surfY) {
    const el = els[i];
    if (!el) return 0;
    const chs = charsOf(el);
    chs.forEach((s, j) => {
      const r = s.getBoundingClientRect();
      const dy = Math.max(0, surfY + 40 - (r.y + r.height));
      s.style.transition = `transform ${900 + j * 24}ms cubic-bezier(.55,.06,.68,.19), opacity ${700 + j * 24}ms ease-in`;
      s.style.transform = `translateY(${dy}px)`;
      s.style.opacity = '0';
    });
    el.querySelectorAll('.photos, .qr').forEach(n => { n.style.opacity = '0'; });
    return 900 + chs.length * 24 + 120;
  }

  function hide(i) {
    const el = els[i];
    if (!el) return;
    el.classList.remove('is-active');
    // limpiar estilos inline del sink para reuso
    charsOf(el).forEach(s => { s.style.cssText = ''; });
    el.querySelectorAll('.photos, .qr').forEach(n => { n.style.cssText = ''; });
  }

  function clearAll() {
    els.forEach((_, i) => hide(i));
  }

  const API = {
    build,
    count: DECK.length,
    el: i => els[i] || null,
    def: i => DECK[i] || null,
    rects,
    show,
    reveal,
    sink,
    hide,
    clearAll,
    intensity: i => INTENSITY[Math.min(i, INTENSITY.length - 1)],
    exit: i => (DECK[i] && DECK[i].exit) || 'carry',
    isDouble: i => !!(DECK[i] && DECK[i].double),
  };
  return API;
})();

// Escena 3D — dos koi nadando en persecución yin-yang, en armonía.
// three.js WebGPURenderer + materiales TSL que llaman funciones WGSL
// resueltas por vgpu (tslExports). Sprites pixelados con NearestFilter.
import * as THREE from 'three/webgpu';
import {
  texture, uv, time, vec2, vec3, mix, screenUV, uniform,
} from 'three/tsl';
import { tslExports } from 'vgpu/three';
import waterModule from './water.wgsl';

const canvas = document.getElementById('cv');

function fail(msg) {
  const p = document.createElement('p');
  p.style.cssText = 'color:#7fb7d9;font:14px monospace;padding:2em';
  p.textContent = msg;
  document.body.appendChild(p);
}

if (!navigator.gpu) {
  fail('Este navegador no soporta WebGPU (navigator.gpu ausente).');
  throw new Error('no webgpu');
}

const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
try {
  await renderer.init();
} catch (e) {
  fail('No pude iniciar WebGPU: ' + (e && e.message ? e.message : e));
  throw e;
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04101e, 0.02);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, .1, 220);
camera.position.set(0, .8, 39);
camera.lookAt(0, .5, 0);

// En portrait el ancho manda: aleja la cámara hasta que el disco entre.
function fitCamera() {
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  const halfW = 14; // peces de 13.5 en la rim: centro R9.5 + media cola fuera
  const dist = halfW / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
  camera.position.z = Math.max(39, dist);
  camera.updateProjectionMatrix();
}
fitCamera();

/* ---------- agua (WGSL -> TSL) ---------- */
const { waterField } = tslExports(waterModule)('waterField');

/* atlas ASCII: caracteres por densidad, blanco sobre transparente */
const GLYPHS = '  .·-~≈+#%@';
const ascTex = (() => {
  const cw = 14, ch = 18;
  const c = document.createElement('canvas');
  c.width = cw * GLYPHS.length; c.height = ch;
  const g = c.getContext('2d');
  g.font = `bold ${ch - 2}px ui-monospace, Menlo, monospace`;
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  [...GLYPHS].forEach((ch2, i) => g.fillText(ch2, cw * i + cw / 2, ch / 2));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
})();

/* fondo = agua renderizada en ASCII: el campo WGSL elige el carácter */
const N = GLYPHS.length;
const field = waterField({ uv: screenUV, timeSeconds: time });
const inCell = screenUV.mul(vec2(118, 74)).fract();
const idx = field.mul(N).floor().clamp(0, N - 1);
const gUV = vec2(idx.add(inCell.x).div(N), inCell.y);
const mask = texture(ascTex, gUV).a;
const deep = vec3(0.004, 0.016, 0.034);
const lite = vec3(0.42, 0.74, 0.92);
const asciiCol = deep.add(
  lite.mul(mask.mul(field.mul(1.7).add(0.13))));
const demoCol = mix(
  vec3(0.008, 0.030, 0.058), vec3(0.12, 0.34, 0.50), field);

/* modo: 1 = ASCII oscuro, 0 = agua lisa (demo day) — crossfade en animate() */
const q = new URLSearchParams(location.search);
const modeMix = uniform(q.get('mode') === 'demo' ? 0 : 1);
let modeTarget = modeMix.value;
scene.backgroundNode = mix(demoCol, asciiCol, modeMix);

/* ---------- texturas helper (canvas) ---------- */
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = canvasTex(128, (g, s) => {
  const r = g.createRadialGradient(s/2, s/2, 2, s/2, s/2, s/2);
  r.addColorStop(0, 'rgba(140,200,255,0.85)');
  r.addColorStop(0.45, 'rgba(80,150,220,0.25)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});
const ringTex = canvasTex(64, (g, s) => {
  g.strokeStyle = 'rgba(170,225,255,0.9)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(s/2, s/2, s/2 - 6, 0, 6.29); g.stroke();
});
const bubTex = canvasTex(16, (g, s) => {
  g.fillStyle = 'rgba(190,230,255,0.85)';
  g.beginPath(); g.arc(s/2, s/2, s/2 - 2, 0, 6.29); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(s/2 - 3, s/2 - 4, 3, 3);
});

/* ---------- disco taijitu: grupo inclinado; los peces viven EN el plano ---------- */
const R = 9.5, TILT = 1.35, OMEGA = 1.15; // ~5.5s por vuelta, ritmo de loader
const CENTER = new THREE.Vector3(0, .5, 0);
const disc = new THREE.Group();
disc.rotation.x = Math.PI / 2 - TILT;
disc.position.copy(CENTER);
scene.add(disc);

/* ---------- peces ---------- */
const FISH_W = 13.5, FISH_H = 13.5; // peces grandes: disco cerrado
const texLoader = new THREE.TextureLoader();
function makeKoi(url) {
  const tex = texLoader.load(url);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; // mips + alphaTest = el sprite desaparece al minificar
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.alphaTest = 0.35;
  mat.depthWrite = false; // sin depth-write no hay z-fight ni culling por cara
  mat.side = THREE.DoubleSide;
  mat.fog = false; // los peces van nítidos, no sumergidos en la niebla
  const frameU = uniform(0);
  // sheet 4×2: los 3 frames de nado son la fila de arriba (cols 0-2)
  mat.colorNode = texture(tex, uv().mul(vec2(1 / 4, .5)).add(vec2(frameU, .5)));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.scale.set(FISH_W, FISH_H, 1); // nunca se espeja: gira dentro del plano
  disc.add(mesh);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    }));
  glow.scale.setScalar(1.8);
  glow.position.z = -.06;
  mesh.add(glow);
  return { mesh, glow, frameU, phase: 0, wakeT: 0, bubT: 0 };
}
const fish = [
  { ...makeKoi('/assets/pixel-art/koi-black/sheet.png'), glowA: .5 },
  { ...makeKoi('/assets/pixel-art/koi-white/sheet.png'), glowA: .32 },
];
fish[1].phase = Math.PI;
for (const f of fish) f.glow.material.opacity = f.glowA;

/* ---------- swim pingpong: frames 0-1-2-1 con timings del sheet ---------- */
const SWIM_DUR = [.14, .18, .14, .18]; // índices [0,1,2,1]
const SWIM_SEQ = [0, 1, 2, 1];
function swimFrame(t) {
  const cyc = SWIM_DUR.reduce((a, b) => a + b, 0);
  let tt = t % cyc;
  for (let i = 0; i < SWIM_SEQ.length; i++) {
    if (tt < SWIM_DUR[i]) return SWIM_SEQ[i];
    tt -= SWIM_DUR[i];
  }
  return 0;
}

/* ---------- burbujas y estelas ---------- */
const NB = 160;
const bubPos = new Float32Array(NB * 3);
const bubbles = [];
for (let i = 0; i < NB; i++) bubbles.push({ alive: false, v: 0, w: 0, wf: 0 });
function spawnBubble(x, y, z, v) {
  const b = bubbles.find(b => !b.alive);
  if (!b) return;
  b.alive = true; b.x = x; b.y = y; b.z = z;
  b.v = v || (2.2 + Math.random() * 2);
  b.w = Math.random() * 6.28; b.wf = 1.5 + Math.random() * 2;
}
const bubGeo = new THREE.BufferGeometry();
bubGeo.setAttribute('position', new THREE.BufferAttribute(bubPos, 3));
const bubblesPts = new THREE.Points(bubGeo, new THREE.PointsMaterial({
  map: bubTex, size: .55, transparent: true, opacity: .75,
  depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
}));
scene.add(bubblesPts);

const rings = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: ringTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0,
    }));
  m.visible = false;
  scene.add(m);
  rings.push({ m, age: 0, live: false });
}
function spawnRing(x, y, z) {
  const r = rings.find(r => !r.live);
  if (!r) return;
  r.live = true; r.age = 0; r.m.visible = true;
  r.m.position.set(x, y, z);
}

// anillo fantasma: el borde del disco taijitu, guiando la persecución
const guideRing = new THREE.Mesh(
  new THREE.RingGeometry(R - .14, R + .14, 96),
  new THREE.MeshBasicMaterial({
    color: 0x6fb8e8, transparent: true, opacity: .07,
    depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  }));
disc.add(guideRing);

// pupilas del taijitu: dos puntos opuestos orbitando con los peces
const pupils = [0x0a0a0c, 0xeef6ff].map(col => {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(.7, 20),
    new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: .55, depthWrite: false,
    }));
  m.position.z = .05;
  disc.add(m);
  return m;
});

/* ---------- loop ---------- */
const _v = new THREE.Vector3();
const clock = new THREE.Clock();

/* switch ascii/demo: botón + tecla M, con crossfade */
const sw = document.createElement('button');
sw.style.cssText = 'position:fixed;right:14px;bottom:12px;z-index:5;'
  + 'background:none;border:1px solid #2b4a5f;color:#6ba8c8;'
  + 'font:11px ui-monospace,Menlo,monospace;padding:3px 10px;'
  + 'cursor:pointer;opacity:.55;border-radius:3px;';
sw.onclick = () => { modeTarget = modeTarget ? 0 : 1; };
addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') sw.onclick();
});
document.body.appendChild(sw);

function frame() {
  const dt = Math.min(.05, clock.getDelta());
  const t = clock.elapsedTime;

  modeMix.value += (modeTarget - modeMix.value) * Math.min(1, dt * 5);
  sw.textContent = modeMix.value > 0.5 ? '[ascii]' : '[demo]';

  camera.position.x = Math.sin(t * .06) * 3.2;
  camera.lookAt(CENTER);

  const fr = swimFrame(t);
  for (const f of fish) {
    const th = t * OMEGA + f.phase;
    // el pez está "impreso" en el disco: gira en el plano, panza siempre
    // hacia el centro, nariz tangente — nunca se da vuelta
    f.mesh.position.set(
      Math.cos(th) * R,
      Math.sin(th) * R,
      .1 + Math.sin(t * 1.7) * .3,           // bob compartido fuera del plano
    );
    f.mesh.rotation.z = th - Math.PI / 2;
    f.frameU.value = fr / 4;

    // estela y burbujas en la cola (local del disco → mundo)
    f.wakeT -= dt; f.bubT -= dt;
    _v.set(
      Math.cos(th) * R + Math.sin(th) * 6.6,
      Math.sin(th) * R - Math.cos(th) * 6.6,
      f.mesh.position.z);
    disc.localToWorld(_v);
    if (f.wakeT <= 0) { spawnRing(_v.x, _v.y, _v.z); f.wakeT = .6 + Math.random() * .3; }
    if (f.bubT <= 0) { spawnBubble(_v.x, _v.y, _v.z); f.bubT = .16; }
  }

  // pupilas del taijitu: la clara en la mitad del pez negro y viceversa
  for (let i = 0; i < 2; i++) {
    const th = t * OMEGA + fish[1 - i].phase;
    pupils[i].position.set(
      Math.cos(th) * R * .45, Math.sin(th) * R * .45, .05);
  }

  // burbujas ambientales
  if (Math.random() < dt * 6)
    spawnBubble((Math.random() - .5) * 60, -10, (Math.random() - .5) * 30, 1.6);
  for (let i = 0; i < NB; i++) {
    const b = bubbles[i];
    if (!b.alive) { bubPos[i * 3 + 1] = -999; continue; }
    b.y += b.v * dt; b.w += b.wf * dt;
    b.x += Math.sin(b.w) * .015;
    if (b.y > 14) b.alive = false;
    bubPos[i * 3] = b.x; bubPos[i * 3 + 1] = b.y; bubPos[i * 3 + 2] = b.z;
  }
  bubGeo.attributes.position.needsUpdate = true;

  for (const r of rings) {
    if (!r.live) continue;
    r.age += dt;
    const k = r.age / 1.1;
    if (k >= 1) { r.live = false; r.m.visible = false; continue; }
    r.m.scale.setScalar(1 + k * 5);
    r.m.material.opacity = .16 * (1 - k);
    r.m.quaternion.copy(camera.quaternion);
  }

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

addEventListener('resize', () => {
  fitCamera();
  renderer.setSize(innerWidth, innerHeight);
});

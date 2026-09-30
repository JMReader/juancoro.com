/**
 * Devin mark — 3D extruded prism scene built on vgpu (WebGPU).
 *
 * The silhouette is the official Devin mark (references/devin-mark.svg):
 * a 425x425 path flattened to a polygon, triangulated with earcut for the
 * caps, with side walls and a baked chamfer along every outline edge.
 *
 * Rendering is the standard vgpu two-pass recipe: the prism is drawn into an
 * offscreen depth target, then a present effect composites it to the output
 * (canvas surface or offscreen target) with a soft contact shadow.
 *
 * This module is pure vgpu — no React. DevinMark.tsx and
 * scripts/render-devin.ts both drive it.
 */

import earcut from "earcut";
import { draw, effect, geometry, sampler, target } from "vgpu";
import { perspectiveCamera } from "vgpu/scene";
import type { Frame, Gpu, Target } from "vgpu";

/** Official Devin mark path data (devin.ai/favicon.svg, 425x425 viewBox). */
export const DEVIN_MARK_PATH =
  "M70 159.333V91.3471C70 88.3592 71.594 85.5983 74.1816 84.1044L133.043 50.1205" +
  "C135.631 48.6265 138.819 48.6265 141.407 50.1205L200.269 84.1044" +
  "C202.856 85.5983 204.45 88.3592 204.45 91.3471V126.068" +
  "C204.708 137.606 210.806 148.734 221.531 154.926" +
  "C232.256 161.117 244.942 160.834 255.063 155.289L285.132 137.929" +
  "C287.719 136.435 290.907 136.435 293.495 137.929L352.357 171.913" +
  "C354.944 173.406 356.538 176.167 356.538 179.155V247.123" +
  "C356.538 250.111 354.944 252.872 352.357 254.366L293.495 288.35" +
  "C290.907 289.844 287.719 289.844 285.132 288.35L255.306 271.13" +
  "C245.146 265.456 232.344 265.117 221.534 271.358" +
  "C210.809 277.55 204.711 288.678 204.453 300.215V334.926" +
  "C204.453 337.914 202.859 340.675 200.271 342.169L141.41 376.153" +
  "C138.822 377.647 135.634 377.647 133.046 376.153L74.1845 342.169" +
  "C71.5969 340.675 70.0028 337.914 70.0028 334.926V266.959" +
  "C70.0029 263.971 71.5969 261.21 74.1845 259.716L133.046 225.732" +
  "C135.634 224.238 138.822 224.238 141.41 225.732L171.547 243.132" +
  "C181.656 248.638 194.306 248.906 205.005 242.729" +
  "C215.815 236.488 221.922 225.231 222.088 213.595" +
  "C221.83 202.057 215.732 189.737 205.008 183.545" +
  "C194.283 177.353 181.597 177.636 171.476 183.181L141.269 200.72" +
  "C138.67 202.229 135.461 202.228 132.864 200.716L74.1576 166.562" +
  "C71.5835 165.065 70 162.311 70 159.333Z";

/** Radians per second for the turntable — one turn in ~22s. */
export const TURNTABLE_SPEED = (Math.PI * 2) / 22;
/** Pleasant default three-quarter angle (used for static/reduced-motion frames). */
export const START_ANGLE = -0.55;

type Vec2 = [number, number];
type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// SVG path flattening
// ---------------------------------------------------------------------------

function cubicPoint(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
}

/** Tokenize + walk the path, emitting a flat [x, y, ...] polyline (SVG coords). */
export function flattenSvgPath(d: string, cubicSamples = 18): number[] {
  const tokens =
    d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: number[] = [];
  const push = (px: number, py: number) => {
    const n = out.length;
    // Skip consecutive duplicates — a closed path ends where it starts and a
    // degenerate first/last chord would break the RDP simplifier downstream.
    if (n >= 2 && Math.abs(px - out[n - 2]) < 1e-9 && Math.abs(py - out[n - 1]) < 1e-9) {
      return;
    }
    out.push(px, py);
  };
  let i = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let prevC2: Vec2 | null = null;
  let cmd = "";
  const num = () => Number(tokens[i++]);

  while (i < tokens.length) {
    const tk = tokens[i];
    if (/^[A-Za-z]$/.test(tk)) {
      cmd = tk;
      i++;
      if (cmd === "Z" || cmd === "z") {
        x = startX;
        y = startY;
      }
      if (cmd !== "S" && cmd !== "s" && cmd !== "C" && cmd !== "c") prevC2 = null;
      continue;
    }
    const rel = cmd >= "a" && cmd <= "z";
    switch (cmd.toUpperCase()) {
      case "M": {
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        startX = x;
        startY = y;
        push(x, y);
        cmd = rel ? "l" : "L"; // implicit repeats become lineto
        break;
      }
      case "L": {
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        push(x, y);
        break;
      }
      case "H": {
        const nx = num();
        x = rel ? x + nx : nx;
        push(x, y);
        break;
      }
      case "V": {
        const ny = num();
        y = rel ? y + ny : ny;
        push(x, y);
        break;
      }
      case "C": {
        const a = num();
        const b = num();
        const c = num();
        const d2 = num();
        const e = num();
        const f = num();
        const c1: Vec2 = rel ? [x + a, y + b] : [a, b];
        const c2: Vec2 = rel ? [x + c, y + d2] : [c, d2];
        const p1: Vec2 = rel ? [x + e, y + f] : [e, f];
        for (let s = 1; s <= cubicSamples; s++) {
          const p = cubicPoint([x, y], c1, c2, p1, s / cubicSamples);
          push(p[0], p[1]);
        }
        prevC2 = c2;
        x = p1[0];
        y = p1[1];
        break;
      }
      case "S": {
        const a = num();
        const b = num();
        const c = num();
        const d2 = num();
        const c1: Vec2 = prevC2 ? [2 * x - prevC2[0], 2 * y - prevC2[1]] : [x, y];
        const c2: Vec2 = rel ? [x + a, y + b] : [a, b];
        const p1: Vec2 = rel ? [x + c, y + d2] : [c, d2];
        for (let s = 1; s <= cubicSamples; s++) {
          const p = cubicPoint([x, y], c1, c2, p1, s / cubicSamples);
          push(p[0], p[1]);
        }
        prevC2 = c2;
        x = p1[0];
        y = p1[1];
        break;
      }
      default:
        throw new Error(`Unsupported SVG path command: ${cmd}`);
    }
  }
  // A closed path repeats its first point as the last — drop it.
  const m = out.length;
  if (
    m >= 4 &&
    Math.abs(out[m - 2] - out[0]) < 1e-6 &&
    Math.abs(out[m - 1] - out[1]) < 1e-6
  ) {
    out.length = m - 2;
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification of a closed flat polyline. */
export function simplifyPolygon(points: number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n < 4) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = points[2 * a];
    const ay = points[2 * a + 1];
    const dx = points[2 * b] - ax;
    const dy = points[2 * b + 1] - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let maxDist = 0;
    let maxIdx = -1;
    for (let k = a + 1; k < b; k++) {
      const px = points[2 * k];
      const py = points[2 * k + 1];
      const dist = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = k;
      }
    }
    if (maxIdx > 0 && maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([a, maxIdx], [maxIdx, b]);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    if (keep[k]) out.push(points[2 * k], points[2 * k + 1]);
  }
  return out;
}

/** Center on bbox, scale max dimension to 2 units, flip Y, force CCW. */
export function normalizeOutline(points: number[]): number[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < points.length; k += 2) {
    minX = Math.min(minX, points[k]);
    maxX = Math.max(maxX, points[k]);
    minY = Math.min(minY, points[k + 1]);
    maxY = Math.max(maxY, points[k + 1]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const s = 2 / Math.max(maxX - minX, maxY - minY);
  const out: number[] = new Array(points.length);
  for (let k = 0; k < points.length; k += 2) {
    out[k] = (points[k] - cx) * s;
    out[k + 1] = -(points[k + 1] - cy) * s; // SVG y-down -> world y-up
  }
  // Signed area > 0 means CCW in y-up space.
  let area = 0;
  const n = out.length / 2;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    area += out[2 * k] * out[2 * j + 1] - out[2 * j] * out[2 * k + 1];
  }
  if (area < 0) {
    const rev: number[] = [];
    for (let k = n - 1; k >= 0; k--) rev.push(out[2 * k], out[2 * k + 1]);
    return rev;
  }
  return out;
}

/** Flattened + normalized silhouette (CCW, ~2 units tall, centered). */
export function buildMarkOutline(): number[] {
  const flat = flattenSvgPath(DEVIN_MARK_PATH);
  const simplified = simplifyPolygon(flat, 0.55);
  return normalizeOutline(simplified);
}

// ---------------------------------------------------------------------------
// Polygon offsetting (for the bevel caps)
// ---------------------------------------------------------------------------

/** Miter-join inset by `w` units (moves outline toward the interior). */
function insetOutline(outline: number[], w: number): number[] {
  const n = outline.length / 2;
  const out: number[] = new Array(n * 2);
  for (let k = 0; k < n; k++) {
    const prev = (k - 1 + n) % n;
    const next = (k + 1) % n;
    const px = outline[2 * k];
    const py = outline[2 * k + 1];
    let e1x = px - outline[2 * prev];
    let e1y = py - outline[2 * prev + 1];
    let e2x = outline[2 * next] - px;
    let e2y = outline[2 * next + 1] - py;
    const l1 = Math.hypot(e1x, e1y) || 1e-12;
    const l2 = Math.hypot(e2x, e2y) || 1e-12;
    e1x /= l1;
    e1y /= l1;
    e2x /= l2;
    e2y /= l2;
    // CCW polygon: outward edge normal is (dy, -dx).
    const n1x = e1y;
    const n1y = -e1x;
    const n2x = e2y;
    const n2y = -e2x;
    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      mx = n2x;
      my = n2y;
    } else {
      mx /= ml;
      my /= ml;
    }
    // Miter length keeps perpendicular offset equal to w; clamped for safety.
    const cosHalf = Math.max(mx * n2x + my * n2y, 0.25);
    const miter = Math.min(w / cosHalf, w * 3);
    out[2 * k] = px - mx * miter;
    out[2 * k + 1] = py - my * miter;
  }
  return out;
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1x = bx - ax;
  const d1y = by - ay;
  const d2x = dx - cx;
  const d2y = dy - cy;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / denom;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / denom;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

function selfIntersects(poly: number[]): boolean {
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 1; j < n; j++) {
      const j2 = (j + 1) % n;
      if (j === i || j === i2 || i === j2) continue; // adjacent edges share a vertex
      if (
        segmentsIntersect(
          poly[2 * i],
          poly[2 * i + 1],
          poly[2 * i2],
          poly[2 * i2 + 1],
          poly[2 * j],
          poly[2 * j + 1],
          poly[2 * j2],
          poly[2 * j2 + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Inset that is guaranteed simple: shrinks the bevel on conflict, then scales. */
function safeInset(outline: number[], w: number): number[] {
  let width = w;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = insetOutline(outline, width);
    if (!selfIntersects(r)) return r;
    width *= 0.55;
  }
  // Fallback: uniform scale toward centroid — can never self-intersect.
  let cx = 0;
  let cy = 0;
  const n = outline.length / 2;
  for (let k = 0; k < n; k++) {
    cx += outline[2 * k];
    cy += outline[2 * k + 1];
  }
  cx /= n;
  cy /= n;
  const s = 1 - Math.min(0.06, w); // ~4% scale-down
  const out: number[] = new Array(n * 2);
  for (let k = 0; k < n; k++) {
    out[2 * k] = cx + (outline[2 * k] - cx) * s;
    out[2 * k + 1] = cy + (outline[2 * k + 1] - cy) * s;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mesh assembly: caps (earcut), walls, chamfer rings — flat-shaded
// ---------------------------------------------------------------------------

export interface MarkMeshData {
  /** Interleaved position(3) + normal(3), stride 24 bytes. */
  readonly vertices: Float32Array<ArrayBuffer>;
  readonly indices: Uint32Array<ArrayBuffer>;
  readonly triangleCount: number;
  readonly outlinePoints: number;
}

export function buildMarkMesh(
  outline: number[],
  depth = 0.38,
  bevel = 0.035,
): MarkMeshData {
  const n = outline.length / 2;
  const zCap = depth / 2;
  const zWall = depth / 2 - bevel;
  const inset = safeInset(outline, bevel);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  /** Push one flat-shaded triangle, fixing winding against `expected` normal. */
  const tri = (a: Vec3, b: Vec3, c: Vec3, ex: number, ey: number, ez: number) => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let bb = b;
    let cc = c;
    if (nx * ex + ny * ey + nz * ez < 0) {
      bb = c;
      cc = b;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const base = positions.length / 3;
    positions.push(a[0], a[1], a[2], bb[0], bb[1], bb[2], cc[0], cc[1], cc[2]);
    for (let k = 0; k < 3; k++) normals.push(nx, ny, nz);
    indices.push(base, base + 1, base + 2);
  };

  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, e: Vec3) => {
    tri(a, b, c, e[0], e[1], e[2]);
    tri(a, c, d, e[0], e[1], e[2]);
  };

  // Caps — earcut triangulation of the (inset) outline.
  const capTris = earcut(inset);
  for (let t = 0; t < capTris.length; t += 3) {
    const i0 = capTris[t];
    const i1 = capTris[t + 1];
    const i2 = capTris[t + 2];
    tri(
      [inset[2 * i0], inset[2 * i0 + 1], zCap],
      [inset[2 * i1], inset[2 * i1 + 1], zCap],
      [inset[2 * i2], inset[2 * i2 + 1], zCap],
      0,
      0,
      1,
    );
    tri(
      [inset[2 * i0], inset[2 * i0 + 1], -zCap],
      [inset[2 * i1], inset[2 * i1 + 1], -zCap],
      [inset[2 * i2], inset[2 * i2 + 1], -zCap],
      0,
      0,
      -1,
    );
  }

  // Walls + chamfer rings around the outline.
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const px = outline[2 * k];
    const py = outline[2 * k + 1];
    const qx = outline[2 * j];
    const qy = outline[2 * j + 1];
    const ix = inset[2 * k];
    const iy = inset[2 * k + 1];
    const jx = inset[2 * j];
    const jy = inset[2 * j + 1];

    const ex = qx - px;
    const ey = qy - py;
    const el = Math.hypot(ex, ey) || 1e-12;
    const ox = ey / el; // CCW outward normal
    const oy = -ex / el;

    // Side wall between the two full-outline rings.
    quad(
      [px, py, -zWall],
      [qx, qy, -zWall],
      [qx, qy, zWall],
      [px, py, zWall],
      [ox, oy, 0],
    );
    // Front chamfer: full outline at zWall -> inset outline at zCap.
    // Expected normal sits between the wall normal and +Z (hemisphere hint).
    const cl = Math.hypot(ox, oy, 1) || 1;
    quad(
      [px, py, zWall],
      [qx, qy, zWall],
      [jx, jy, zCap],
      [ix, iy, zCap],
      [ox / cl, oy / cl, 1 / cl],
    );
    // Back chamfer (mirrored).
    quad(
      [ix, iy, -zCap],
      [jx, jy, -zCap],
      [qx, qy, -zWall],
      [px, py, -zWall],
      [ox, oy, -1],
    );
  }

  // Interleave position+normal into one buffer (stride 24 bytes).
  const vertCount = positions.length / 3;
  const vertices = new Float32Array(vertCount * 6) as Float32Array<ArrayBuffer>;
  for (let v = 0; v < vertCount; v++) {
    vertices[v * 6] = positions[v * 3];
    vertices[v * 6 + 1] = positions[v * 3 + 1];
    vertices[v * 6 + 2] = positions[v * 3 + 2];
    vertices[v * 6 + 3] = normals[v * 3];
    vertices[v * 6 + 4] = normals[v * 3 + 1];
    vertices[v * 6 + 5] = normals[v * 3 + 2];
  }

  return {
    vertices,
    indices: new Uint32Array(indices) as Uint32Array<ArrayBuffer>,
    triangleCount: indices.length / 3,
    outlinePoints: n,
  };
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const MARK_SHADER = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4f,
  position: vec3f,
}
struct Model {
  model: mat4x4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> model: Model;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) worldPos: vec3f,
}

@vertex fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
) -> VertexOut {
  var out: VertexOut;
  let world = model.model * vec4f(position, 1.0);
  out.position = camera.viewProjection * world;
  out.normal = (model.model * vec4f(normal, 0.0)).xyz;
  out.worldPos = world.xyz;
  return out;
}

@fragment fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let base = vec3f(0.094, 0.094, 0.094); // matte ink #181818
  let n = normalize(in.normal);
  let v = normalize(camera.position - in.worldPos);

  // Key light: soft directional from upper-left-front.
  let key = normalize(vec3f(-0.45, 0.72, 0.60));
  let diff = max(dot(n, key), 0.0);
  // Gentle fill so unlit faces stay readable.
  let fill = max(dot(n, normalize(vec3f(0.65, -0.10, -0.45))), 0.0) * 0.18;
  // Hemisphere-ish ambient: slightly brighter from above.
  let ambient = 0.36 + 0.10 * max(n.y, 0.0);
  // Faint rim so the silhouette reads against the paper.
  let rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.18;

  let color = base * (ambient + diff * 0.92 + fill) + vec3f(rim);
  return vec4f(color, 1.0);
}
`;

const PRESENT_SHADER = /* wgsl */ `
struct Params {
  texel: vec2f,
  shadowShift: vec2f,
  shadowRadiusPx: f32,
  shadowStrength: f32,
}
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let obj = textureSampleLevel(scene, sceneSampler, uv, 0.0);

  // Soft contact shadow: Vogel-disc taps on the scene alpha, offset down-right
  // (opposite the upper-left key light).
  var shadow = 0.0;
  let base = uv - params.shadowShift;
  for (var i = 0; i < 16; i++) {
    let fi = f32(i) + 0.5;
    let r = sqrt(fi / 16.0) * params.shadowRadiusPx;
    let a = fi * 2.39996323; // golden angle
    shadow += textureSampleLevel(
      scene,
      sceneSampler,
      base + vec2f(cos(a), sin(a)) * r * params.texel,
      0.0,
    ).a;
  }
  shadow = shadow / 16.0 * params.shadowStrength;

  // Premultiplied "over" composite: object over translucent shadow.
  let shadowRgb = vec3f(0.11, 0.105, 0.095) * shadow;
  let rgb = obj.rgb + (1.0 - obj.a) * shadowRgb;
  let alpha = obj.a + (1.0 - obj.a) * shadow;
  return vec4f(rgb, alpha);
}
`;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface DevinMarkScene {
  /**
   * Encode both passes into the given frame. `yaw` is the total spin around
   * the vertical axis (turntable angle plus any interaction offset); `pitch`
   * tilts the prism around the horizontal camera axis — applied after yaw so
   * it always reads as an on-screen tilt toward/away from the viewer.
   * Defaults to 0, so headless callers can keep passing only the angle.
   */
  encode(currentFrame: Frame, output: Target, yaw: number, pitch?: number): void;
  /** Sync the offscreen scene target + camera to the output size (pixels). */
  resize(width: number, height: number): void;
}

function rotationY(angle: number): Float32Array {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Column-major rotation about Y.
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotationX(angle: number): Float32Array {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Column-major rotation about X (same convention as rotationY).
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

/** Column-major mat4 product `a * b` — applies b first, then a. */
function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

const CAMERA_POSITION: Vec3 = [0, 0.58, 4.85];

export function createDevinMarkScene(gpu: Gpu): DevinMarkScene {
  const outline = buildMarkOutline();
  const mesh = buildMarkMesh(outline);

  const markGeometry = geometry(gpu, {
    label: "devin-mark-prism",
    buffers: [
      {
        data: mesh.vertices,
        stride: 24,
        attributes: {
          position: { format: "float32x3", offset: 0 },
          normal: { format: "float32x3", offset: 12 },
        },
      },
    ],
    indices: mesh.indices,
  });

  const camera = perspectiveCamera({
    fov: 33,
    aspect: 1,
    position: CAMERA_POSITION,
    target: [0, 0, 0],
  });

  const mark = draw(gpu, {
    label: "devin-mark",
    shader: MARK_SHADER,
    geometry: markGeometry,
    cull: "back",
  });
  mark.set({
    camera: { viewProjection: camera.viewProjection, position: CAMERA_POSITION },
    model: { model: rotationY(START_ANGLE) },
  });

  // Offscreen scene target — the only place a depth attachment exists.
  const scene = target(gpu, {
    label: "devin-scene",
    size: [2, 2],
    depth: true,
    msaa: true,
  });
  scene.clearColor = [0, 0, 0, 0];

  const present = effect(gpu, PRESENT_SHADER, {
    label: "devin-present",
    set: {
      scene,
      sceneSampler: sampler(gpu, { minFilter: "linear", magFilter: "linear" }),
      params: {
        texel: [1 / 2, 1 / 2],
        shadowShift: [0.024, 0.038],
        shadowRadiusPx: 18,
        shadowStrength: 0.30,
      },
    },
  });

  return {
    resize(width, height) {
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      scene.resize([w, h]);
      camera.set({ aspect: w / h });
      // Re-bind the viewProjection — set() writes values at call time, so the
      // updated matrix needs to be pushed back to the draw.
      mark.set({
        camera: {
          viewProjection: camera.viewProjection,
          position: CAMERA_POSITION,
        },
      });
      present.set({
        params: {
          texel: scene.texelSize,
          shadowShift: [0.024, 0.038],
          shadowRadiusPx: Math.max(10, Math.min(w, h) * 0.022),
          shadowStrength: 0.30,
        },
      });
    },
    encode(currentFrame, output, yaw, pitch = 0) {
      // Pitch about the camera's horizontal axis is applied after the yaw
      // spin so it always tips the top of the mark toward/away from the
      // viewer regardless of the current turntable angle. The pitch === 0
      // fast path keeps the plain rotationY allocation identical to before.
      const model =
        pitch === 0
          ? rotationY(yaw)
          : multiplyMat4(rotationX(pitch), rotationY(yaw));
      mark.set({ model: { model } });
      currentFrame.pass(
        { target: scene, clear: [0, 0, 0, 0], clearDepth: 1 },
        (pass) => {
          pass.draw(mark);
        },
      );
      currentFrame.pass(output, present);
    },
  };
}

/**
 * 3D extruded OpenCode "O" mark — pure vgpu scene code, no React.
 *
 * Shared by the client component (`OpenCodeMark.tsx`, browser `init` from
 * "vgpu") and the headless preview script (`scripts/render-opencode.ts`,
 * `init` from "vgpu/node"). Both entrypoints re-export the same factory
 * functions, so factories imported from "vgpu" work with either gpu.
 *
 * Geometry: the reference mark (references/opencode-5.svg, 512 viewBox) is a
 * square ring (x 128–384, y 96–416, stroke 64) with a rectangular hole and a
 * gray block (x 192–320, y 224–352) inside it. The ring is built as one
 * seamless solid — a rect-frame profile extruded in Z with 45° chamfers on
 * every silhouette edge — and the bar as a plain box, recessed in the hole.
 * Sizes below are in units of 1 = 256 svg px.
 */

import { draw, effect, geometry, sampler, target } from "vgpu";
import type { Draw, Frame, Gpu, Target } from "vgpu";
import { box, group, perspectiveCamera, scene } from "vgpu/scene";
import type { PerspectiveCamera, SceneNode } from "vgpu/scene";

/** Scene constants derived from references/opencode-5.svg. */
export const OPENCODE_MARK = {
  /** Ring outer size: 256×320 svg px, normalized by 256. */
  width: 1.0,
  height: 1.25,
  /** Ring stroke: 64 px. Hole is 128×192 px → 0.5×0.75, centered. */
  stroke: 0.25,
  /** Extrusion depth ~20% of width. */
  depth: 0.2,
  /** 45° chamfer width along every silhouette edge (subtle milled edge). */
  bevel: 0.022,
  /** Inner bar slightly shallower → its front sits recessed inside the ring. */
  barDepth: 0.15,
  /**
   * Inner bar: 128×128 px, oversized by ~2% so its ends sink into the hole
   * walls — a clean T-junction (the SVG block touches the frame) instead of
   * coplanar z-fighting faces. Top stays well below the hole's top edge.
   */
  barWidth: 0.504,
  barHeight: 0.51,
  barCenterY: -0.125,
  /** Two-tone grayscale on paper #f8f8f5: ink ring + mid-gray bar (sRGB). */
  ink: [0.094, 0.094, 0.094] as const, // #181818
  gray: [0.353, 0.345, 0.345] as const, // #5A5858
  /** Turntable: one revolution per ~22 s. */
  turnSeconds: 22,
  /** Starting yaw (rad): slight 3/4 view so the first/static frame shows depth. */
  startAngle: -0.32,
  /** Lean toward the camera a touch so the top face reads (rad). */
  tilt: 0.14,
  /** Fraction of frame height the mark occupies (~62%). */
  fit: 0.62,
} as const;

/** Turntable angular speed in rad/s. `angle = startAngle + time * OMEGA`. */
export const OPENCODE_OMEGA = (Math.PI * 2) / OPENCODE_MARK.turnSeconds;

/* ------------------------------------------------------------------ */
/* Ring geometry: rect-frame profile extruded in Z, chamfered edges    */
/* ------------------------------------------------------------------ */

export interface MeshData {
  /** Interleaved [x,y,z, nx,ny,nz] per vertex. */
  readonly vertices: Float32Array<ArrayBuffer>;
  readonly indices: Uint32Array<ArrayBuffer>;
}

type V2 = readonly [number, number];
type V3 = [number, number, number];

/**
 * Builds the ring as a single manifold-looking mesh:
 *   - front/back faces: the frame profile eroded by `bevel` (4 arm quads each)
 *   - walls: outer + hole perimeters, spanning z ∈ [-(hz-b), hz-b]
 *   - chamfer strips: 45° facets between each wall rail and the face edge,
 *     on both z sides of every perimeter edge
 *   - corner wedges: small quads closing each profile vertex between strips
 *
 * Every facet is emitted through a helper that computes the geometric normal
 * and flips winding when it disagrees with the desired outward normal, so
 * `cull: "back"` is always safe.
 */
export function buildRingGeometry(
  halfW: number,
  halfH: number,
  holeHalfW: number,
  holeHalfH: number,
  halfDepth: number,
  bevel: number,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const b = bevel;
  const hz = halfDepth;

  function vert(p: V3, n: V3): number {
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    return positions.length / 3 - 1;
  }

  /** Emit triangle a-b-c; swap to a-c-b when it faces away from `desired`. */
  function tri(a: number, b2: number, c: number, desired: V3): void {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b2 * 3] - ax, by = positions[b2 * 3 + 1] - ay, bz = positions[b2 * 3 + 2] - az;
    const cx = positions[c * 3] - ax, cy = positions[c * 3 + 1] - ay, cz = positions[c * 3 + 2] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    if (nx * desired[0] + ny * desired[1] + nz * desired[2] < 0) {
      indices.push(a, c, b2);
    } else {
      indices.push(a, b2, c);
    }
  }

  function quad(a: number, b2: number, c: number, d: number, desired: V3): void {
    tri(a, b2, c, desired);
    tri(a, c, d, desired);
  }

  /**
   * One perimeter loop of the frame profile, CCW when viewed from +Z for the
   * outer loop and CW for the hole (so edge normals `(dy,-dx)` always point
   * away from the material).
   *
   * Vertices where the loop turns left (positive z-cross of the incoming and
   * outgoing edge directions) are convex peaks of the solid — strips shorten
   * by `b` and a wedge closes the gap. Right turns are concave valleys (the
   * hole corners): there the two strips simply run to the vertex and share
   * the miter edge vertex→faceCorner, so no wedge is emitted.
   */
  function perimeter(loop: readonly V2[]): void {
    const n = loop.length;
    const dirs: V2[] = loop.map((p, i) => {
      const q = loop[(i + 1) % n];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const len = Math.hypot(dx, dy);
      return [dx / len, dy / len];
    });
    const out: V2[] = dirs.map(([dx, dy]) => [dy, -dx]); // outward-from-material

    /** Convex iff the loop turns left at vertex i (edge i-1 → edge i). */
    const convexAt = (i: number): boolean => {
      const p = (i + n - 1) % n;
      return dirs[p][0] * dirs[i][1] - dirs[p][1] * dirs[i][0] > 0;
    };
    /** Miter point where the two offset face rails meeting at vertex i cross. */
    const faceCorner = (i: number): V2 => {
      const p = (i + n - 1) % n;
      const v = loop[i];
      return [v[0] - out[p][0] * b - out[i][0] * b, v[1] - out[p][1] * b - out[i][1] * b];
    };

    // Walls + chamfer strips per edge.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p0 = loop[i], p1 = loop[j];
      const d = dirs[i], o = out[i];
      const wn: V3 = [o[0], o[1], 0];

      // Wall quad: full edge length, z ∈ [-(hz-b), hz-b].
      quad(
        vert([p0[0], p0[1], -(hz - b)], wn),
        vert([p1[0], p1[1], -(hz - b)], wn),
        vert([p1[0], p1[1], hz - b], wn),
        vert([p0[0], p0[1], hz - b], wn),
        wn,
      );

      // Chamfer strips on both z sides. Wall rail ends shorten by `b` only at
      // convex vertices; face rail ends always land on the miter point.
      for (const s of [1, -1] as const) {
        const sn: V3 = [o[0] / Math.SQRT2, o[1] / Math.SQRT2, s / Math.SQRT2];
        const zWall = s * (hz - b);
        const zFace = s * hz;
        const w0: V3 = [p0[0] + (convexAt(i) ? d[0] * b : 0), p0[1] + (convexAt(i) ? d[1] * b : 0), zWall];
        const w1: V3 = [p1[0] - (convexAt(j) ? d[0] * b : 0), p1[1] - (convexAt(j) ? d[1] * b : 0), zWall];
        const f0: V3 = [faceCorner(i)[0], faceCorner(i)[1], zFace];
        const f1: V3 = [faceCorner(j)[0], faceCorner(j)[1], zFace];
        quad(vert(w0, sn), vert(w1, sn), vert(f1, sn), vert(f0, sn), sn);
      }
    }

    // Corner wedges at convex vertices only: close the gap between the two
    // strips' shortened ends, the wall corner, and the eroded-face corner.
    for (let i = 0; i < n; i++) {
      if (!convexAt(i)) continue;
      const prev = (i + n - 1) % n;
      const p = loop[i];
      const dp = dirs[prev], dn = dirs[i];
      const op = out[prev], on = out[i];
      for (const s of [1, -1] as const) {
        const zWall = s * (hz - b);
        const zFace = s * hz;
        const w: V3 = [p[0], p[1], zWall]; // wall corner
        const ePrev: V3 = [p[0] - dp[0] * b, p[1] - dp[1] * b, zWall]; // prev strip end
        const eNext: V3 = [p[0] + dn[0] * b, p[1] + dn[1] * b, zWall]; // next strip start
        const f: V3 = [faceCorner(i)[0], faceCorner(i)[1], zFace]; // face corner
        const cn: V3 = [op[0] + on[0], op[1] + on[1], s]; // soft diagonal normal
        quad(vert(w, cn), vert(ePrev, cn), vert(f, cn), vert(eNext, cn), cn);
      }
    }
  }

  // Outer loop CCW; hole loop CW (normals point into the hole either way).
  perimeter([
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ]);
  perimeter([
    [-holeHalfW, -holeHalfH],
    [-holeHalfW, holeHalfH],
    [holeHalfW, holeHalfH],
    [holeHalfW, -holeHalfH],
  ]);

  // Front/back faces: eroded frame, tiled as 4 arm quads (no earcut needed —
  // the profile is two nested centered rects).
  const fw = halfW - b, fh = halfH - b;
  const kw = holeHalfW + b, kh = holeHalfH + b;
  for (const s of [1, -1] as const) {
    const z = s * hz;
    const n: V3 = [0, 0, s];
    const arm = (x0: number, x1: number, y0: number, y1: number) =>
      quad(
        vert([x0, y0, z], n),
        vert([x1, y0, z], n),
        vert([x1, y1, z], n),
        vert([x0, y1, z], n),
        n,
      );
    arm(-fw, -kw, -fh, fh); // left
    arm(kw, fw, -fh, fh); // right
    arm(-kw, kw, kh, fh); // top
    arm(-kw, kw, -fh, -kh); // bottom
  }

  const vertexCount = positions.length / 3;
  const vertices = new Float32Array(vertexCount * 6);
  for (let i = 0; i < vertexCount; i++) {
    vertices.set(positions.slice(i * 3, i * 3 + 3), i * 6);
    vertices.set(normals.slice(i * 3, i * 3 + 3), i * 6 + 3);
  }
  return { vertices, indices: new Uint32Array(indices) };
}

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

/**
 * Matte two-light shading computed in sRGB space (a deliberate cheat:
 * linear-space lighting on a #181818 albedo crushes every face to black).
 * All part transforms are rigid (rotate + translate, uniform scale), so
 * normalize(model * n) is the exact world normal.
 */
const OBJECT_SHADER = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4f,
  eye: vec3f,
}
struct Model {
  model: mat4x4f,
  color: vec3f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> model: Model;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) world: vec3f,
}

@vertex fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
) -> VertexOut {
  var out: VertexOut;
  let world = model.model * vec4f(position, 1.0);
  out.position = camera.viewProjection * world;
  out.world = world.xyz;
  out.normal = (model.model * vec4f(normal, 0.0)).xyz;
  return out;
}

@fragment fn fs_main(
  @location(0) normal: vec3f,
  @location(1) world: vec3f,
) -> @location(0) vec4f {
  let n = normalize(normal);
  let v = normalize(camera.eye - world);

  // Soft key light from a distant point, upper-left-front. A point source
  // (not a direction) gives a subtle gradient across the flat front face.
  let lightPos = vec3f(-2.6, 3.4, 3.2);
  let l = lightPos - world;
  let dist = length(l);
  let keyDir = l / dist;
  let key = pow(clamp(dot(n, keyDir) * 0.5 + 0.5, 0.0, 1.0), 1.6);
  // Faint fill from lower-right so right/bottom faces never crush to zero.
  let fillDir = normalize(vec3f(0.7, -0.15, 0.45));
  let fill = max(dot(n, fillDir), 0.0) * 0.14;
  // Hemisphere ambient: tops lift, bottoms sink.
  let ambient = mix(0.24, 0.42, n.y * 0.5 + 0.5);

  var lit = model.color * (ambient + key * 0.95 + fill);

  // Whisper of a rim to separate the silhouette from the page.
  let rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0) * 0.08;
  lit += vec3f(rim);

  return vec4f(lit, 1.0);
}
`;

/** Present pass: sample the scene texture; premultiply for canvas alphaMode. */
const PRESENT_SHADER = /* wgsl */ `
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(scene, sceneSampler, uv, 0.0);
  return vec4f(c.rgb * c.a, c.a);
}
`;

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

interface Part {
  readonly node: SceneNode;
  readonly draw: Draw;
  readonly color: readonly [number, number, number];
}

export interface OpenCodeMarkSceneOptions {
  /** Physical pixel size of the output the scene is sized for. */
  readonly size: readonly [number, number];
  /** Vertical field of view in degrees. */
  readonly fov?: number;
  /** Fraction of frame height the mark occupies (default OPENCODE_MARK.fit). */
  readonly fit?: number;
}

/**
 * Per-frame interaction offsets layered on the rig by `encode()`. Every
 * field is optional and additive: omitting `pose` (or a field) yields the
 * plain turntable — headless and reduced-motion renders never pass one.
 */
export interface OpenCodeMarkPose {
  /**
   * Camera-space pitch (rad) added to the fixed `tilt` lean — vertical
   * drags plus the vertical half of hover parallax. Positive tips the
   * front face downward. Keep |v| ≲ 0.55 so the mark never flips over.
   */
  readonly tiltX?: number;
  /**
   * Camera-space yaw (rad) on the same outer node — the horizontal half
   * of hover parallax. Small values only (≲ 0.1): it is additive with the
   * turntable lean, not a second turntable.
   */
  readonly tiltY?: number;
  /**
   * Turntable yaw (rad) added to `angle` inside the rig — horizontal
   * drags and their fling, so `angle` stays a clean monotonous phase.
   */
  readonly spinY?: number;
  /**
   * Loose-insert lag on the inner bar (rad, bar-local X/Y): a small
   * counter-rotation while the ring is dragged so the insert trails the
   * ring like a loose fit. Keep |v| ≲ 0.07 — past that the bar's front
   * corners can poke through the ring's front chamfer.
   */
  readonly barX?: number;
  readonly barY?: number;
  /**
   * Loose-insert shift of the bar inside the hole (units of 1 = 256 svg
   * px). The bar is oversized 0.004 into the hole walls, so keep
   * |v| ≲ 0.015 to leave its ends buried.
   */
  readonly barDX?: number;
  readonly barDY?: number;
}

export interface OpenCodeMarkScene {
  /** Resize the internal MSAA/depth target and camera aspect. */
  setSize(width: number, height: number): void;
  /**
   * Encode the two passes (scene → present) into `frame` for this `angle`
   * (turntable yaw in radians). `pose` layers pointer interaction on the
   * rig; omit it for the plain turntable. Safe to call inside
   * `frame()`/`frameLoop()`.
   */
  encode(frame: Frame, out: Target, angle: number, pose?: OpenCodeMarkPose): void;
}

/**
 * Builds the mark: offscreen MSAA+depth target, beveled ring + recessed bar
 * draws, perspective camera, and a fullscreen present effect. Lifetime is
 * owned by the gpu — `gpu.dispose()` tears everything down.
 */
export function createOpenCodeMarkScene(
  gpu: Gpu,
  options: OpenCodeMarkSceneOptions,
): OpenCodeMarkScene {
  const M = OPENCODE_MARK;
  const fov = options.fov ?? 36;
  const fit = options.fit ?? M.fit;

  const [w, h] = options.size;
  const sceneTarget = target(gpu, {
    size: [Math.max(1, w), Math.max(1, h)],
    depth: true,
    msaa: true,
    label: "opencode.scene",
  });

  // Camera: distance chosen so the 1.25-tall mark fills `fit` of frame height.
  const halfH = M.height / 2 / fit;
  const dist = halfH / Math.tan((fov * Math.PI) / 360);
  const camera: PerspectiveCamera = perspectiveCamera({
    fov,
    aspect: w / h,
    near: 0.1,
    far: 20,
    position: [0, 0, dist],
    target: [0, 0, 0],
  });

  // Transform rig: root → tilt (fixed, camera-relative) → spin (turntable).
  const root = scene({ label: "opencode" });
  const tilt = group({ rotation: [M.tilt, 0, 0], label: "tilt" });
  const spin = group({ rotation: [0, M.startAngle, 0], label: "spin" });
  root.add(tilt);
  tilt.add(spin);

  // Ring: one seamless beveled solid at real size (no internal seams).
  const ringMesh = buildRingGeometry(
    M.width / 2,
    M.height / 2,
    (M.width - 2 * M.stroke) / 2,
    (M.height - 2 * M.stroke) / 2,
    M.depth / 2,
    M.bevel,
  );
  const ringGeometry = geometry(gpu, {
    buffers: [
      {
        attributes: { position: "float32x3", normal: "float32x3" },
        data: ringMesh.vertices,
        stride: 24,
      },
    ],
    indices: ringMesh.indices,
    label: "opencode.ring",
  });

  // Bar: sharp box, recessed so its front sits behind the ring's front plane.
  const barGeometry = geometry(gpu, box({ size: 1 }));

  const eye = camera.worldPosition;
  const draws: Part[] = [];

  const ringNode = group({ label: "ring" });
  spin.add(ringNode);
  const ringDraw = draw(gpu, {
    shader: OBJECT_SHADER,
    geometry: ringGeometry,
    cull: "back",
    label: "opencode.ring",
  });
  ringDraw.set({
    camera: { viewProjection: camera.viewProjection, eye },
    model: { model: ringNode.worldMatrix, color: M.ink },
  });
  draws.push({ node: ringNode, draw: ringDraw, color: M.ink });

  const barNode = group({
    position: [0, M.barCenterY, 0],
    scale: [M.barWidth, M.barHeight, M.barDepth],
    label: "bar",
  });
  spin.add(barNode);
  const barDraw = draw(gpu, {
    shader: OBJECT_SHADER,
    geometry: barGeometry,
    cull: "back",
    label: "opencode.bar",
  });
  barDraw.set({
    camera: { viewProjection: camera.viewProjection, eye },
    model: { model: barNode.worldMatrix, color: M.gray },
  });
  draws.push({ node: barNode, draw: barDraw, color: M.gray });

  const present = effect(gpu, PRESENT_SHADER, {
    label: "opencode.present",
    set: {
      scene: sceneTarget,
      sceneSampler: sampler(gpu, { minFilter: "linear", magFilter: "linear" }),
    },
  });

  return {
    setSize(width, height) {
      const sw = Math.max(1, Math.floor(width));
      const sh = Math.max(1, Math.floor(height));
      sceneTarget.resize([sw, sh]);
      camera.set({ aspect: sw / sh });
      // Re-bind: the target identity is stable but its texture was recreated.
      present.set({ scene: sceneTarget });
    },

    encode(frame, out, angle, pose) {
      tilt.set({ rotation: [M.tilt + (pose?.tiltX ?? 0), pose?.tiltY ?? 0, 0] });
      spin.set({ rotation: [0, angle + (pose?.spinY ?? 0), 0] });
      // Loose insert: a hair of counter-rotation/shift while the ring is
      // being dragged. All fields default to the neutral resting pose.
      barNode.set({
        position: [pose?.barDX ?? 0, M.barCenterY + (pose?.barDY ?? 0), 0],
        rotation: [pose?.barX ?? 0, pose?.barY ?? 0, 0],
      });
      for (const part of draws) {
        part.draw.set({ model: { model: part.node.worldMatrix, color: part.color } });
      }
      frame.pass({ target: sceneTarget, clear: [0, 0, 0, 0], clearDepth: 1 }, (pass) => {
        for (const part of draws) pass.draw(part.draw);
      });
      frame.pass(out, present);
    },
  };
}

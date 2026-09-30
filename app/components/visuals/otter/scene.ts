/**
 * "La nutria de Devin" — a stylized low-poly otter built on vgpu (WebGPU).
 *
 * Pure vgpu code: no React, no DOM. OtterScene.tsx (browser `init` from
 * "vgpu") and scripts/render-otter.ts (`init` from "vgpu/node") drive the
 * exact same code path: build the scene once, then encode it into a
 * `frame()`/`frameLoop()` pass targeting a canvas `Surface` or an offscreen
 * `Target`.
 *
 * Construction: a small hierarchy of scene-tree groups
 * (`root -> tilt -> spin -> breathe -> parts`) where every part is a
 * primitive (flat-shaded icospheres for the rounded masses, one cone for the
 * tail, thin open cylinders for the whiskers) positioned/scaled into place.
 * Flat shading on low-subdivision icospheres is what gives the faceted
 * "editorial mascot sculpture" look.
 *
 * Rendering is the standard two-pass recipe: parts draw into an offscreen
 * MSAA+depth target, then a present effect composites it over the output
 * with a soft Vogel-disc contact shadow (same approach as devin/scene.ts).
 */

import { draw, effect, geometry, sampler, target } from "vgpu";
import {
  cone,
  cylinder,
  group,
  icosphere,
  perspectiveCamera,
  scene,
} from "vgpu/scene";
import type { Draw, Frame, Gpu, Target } from "vgpu";
import type { PerspectiveCamera, SceneNode } from "vgpu/scene";

type Vec3 = [number, number, number];

/* ------------------------------------------------------------------ */
/* Tuning constants                                                    */
/* ------------------------------------------------------------------ */

/** Turntable: one revolution per ~26 s (a touch slower than the mark). */
export const OTTER_TURN_SECONDS = 26;
/** Rad/s for the turntable: `yaw = START_ANGLE + time * OTTER_OMEGA`. */
export const OTTER_OMEGA = (Math.PI * 2) / OTTER_TURN_SECONDS;
/** Pleasant default three-quarter view (used at t=0 / reduced motion). */
export const START_ANGLE = -0.42;

/**
 * Palette — sRGB-space values matching the editorial ramp. The shader
 * lights in this space deliberately (like opencode/scene.ts): linear-space
 * lighting on near-black albedos would crush every facet to ink.
 */
const FUR = [0.105, 0.104, 0.098] as const; // charcoal ink body ~#1b1a19
const MUZZLE = [0.545, 0.537, 0.508] as const; // taupe muzzle/belly ~#8b897f
const DARK = [0.042, 0.042, 0.04] as const; // nose, eyes
const WHISKER = [0.72, 0.71, 0.68] as const; // pale whiskers
const GLINT = [0.9, 0.9, 0.88] as const; // eye catchlights

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

/**
 * Matte two-light shading in sRGB space, plus a specular sheen term scaled
 * by `color.w` — wet nose and bead eyes get a glossier highlight than fur.
 * Parts carry non-uniform scale, so normals transform by `normalMat`
 * (inverse-transpose of the model's 3x3), not by the model matrix itself.
 */
const OTTER_SHADER = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4f,
  eye: vec3f,
}
struct Model {
  model: mat4x4f,
  normalMat: mat4x4f,
  color: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> model: Model;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) world: vec3f,
  @location(2) color: vec4f,
}

@vertex fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
) -> VertexOut {
  var out: VertexOut;
  let world = model.model * vec4f(position, 1.0);
  out.position = camera.viewProjection * world;
  out.world = world.xyz;
  out.normal = (model.normalMat * vec4f(normal, 0.0)).xyz;
  out.color = model.color;
  return out;
}

@fragment fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let v = normalize(camera.eye - in.world);

  // Soft key light, upper-left-front (same family as the devin mark).
  let keyDir = normalize(vec3f(-0.45, 0.72, 0.60));
  let diff = max(dot(n, keyDir), 0.0);
  // Gentle fill from lower-right so shadowed facets never crush to zero.
  let fill = max(dot(n, normalize(vec3f(0.65, -0.10, -0.45))), 0.0) * 0.16;
  // Hemisphere-ish ambient: slightly brighter from above.
  let ambient = 0.36 + 0.10 * max(n.y, 0.0);
  // Specular sheen (wet nose / eyes) scaled by the part's gloss weight.
  let h = normalize(keyDir + v);
  let sheen = pow(max(dot(n, h), 0.0), 30.0) * in.color.w;
  // Faint rim so the silhouette reads against the paper.
  let rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.16;

  let color = in.color.rgb * (ambient + diff * 0.95 + fill)
    + vec3f(sheen) + vec3f(rim);
  return vec4f(color, 1.0);
}
`;

/**
 * Present pass: premultiplied "over" composite of the object onto a soft
 * contact shadow — Vogel-disc taps on the scene alpha, offset down-right
 * (opposite the key light). Same recipe as devin/scene.ts, with the scene
 * color multiplied by its alpha so resolved MSAA edges stay correctly
 * premultiplied for the canvas `alphaMode: "premultiplied"`.
 */
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

  let shadowRgb = vec3f(0.11, 0.105, 0.095) * shadow;
  let rgb = obj.rgb * obj.a + (1.0 - obj.a) * shadowRgb;
  let alpha = obj.a + (1.0 - obj.a) * shadow;
  return vec4f(rgb, alpha);
}
`;

/* ------------------------------------------------------------------ */
/* Part construction                                                   */
/* ------------------------------------------------------------------ */

type GeoKey = "ball" | "nub" | "cone" | "whisker";

interface PartSpec {
  readonly geo: GeoKey;
  readonly color: readonly [number, number, number];
  /** Specular sheen weight (color.w in the shader): 0 fur, higher = gloss. */
  readonly sheen?: number;
  /** Parent chain defaults to the `breathe` group; "head" parents under it. */
  readonly parent?: "head";
  readonly position: Vec3;
  readonly rotation?: Vec3;
  readonly quaternion?: [number, number, number, number];
  readonly scale: Vec3;
  readonly label: string;
}

/** Quaternion rotating unit vector `a` onto `b` (for whisker direction). */
function quatBetween(a: Vec3, b: Vec3): [number, number, number, number] {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 0.99999) return [0, 0, 0, 1];
  if (d < -0.99999) return [1, 0, 0, 0]; // 180°: any perpendicular axis
  const ax = a[1] * b[2] - a[2] * b[1];
  const ay = a[2] * b[0] - a[0] * b[2];
  const az = a[0] * b[1] - a[1] * b[0];
  const w = 1 + d;
  const l = Math.hypot(ax, ay, az, w);
  return [ax / l, ay / l, az / l, w / l];
}

function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * A whisker: thin open cylinder whose +Y axis is rotated onto `dir`, its
 * center placed half a length out from `base` (head-local coords).
 */
function whisker(
  side: 1 | -1,
  base: Vec3,
  dir: Vec3,
  length: number,
): PartSpec {
  const d = normalize3([dir[0] * side, dir[1], dir[2]]);
  const b: Vec3 = [base[0] * side, base[1], base[2]];
  return {
    geo: "whisker",
    color: WHISKER,
    sheen: 0,
    parent: "head",
    position: [b[0] + d[0] * length * 0.5, b[1] + d[1] * length * 0.5, b[2] + d[2] * length * 0.5],
    quaternion: quatBetween([0, 1, 0], d),
    scale: [0.0085, length, 0.0085],
    label: `whisker-${side === 1 ? "r" : "l"}`,
  };
}

/**
 * The build sheet. All head parts are positioned relative to the head
 * pivot at HEAD_POS (so the slight head tilt moves the whole face); body
 * parts are in figure space. Sphere scales are ellipsoid radii in world
 * units (the icosphere descriptor has radius 1).
 */
const PARTS: readonly PartSpec[] = [
  // --- torso -----------------------------------------------------------
  {
    geo: "ball",
    color: FUR,
    position: [0, -0.52, 0],
    scale: [0.78, 1.0, 0.68],
    label: "body",
  },
  {
    // Haunches: a second squashed ball at the base gives the pear-shaped
    // seated silhouette instead of a plain egg.
    geo: "ball",
    color: FUR,
    position: [0, -1.12, -0.06],
    scale: [0.82, 0.52, 0.72],
    label: "haunches",
  },
  {
    // Belly patch: lighter fur on the chest front.
    geo: "ball",
    color: MUZZLE,
    position: [0, -0.58, 0.4],
    scale: [0.44, 0.6, 0.3],
    label: "belly",
  },
  // Front paws clasped together on the belly — the classic otter pose.
  {
    geo: "nub",
    color: FUR,
    position: [-0.19, -0.32, 0.57],
    rotation: [0.15, 0, -0.4],
    scale: [0.15, 0.22, 0.14],
    label: "paw-l",
  },
  {
    geo: "nub",
    color: FUR,
    position: [0.19, -0.32, 0.57],
    rotation: [0.15, 0, 0.4],
    scale: [0.15, 0.22, 0.14],
    label: "paw-r",
  },
  // Hind feet peeking out at the base.
  {
    geo: "nub",
    color: FUR,
    position: [-0.4, -1.44, 0.3],
    rotation: [0, 0.5, 0],
    scale: [0.21, 0.1, 0.28],
    label: "foot-l",
  },
  {
    geo: "nub",
    color: FUR,
    position: [0.4, -1.44, 0.3],
    rotation: [0, -0.5, 0],
    scale: [0.21, 0.1, 0.28],
    label: "foot-r",
  },
  // Tapered tail sweeping around the otter's right side along the ground —
  // the tip lands front-right so the silhouette keeps its otter read.
  {
    geo: "cone",
    color: FUR,
    position: [0.84, -1.28, 0.27],
    quaternion: quatBetween([0, 1, 0], normalize3([0.62, -0.06, 0.78])),
    scale: [0.16, 0.95, 0.14],
    label: "tail",
  },

  // --- head (positions relative to HEAD_POS) -----------------------------
  {
    geo: "ball",
    color: FUR,
    parent: "head",
    position: [0, 0, 0],
    scale: [0.68, 0.62, 0.6],
    label: "head",
  },
  // Small rounded ears half-sunk in the top corners of the head.
  {
    geo: "nub",
    color: FUR,
    parent: "head",
    position: [-0.47, 0.46, -0.02],
    rotation: [0, 0, 0.3],
    scale: [0.18, 0.15, 0.1],
    label: "ear-l",
  },
  {
    geo: "nub",
    color: FUR,
    parent: "head",
    position: [0.47, 0.46, -0.02],
    rotation: [0, 0, -0.3],
    scale: [0.18, 0.15, 0.1],
    label: "ear-r",
  },
  // Broad taupe muzzle on the lower front of the face — wide and flat.
  {
    geo: "nub",
    color: MUZZLE,
    parent: "head",
    position: [0, -0.24, 0.47],
    scale: [0.44, 0.25, 0.27],
    label: "muzzle",
  },
  {
    geo: "nub",
    color: DARK,
    sheen: 0.5,
    parent: "head",
    position: [0, -0.09, 0.7],
    scale: [0.135, 0.095, 0.085],
    label: "nose",
  },
  // Lighter eye patches lift the bead eyes off the dark fur.
  {
    geo: "nub",
    color: MUZZLE,
    parent: "head",
    position: [-0.25, 0.14, 0.46],
    scale: [0.15, 0.145, 0.1],
    label: "eye-patch-l",
  },
  {
    geo: "nub",
    color: MUZZLE,
    parent: "head",
    position: [0.25, 0.14, 0.46],
    scale: [0.15, 0.145, 0.1],
    label: "eye-patch-r",
  },
  {
    geo: "nub",
    color: DARK,
    sheen: 0.9,
    parent: "head",
    position: [-0.25, 0.15, 0.54],
    scale: [0.065, 0.065, 0.06],
    label: "eye-l",
  },
  {
    geo: "nub",
    color: DARK,
    sheen: 0.9,
    parent: "head",
    position: [0.25, 0.15, 0.54],
    scale: [0.065, 0.065, 0.06],
    label: "eye-r",
  },
  // Catchlights — the tiny dot that makes bead eyes read as alive.
  {
    geo: "nub",
    color: GLINT,
    sheen: 1,
    parent: "head",
    position: [-0.265, 0.185, 0.59],
    scale: [0.02, 0.02, 0.018],
    label: "glint-l",
  },
  {
    geo: "nub",
    color: GLINT,
    sheen: 1,
    parent: "head",
    position: [0.235, 0.185, 0.59],
    scale: [0.02, 0.02, 0.018],
    label: "glint-r",
  },
  // Whiskers: three per side fanning down-forward off the muzzle.
  whisker(-1, [0.28, -0.2, 0.58], [0.92, -0.02, 0.38], 0.32),
  whisker(-1, [0.28, -0.22, 0.58], [0.95, -0.2, 0.3], 0.34),
  whisker(-1, [0.28, -0.24, 0.57], [0.9, -0.38, 0.28], 0.3),
  whisker(1, [0.28, -0.2, 0.58], [0.92, -0.02, 0.38], 0.32),
  whisker(1, [0.28, -0.22, 0.58], [0.95, -0.2, 0.3], 0.34),
  whisker(1, [0.28, -0.24, 0.57], [0.9, -0.38, 0.28], 0.3),
];

/** Head pivot — head parts are positioned relative to this point. */
const HEAD_POS: Vec3 = [0, 0.66, 0.04];
/** Slight tilt on the whole head — the "curious otter" read. */
const HEAD_TILT: Vec3 = [0.04, 0, 0.09];

/* ------------------------------------------------------------------ */
/* Mat4 helpers (column-major)                                         */
/* ------------------------------------------------------------------ */

/**
 * Writes the inverse-transpose of the model matrix's upper-left 3x3 into
 * `out` as a mat4 (zero translation). That's the correct transform for
 * normals under the non-uniform per-part scales this build uses.
 */
function writeNormalMatrix(m: Float32Array, out: Float32Array): void {
  const a00 = m[0], a10 = m[1], a20 = m[2];
  const a01 = m[4], a11 = m[5], a21 = m[6];
  const a02 = m[8], a12 = m[9], a22 = m[10];

  // Cofactor matrix C; inverse-transpose = C / det(A).
  const c00 = a11 * a22 - a12 * a21;
  const c01 = a02 * a21 - a01 * a22;
  const c02 = a01 * a12 - a02 * a11;
  const c10 = a12 * a20 - a10 * a22;
  const c11 = a00 * a22 - a02 * a20;
  const c12 = a02 * a10 - a00 * a21;
  const c20 = a10 * a21 - a11 * a20;
  const c21 = a01 * a20 - a00 * a21;
  const c22 = a00 * a11 - a01 * a10;
  let det = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(det) < 1e-10) det = 1e-10; // degenerate: keep normals finite
  const inv = 1 / det;

  out.fill(0);
  out[0] = c00 * inv;
  out[1] = c01 * inv;
  out[2] = c02 * inv;
  out[4] = c10 * inv;
  out[5] = c11 * inv;
  out[6] = c12 * inv;
  out[8] = c20 * inv;
  out[9] = c21 * inv;
  out[10] = c22 * inv;
  out[15] = 1;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

/**
 * Per-frame interaction offsets layered on the rig. Both are optional and
 * additive: omitting them yields the bare turntable — headless renders and
 * reduced-motion frames never pass them.
 */
export interface OtterInteraction {
  /** Extra yaw (rad) added to the turntable spin — horizontal drags/fling. */
  readonly yaw?: number;
  /**
   * Camera-space pitch (rad) applied outside the spin so it always reads as
   * an on-screen tilt toward/away from the viewer. Callers clamp it — the
   * component uses ±0.5 rad.
   */
  readonly pitch?: number;
}

export interface OtterScene {
  /**
   * Encode both passes into `frame`, ending on `output` (Surface or Target).
   * `time` drives the turntable and the idle breathing; `time = 0` is the
   * deterministic still pose (START_ANGLE, neutral breath).
   */
  render(
    frame: Frame,
    output: Target,
    time: number,
    interaction?: OtterInteraction,
  ): void;
  /** Resize the internal MSAA/depth target and camera aspect (pixels). */
  resize(width: number, height: number): void;
}

const CAMERA_POS: Vec3 = [0, 0.82, 5.9];
const CAMERA_TARGET: Vec3 = [0, -0.14, 0];

/**
 * Builds the otter: offscreen MSAA+depth target, one draw per part, the
 * perspective camera, and the shadowed present effect. Lifetime is owned
 * by the gpu — `gpu.dispose()` tears everything down.
 */
export function createOtterScene(gpu: Gpu): OtterScene {
  const sceneTarget = target(gpu, {
    size: [2, 2],
    depth: true,
    msaa: true,
    label: "otter.scene",
  });

  const camera: PerspectiveCamera = perspectiveCamera({
    fov: 33,
    aspect: 1,
    near: 0.1,
    far: 20,
    position: CAMERA_POS,
    target: CAMERA_TARGET,
  });

  // Rig: tilt (camera-space, interaction) -> spin (turntable yaw) ->
  // breathe (idle scale/bob) -> parts. Head parts hang off `head` so the
  // fixed head tilt moves the whole face as one piece.
  const root = scene({ label: "otter" });
  const tilt = group({ label: "tilt" });
  const spin = group({ rotation: [0, START_ANGLE, 0], label: "spin" });
  const breathe = group({ label: "breathe" });
  const head = group({
    position: HEAD_POS,
    rotation: HEAD_TILT,
    label: "head",
  });
  root.add(tilt);
  tilt.add(spin);
  spin.add(breathe);
  breathe.add(head);

  // One geometry per shape family; parts share them.
  const geos: Record<GeoKey, ReturnType<typeof geometry>> = {
    // Main masses: subdiv-2 flat icospheres read as faceted low-poly.
    ball: geometry(gpu, icosphere({ radius: 1, subdivisions: 2, shading: "flat" })),
    // Small appendages: subdiv-1 is chunkier and cheaper.
    nub: geometry(gpu, icosphere({ radius: 1, subdivisions: 1, shading: "flat" })),
    cone: geometry(
      gpu,
      // 8-sided flat cone. NOTE: keep radialSegments even — flat shading
      // emits indexCount = radialSegments * (2*heightSegments + 1), and an
      // odd count makes the uint16 index buffer's byteLength fall off the
      // 4-byte writeBuffer alignment (vgpu mesh-cone throws on upload).
      cone({ radius: 1, height: 1, radialSegments: 8, shading: "flat" }),
    ),
    whisker: geometry(
      gpu,
      cylinder({
        radius: 1,
        height: 1,
        radialSegments: 5,
        openEnded: true,
        shading: "flat",
      }),
    ),
  };

  interface Part {
    readonly node: SceneNode;
    readonly draw: Draw;
    readonly color: readonly [number, number, number];
    readonly sheen: number;
    readonly normalMat: Float32Array;
  }

  const parts: Part[] = [];
  const eye = camera.worldPosition;

  for (const spec of PARTS) {
    const node = group({
      position: spec.position,
      rotation: spec.rotation,
      quaternion: spec.quaternion,
      scale: spec.scale,
      label: spec.label,
    });
    (spec.parent === "head" ? head : breathe).add(node);

    const d = draw(gpu, {
      shader: OTTER_SHADER,
      geometry: geos[spec.geo],
      cull: "back",
      label: `otter.${spec.label}`,
    });
    d.set({
      camera: { viewProjection: camera.viewProjection, eye },
      model: {
        model: node.worldMatrix,
        normalMat: new Float32Array(16),
        color: [...spec.color, spec.sheen ?? 0.06],
      },
    });
    parts.push({
      node,
      draw: d,
      color: spec.color,
      sheen: spec.sheen ?? 0.06,
      normalMat: new Float32Array(16),
    });
  }

  const present = effect(gpu, PRESENT_SHADER, {
    label: "otter.present",
    set: {
      scene: sceneTarget,
      sceneSampler: sampler(gpu, { minFilter: "linear", magFilter: "linear" }),
      params: {
        texel: [1 / 2, 1 / 2],
        shadowShift: [0.022, 0.034],
        shadowRadiusPx: 18,
        shadowStrength: 0.3,
      },
    },
  });

  return {
    resize(width, height) {
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      sceneTarget.resize([w, h]);
      camera.set({ aspect: w / h });
      // Re-bind: set() writes values at call time, so the refreshed
      // viewProjection and the resized texture identity go back in.
      for (const part of parts) {
        part.draw.set({
          camera: { viewProjection: camera.viewProjection, eye },
        });
      }
      present.set({
        scene: sceneTarget,
        params: {
          texel: sceneTarget.texelSize,
          shadowShift: [0.022, 0.034],
          shadowRadiusPx: Math.max(12, Math.min(w, h) * 0.03),
          shadowStrength: 0.3,
        },
      });
    },

    render(currentFrame, output, time, interaction = {}) {
      // Interaction layers onto the rig; defaults reproduce the still pose.
      tilt.set({ rotation: [interaction.pitch ?? 0, 0, 0] });
      spin.set({
        rotation: [0, START_ANGLE + time * OTTER_OMEGA + (interaction.yaw ?? 0), 0],
      });
      // Breathing: a faint sternum swell plus a hair of vertical bob, both
      // well under 2% — present but easy to miss consciously.
      const b = 0.011 * Math.sin(time * 1.4);
      breathe.set({
        scale: [1 + b * 0.5, 1 + b * 0.55, 1 + b * 0.9],
        position: [0, 0.012 * Math.sin(time * 1.4 + 0.9), 0],
      });

      for (const part of parts) {
        const wm = part.node.worldMatrix; // lazy-recomputed on read
        writeNormalMatrix(wm, part.normalMat);
        part.draw.set({
          model: {
            model: wm,
            normalMat: part.normalMat,
            color: [...part.color, part.sheen],
          },
        });
      }

      currentFrame.pass(
        { target: sceneTarget, clear: [0, 0, 0, 0], clearDepth: 1 },
        (pass) => {
          for (const part of parts) pass.draw(part.draw);
        },
      );
      currentFrame.pass(output, present);
    },
  };
}

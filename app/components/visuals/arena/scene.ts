/**
 * "La arena" — the Devin hex mark and the OpenCode "O" coexisting in one
 * 3D space. Both marks are extruded rigid bodies that drift slowly inside
 * an invisible box aligned with the stage, bounce off the walls and off
 * each other, and can be grabbed and thrown with the pointer.
 *
 * Pure vgpu — no React. ArenaScene.tsx drives it in the browser and
 * scripts/render-arena.ts renders it headless; both call the same
 * step()/render() pair:
 *
 *   arena.step(dt, grab)      // advance the physics (skip to freeze)
 *   arena.render(frame, out)  // encode the current state into a frame
 *
 * Geometry is reused verbatim from the sibling scenes: the Devin prism
 * (buildMarkOutline + buildMarkMesh) and the beveled ring + recessed bar
 * (buildRingGeometry + box). Every part shares one lit shader, and a
 * contact-shadow present pass (same recipe as the Devin scene) grounds
 * the bodies on the page.
 */

import { draw, effect, geometry, sampler, target } from "vgpu";
import { box, group, perspectiveCamera, scene } from "vgpu/scene";
import type { Draw, Frame, Geometry, Gpu, Target } from "vgpu";
import type { PerspectiveCamera, SceneNode } from "vgpu/scene";
import { buildMarkMesh, buildMarkOutline, START_ANGLE } from "../devin/scene";
import { buildRingGeometry, OPENCODE_MARK } from "../opencode/scene";

type Vec3 = [number, number, number];

/* ------------------------------------------------------------------ */
/* Stage framing                                                       */
/* ------------------------------------------------------------------ */

/** Vertical field of view (deg) and the world half-height visible at z=0. */
const FOV = 30;
const HALF_VIEW_HEIGHT = 2.05;
const CAMERA_DISTANCE = HALF_VIEW_HEIGHT / Math.tan((FOV * Math.PI) / 360);

/**
 * Invisible box: the fractions of the visible z=0 area the body centers may
 * reach, plus the box half-depth in z. The x/y bounds are recomputed on
 * resize from the live camera aspect so the walls always sit just outside
 * the framed stage (a bit of margin keeps contact shadows from clipping).
 */
const BOX_X_FRACTION = 0.86;
const BOX_Y_FRACTION = 0.78;
const BOX_HALF_DEPTH = 0.55;

/** Camera pan (world units) at the extreme of the hover parallax. */
const PAN_LIMIT_X = 0.24;
const PAN_LIMIT_Y = 0.16;

/* ------------------------------------------------------------------ */
/* Physics tuning (world units, seconds)                                */
/* ------------------------------------------------------------------ */

const MIN_DRIFT = 0.22; // ambient drift speed floor — the arena never rests
const AIR_DRAG = 0.26; // exponential velocity decay while free
const WALL_BOUNCE = 0.9; // restitution against the box walls
const BODY_BOUNCE = 0.96; // restitution mark-vs-mark
const GRAB_FOLLOW = 18; // 1/s — how tightly a held mark tracks the pointer
const MAX_THROW = 5.5; // release speed cap so a fling stays controllable
const MAX_SPEED = 7; // hard ceiling after impulses
const PICK_PADDING = 0.4; // slack added to the collision radius when picking

const INK = [0.094, 0.094, 0.094] as const; // #181818
const GRAY = OPENCODE_MARK.gray; // #5A5858 — the recessed bar

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

/**
 * Same matte two-light model as the OpenCode scene: a soft distant key
 * upper-left, faint fill, hemisphere ambient, whisper of rim. Lighting is
 * evaluated in sRGB space on purpose — linear lighting on a #181818 albedo
 * crushes every face to black. `model.color` gives each part its shade.
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

  // Soft key light from a distant point, upper-left-front.
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

/**
 * Same present pass as the Devin scene: composite the scene texture over a
 * soft contact shadow built from Vogel-disc taps on its alpha.
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

  // Soft contact shadow offset down-right (opposite the upper-left key).
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

/* ------------------------------------------------------------------ */
/* Bodies                                                              */
/* ------------------------------------------------------------------ */

interface BodySpec {
  readonly label: string;
  /** Uniform scale applied at the body root — sets the visual weight. */
  readonly scale: number;
  /** Fixed lean (euler rad) under the self-rotation — reads as a solid. */
  readonly lean: Vec3;
  readonly yaw: number; // opening spin angle
  readonly yawSpeed: number; // rad/s self-rotation (signs differ per body)
  readonly pos: Vec3;
  readonly vel: Vec3;
  /** Collision sphere radius (world units) and the fatter pick radius. */
  readonly radius: number;
}

/**
 * Opening conditions — deterministic, so headless renders and the first
 * browser frame are always this exact picture. Devin drifts in from the
 * upper-left, the O from the lower-right; spin directions are opposed.
 */
const BODY_SPECS: readonly BodySpec[] = [
  {
    label: "devin",
    scale: 0.74,
    lean: [0.1, 0, 0.05],
    yaw: START_ANGLE,
    yawSpeed: 0.24,
    pos: [-1.7, 0.34, -0.15],
    vel: [0.34, -0.15, 0.08],
    radius: 0.78,
  },
  {
    label: "opencode",
    scale: 1.04,
    lean: [0.13, 0, -0.04],
    yaw: OPENCODE_MARK.startAngle,
    yawSpeed: -0.21,
    pos: [1.55, -0.3, 0.2],
    vel: [-0.3, 0.18, -0.06],
    radius: 0.74,
  },
];

interface Part {
  readonly node: SceneNode;
  readonly draw: Draw;
  readonly color: readonly [number, number, number];
}

interface Body {
  /** Carries position + uniform scale (pos is world, children local). */
  readonly root: SceneNode;
  /** Self-rotation node, nested under a fixed-lean node. */
  readonly spin: SceneNode;
  readonly parts: Part[];
  readonly radius: number;
  readonly pos: Vec3;
  readonly vel: Vec3;
  yaw: number;
  readonly yawSpeed: number;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface ArenaSceneOptions {
  /** Physical pixel size of the output the scene is sized for. */
  readonly size: readonly [number, number];
}

/**
 * Per-frame grab state, supplied by the caller while a pointer holds a
 * body. `x`/`y` is the world-space target on the z=0 plane (grab offset
 * already folded in); `vx`/`vy` is the pointer's world velocity — it
 * becomes the body's velocity, so releasing simply stops passing a grab
 * and the throw is already in motion. `null` (or omitting) = all free.
 */
export interface ArenaGrab {
  /** Body index: 0 = Devin mark, 1 = OpenCode "O". */
  readonly body: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface ArenaPick {
  readonly body: number;
  /** body center minus the picked point — keeps the grab from jumping. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Camera pan request for hover parallax, in world units. */
export interface ArenaView {
  readonly panX?: number;
  readonly panY?: number;
}

export interface ArenaScene {
  /**
   * Advance the physics by `dt` seconds: drift, wall bounces, the
   * mark-vs-mark collision, self-rotation, and the pointer hold described
   * by `grab`. `dt <= 0` is a no-op, so reduced-motion callers can render
   * the opening state without ever stepping.
   */
  step(dt: number, grab?: ArenaGrab | null): void;
  /** Encode both passes (scene + shadowed present) into `frame`. */
  render(frame: Frame, output: Target, view?: ArenaView): void;
  /** Resize the internal scene target, camera aspect, and box bounds. */
  resize(size: readonly [number, number]): void;
  /** Canvas NDC (-1..1, y up) -> world point on the z=0 plane. */
  ndcToWorld(nx: number, ny: number): readonly [number, number];
  /** Nearest body within pick range of a world point, else null. */
  pick(wx: number, wy: number): ArenaPick | null;
  /** Current body center (world units) — used by the headless harness. */
  bodyPosition(body: number): readonly [number, number, number];
}

export function createArenaScene(
  gpu: Gpu,
  options: ArenaSceneOptions,
): ArenaScene {
  const M = OPENCODE_MARK;
  const [w, h] = options.size;
  let aspect = w / Math.max(1, h);

  const sceneTarget = target(gpu, {
    size: [Math.max(1, w), Math.max(1, h)],
    depth: true,
    msaa: true,
    label: "arena.scene",
  });

  const camera: PerspectiveCamera = perspectiveCamera({
    fov: FOV,
    aspect,
    near: 0.1,
    far: 30,
    position: [0, 0, CAMERA_DISTANCE],
    target: [0, 0, 0],
  });

  const root = scene({ label: "arena" });

  /* ---------------- geometry: reuse the existing builders ----------- */

  const devinMesh = buildMarkMesh(buildMarkOutline());
  const devinGeometry = geometry(gpu, {
    label: "arena.devin",
    buffers: [
      {
        attributes: { position: "float32x3", normal: "float32x3" },
        data: devinMesh.vertices,
        stride: 24,
      },
    ],
    indices: devinMesh.indices,
  });

  const ringMesh = buildRingGeometry(
    M.width / 2,
    M.height / 2,
    (M.width - 2 * M.stroke) / 2,
    (M.height - 2 * M.stroke) / 2,
    M.depth / 2,
    M.bevel,
  );
  const ringGeometry = geometry(gpu, {
    label: "arena.ring",
    buffers: [
      {
        attributes: { position: "float32x3", normal: "float32x3" },
        data: ringMesh.vertices,
        stride: 24,
      },
    ],
    indices: ringMesh.indices,
  });
  const barGeometry = geometry(gpu, box({ size: 1 }));

  /* ---------------- bodies ------------------------------------------ */

  function makeBody(spec: BodySpec): Body {
    const bodyRoot = group({
      position: spec.pos,
      scale: [spec.scale, spec.scale, spec.scale],
      label: `arena.${spec.label}`,
    });
    const lean = group({ rotation: spec.lean, label: "lean" });
    const spin = group({ rotation: [0, spec.yaw, 0], label: "spin" });
    root.add(bodyRoot);
    bodyRoot.add(lean);
    lean.add(spin);
    return {
      root: bodyRoot,
      spin,
      parts: [],
      radius: spec.radius,
      pos: [...spec.pos],
      vel: [...spec.vel],
      yaw: spec.yaw,
      yawSpeed: spec.yawSpeed,
    };
  }

  function addPart(
    body: Body,
    node: SceneNode,
    geo: Geometry,
    color: readonly [number, number, number],
    label: string,
  ): void {
    body.spin.add(node);
    const d = draw(gpu, {
      shader: OBJECT_SHADER,
      geometry: geo,
      cull: "back",
      label,
    });
    body.parts.push({ node, draw: d, color });
  }

  // Devin mark: one extruded prism, centered on the body.
  const devin = makeBody(BODY_SPECS[0]);
  addPart(devin, group({ label: "devin.part" }), devinGeometry, INK, "arena.devin");

  // OpenCode "O": the seamless beveled ring plus its recessed gray bar —
  // same relative transform as the standalone mark.
  const opencode = makeBody(BODY_SPECS[1]);
  addPart(opencode, group({ label: "oc.ring" }), ringGeometry, INK, "arena.ring");
  addPart(
    opencode,
    group({
      position: [0, M.barCenterY, 0],
      scale: [M.barWidth, M.barHeight, M.barDepth],
      label: "oc.bar",
    }),
    barGeometry,
    GRAY,
    "arena.bar",
  );

  const bodies: readonly Body[] = [devin, opencode];

  const present = effect(gpu, PRESENT_SHADER, {
    label: "arena.present",
    set: {
      scene: sceneTarget,
      sceneSampler: sampler(gpu, { minFilter: "linear", magFilter: "linear" }),
      params: {
        texel: sceneTarget.texelSize,
        shadowShift: [0.024, 0.038],
        shadowRadiusPx: 18,
        shadowStrength: 0.3,
      },
    },
  });

  /* ---------------- physics ----------------------------------------- */

  /** Half-extents of the invisible box; x follows the live aspect. */
  const bounds: Vec3 = [1, 1, BOX_HALF_DEPTH];
  /** Camera pan currently applied — ndcToWorld() accounts for it. */
  const camPan = { x: 0, y: 0 };

  function computeBounds(): void {
    const halfW = HALF_VIEW_HEIGHT * aspect;
    bounds[0] = Math.max(1.0, halfW * BOX_X_FRACTION);
    bounds[1] = Math.max(0.6, HALF_VIEW_HEIGHT * BOX_Y_FRACTION);
  }
  computeBounds();

  /** Keep a free body inside the box; reflect the velocity on contact. */
  function bounceWalls(body: Body): void {
    for (let axis = 0; axis < 3; axis++) {
      // Depth direction is shallow: use a smaller effective radius so a
      // mark near a z-wall doesn't pop against the side walls visually.
      const limit = bounds[axis] - (axis === 2 ? body.radius * 0.55 : body.radius);
      const v = body.pos[axis];
      if (v > limit) {
        body.pos[axis] = limit;
        if (body.vel[axis] > 0) body.vel[axis] = -body.vel[axis] * WALL_BOUNCE;
      } else if (v < -limit) {
        body.pos[axis] = -limit;
        if (body.vel[axis] < 0) body.vel[axis] = -body.vel[axis] * WALL_BOUNCE;
      }
    }
  }

  /** Sphere-vs-sphere impulse; a held body is kinematic (infinite mass). */
  function collide(a: Body, b: Body, heldIndex: number): void {
    const dx = b.pos[0] - a.pos[0];
    const dy = b.pos[1] - a.pos[1];
    const dz = b.pos[2] - a.pos[2];
    const dist = Math.hypot(dx, dy, dz);
    const minDist = a.radius + b.radius;
    if (dist >= minDist || dist < 1e-9) return;

    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const overlap = minDist - dist;
    const aHeld = heldIndex === 0;
    const bHeld = heldIndex === 1;

    if (aHeld) {
      b.pos[0] += nx * overlap;
      b.pos[1] += ny * overlap;
      b.pos[2] += nz * overlap;
    } else if (bHeld) {
      a.pos[0] -= nx * overlap;
      a.pos[1] -= ny * overlap;
      a.pos[2] -= nz * overlap;
    } else {
      const half = overlap / 2;
      a.pos[0] -= nx * half;
      a.pos[1] -= ny * half;
      a.pos[2] -= nz * half;
      b.pos[0] += nx * half;
      b.pos[1] += ny * half;
      b.pos[2] += nz * half;
    }

    // Only resolve when the bodies are actually approaching.
    const vn =
      (b.vel[0] - a.vel[0]) * nx +
      (b.vel[1] - a.vel[1]) * ny +
      (b.vel[2] - a.vel[2]) * nz;
    if (vn >= 0) return;
    const j = (-(1 + BODY_BOUNCE) * vn) / (aHeld || bHeld ? 1 : 2);
    if (!aHeld) {
      a.vel[0] -= nx * j;
      a.vel[1] -= ny * j;
      a.vel[2] -= nz * j;
    }
    if (!bHeld) {
      b.vel[0] += nx * j;
      b.vel[1] += ny * j;
      b.vel[2] += nz * j;
    }
  }

  return {
    step(dt: number, grab?: ArenaGrab | null): void {
      if (!(dt > 0)) return;
      const held = grab ? grab.body : -1;

      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        body.yaw += body.yawSpeed * dt;

        if (grab && grab.body === i) {
          // Kinematic follow: ease toward the pointer target, flatten z,
          // and take the (clamped) pointer velocity so release throws.
          const k = 1 - Math.exp(-GRAB_FOLLOW * dt);
          body.pos[0] += (grab.x - body.pos[0]) * k;
          body.pos[1] += (grab.y - body.pos[1]) * k;
          body.pos[2] += (0 - body.pos[2]) * k;
          const speed = Math.hypot(grab.vx, grab.vy);
          const s = speed > MAX_THROW ? MAX_THROW / speed : 1;
          body.vel[0] = grab.vx * s;
          body.vel[1] = grab.vy * s;
          body.vel[2] = 0;
          // A held mark can't be dragged out of the arena.
          for (let axis = 0; axis < 3; axis++) {
            const limit =
              bounds[axis] - (axis === 2 ? body.radius * 0.55 : body.radius);
            if (body.pos[axis] > limit) body.pos[axis] = limit;
            else if (body.pos[axis] < -limit) body.pos[axis] = -limit;
          }
          continue;
        }

        // Free flight: light air drag, then keep the drift alive — below
        // MIN_DRIFT the velocity is scaled back up along its own direction
        // so the arena never fully settles.
        const damp = Math.exp(-AIR_DRAG * dt);
        body.vel[0] *= damp;
        body.vel[1] *= damp;
        body.vel[2] *= damp;
        const speed = Math.hypot(body.vel[0], body.vel[1], body.vel[2]);
        if (speed > MAX_SPEED) {
          const s = MAX_SPEED / speed;
          body.vel[0] *= s;
          body.vel[1] *= s;
          body.vel[2] *= s;
        } else if (speed < MIN_DRIFT && speed > 1e-6) {
          const s = MIN_DRIFT / speed;
          body.vel[0] *= s;
          body.vel[1] *= s;
          body.vel[2] *= s;
        }

        body.pos[0] += body.vel[0] * dt;
        body.pos[1] += body.vel[1] * dt;
        body.pos[2] += body.vel[2] * dt;
        bounceWalls(body);
      }

      collide(bodies[0], bodies[1], held);
    },

    render(currentFrame: Frame, output: Target, view?: ArenaView): void {
      camPan.x = view?.panX ?? 0;
      camPan.y = view?.panY ?? 0;
      // Pure pan parallax: the view axis stays parallel to -Z, so
      // ndcToWorld() stays a simple linear mapping on the z=0 plane.
      camera.set({ position: [camPan.x, camPan.y, CAMERA_DISTANCE] });
      camera.lookAt([camPan.x, camPan.y, 0]);
      const cam = {
        viewProjection: camera.viewProjection,
        eye: camera.worldPosition,
      };

      for (const body of bodies) {
        body.root.set({ position: body.pos });
        body.spin.set({ rotation: [0, body.yaw, 0] });
      }
      for (const body of bodies) {
        for (const part of body.parts) {
          part.draw.set({
            camera: cam,
            model: { model: part.node.worldMatrix, color: part.color },
          });
        }
      }
      currentFrame.pass(
        { target: sceneTarget, clear: [0, 0, 0, 0], clearDepth: 1 },
        (pass) => {
          for (const body of bodies) {
            for (const part of body.parts) pass.draw(part.draw);
          }
        },
      );
      currentFrame.pass(output, present);
    },

    resize(size: readonly [number, number]): void {
      const sw = Math.max(1, Math.floor(size[0]));
      const sh = Math.max(1, Math.floor(size[1]));
      aspect = sw / sh;
      sceneTarget.resize([sw, sh]);
      camera.set({ aspect });
      computeBounds();
      present.set({
        params: {
          texel: sceneTarget.texelSize,
          shadowShift: [0.024, 0.038],
          shadowRadiusPx: Math.max(10, Math.min(sw, sh) * 0.022),
          shadowStrength: 0.3,
        },
      });
    },

    ndcToWorld(nx: number, ny: number): readonly [number, number] {
      // Camera looks straight down -Z: the z=0 plane maps linearly.
      const halfW = HALF_VIEW_HEIGHT * aspect;
      return [camPan.x + nx * halfW, camPan.y + ny * HALF_VIEW_HEIGHT];
    },

    pick(wx: number, wy: number): ArenaPick | null {
      let best: ArenaPick | null = null;
      let bestDist = Infinity;
      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        const d = Math.hypot(body.pos[0] - wx, body.pos[1] - wy);
        if (d < body.radius + PICK_PADDING && d < bestDist) {
          bestDist = d;
          best = {
            body: i,
            offsetX: body.pos[0] - wx,
            offsetY: body.pos[1] - wy,
          };
        }
      }
      return best;
    },

    bodyPosition(body: number): readonly [number, number, number] {
      return bodies[body].pos;
    },
  };
}

/** Hover pan amplitude helpers shared with the component. */
export const ARENA_PAN = { x: PAN_LIMIT_X, y: PAN_LIMIT_Y } as const;

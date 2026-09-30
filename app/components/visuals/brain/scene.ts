/**
 * "Cerebro compartido" — a slow, grayscale 3D node graph rendered with vgpu.
 *
 * Pure vgpu code: no React, no DOM. Both the client component (BrainScene.tsx)
 * and the headless render script (scripts/render-brain.ts) drive the exact same
 * code path: create a scene once, then encode it into a `frame()`/`frameLoop()`
 * pass targeting either a canvas `Surface` or an offscreen `Target`.
 *
 * Pipeline (two-pass, per vgpu docs — 3D needs an offscreen depth attachment):
 *   1. edges / nodes / pulses render into `scene` target (depth + MSAA x4).
 *   2. `present` effect samples the resolved color texture onto the output.
 */

/*
 * NOTE: only type imports are static here. The vgpu runtime is loaded with a
 * dynamic `import()` inside `createBrainScene` so this module also works when
 * `scripts/render-brain.ts` pulls it in under tsx's CJS pipeline (the @vgpu/*
 * packages publish an `import`-only exports map, so a static import compiled
 * to `require()` would fail with ERR_PACKAGE_PATH_NOT_EXPORTED). In the
 * Next.js bundle this simply becomes an async code-split chunk.
 */
import type { Frame, Gpu, Target } from "vgpu";

/* ------------------------------------------------------------------ */
/* Palette — sRGB-space values matching the editorial grayscale ramp.   */
/* ------------------------------------------------------------------ */
const INK = 0.094; // #181818 — primary nodes, pulses
const GRAY_MID = 0.4; // #666660 — secondary nodes
const GRAY_LIGHT = 0.639; // #a3a39b — tertiary nodes
const EDGE_RGB = 0.6; // hairline edges (reads ~#9d9d97 over paper at alpha)
const EDGE_ALPHA = 0.62;
const PAPER = 0.9725; // #f8f8f5-ish used only for depth fade

/* ------------------------------------------------------------------ */
/* Deterministic graph generation (seeded mulberry32 — same picture     */
/* in the browser and in headless renders).                             */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Vec3 = [number, number, number];

interface ClusterSpec {
  center: Vec3;
  count: number;
  spread: number; // gaussian sigma per axis
  flare: boolean; // nodes in this cluster occasionally brighten
}

/** Roughly matches references/brain-graph.svg: 4 loose labeled clusters. */
const CLUSTERS: readonly ClusterSpec[] = [
  { center: [-1.12, 0.6, -0.3], count: 14, spread: 0.38, flare: false }, // CONTEXTO
  { center: [1.1, 0.52, 0.3], count: 13, spread: 0.36, flare: true }, //    DECISIONES
  { center: [1.04, -0.58, -0.4], count: 12, spread: 0.37, flare: false }, // AGENTES
  { center: [-1.08, -0.62, 0.4], count: 13, spread: 0.4, flare: false }, //  MEMORIA
];

interface BrainGraph {
  nodeCount: number;
  edgeCount: number;
  /** vec4 per node: xyz position (model space), w sphere radius. */
  posRad: number[][];
  /** vec4 per node: x shade, y breathing phase, z flare flag, w unused. */
  misc: number[][];
  /** vec4 per edge endpoint pair (xyz used, w free). */
  edgeA: number[][];
  edgeB: number[][];
  /** Per-pulse precomputed walks: sequences of node indices. */
  pulseWalks: number[][];
  /** Cached node positions as flat Vec3 for pulse interpolation. */
  positions: Vec3[];
}

function gaussian(rng: () => number): number {
  // Box–Muller
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildGraph(seed = 20240918): BrainGraph {
  const rng = mulberry32(seed);
  const positions: Vec3[] = [];
  const radii: number[] = [];
  const misc: number[][] = [];
  const clusterOf: number[] = [];
  const hubIndex: number[] = [];

  for (let c = 0; c < CLUSTERS.length; c++) {
    const spec = CLUSTERS[c];
    const start = positions.length;
    for (let i = 0; i < spec.count; i++) {
      const p: Vec3 = [
        spec.center[0] + gaussian(rng) * spec.spread,
        spec.center[1] + gaussian(rng) * spec.spread * 0.72,
        spec.center[2] + gaussian(rng) * spec.spread,
      ];
      positions.push(p);
      clusterOf.push(c);
      // Mostly small nodes, a few larger (SVG used r=3..7).
      radii.push(0.042 + Math.pow(rng(), 2.4) * 0.062);
      // Palette distribution close to the reference: ink / mid / light.
      const pick = rng();
      const shade = pick < 0.38 ? INK : pick < 0.74 ? GRAY_MID : GRAY_LIGHT;
      misc.push([shade, rng() * Math.PI * 2, spec.flare ? 1 : 0, 0]);
    }
    // Hub: biggest + darkest node of the cluster, chosen near the centroid.
    let hub = start;
    let best = Infinity;
    for (let i = start; i < positions.length; i++) {
      const d =
        Math.abs(positions[i][0] - spec.center[0]) +
        Math.abs(positions[i][1] - spec.center[1]) +
        Math.abs(positions[i][2] - spec.center[2]);
      if (d < best) {
        best = d;
        hub = i;
      }
    }
    radii[hub] = 0.108;
    misc[hub][0] = INK;
    hubIndex.push(hub);
  }

  // --- edges: k-nearest inside clusters + a few long cross-cluster links ---
  const edgeSet = new Set<string>();
  const edgePairs: Array<[number, number]> = [];
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edgePairs.push([a, b]);
  };

  for (let c = 0; c < CLUSTERS.length; c++) {
    const start = clusterOf.indexOf(c);
    const count = CLUSTERS[c].count;
    const members = Array.from({ length: count }, (_, i) => start + i);
    for (const i of members) {
      const byDist = members
        .filter((j) => j !== i)
        .map((j) => {
          const d =
            (positions[i][0] - positions[j][0]) ** 2 +
            (positions[i][1] - positions[j][1]) ** 2 +
            (positions[i][2] - positions[j][2]) ** 2;
          return [j, d] as const;
        })
        .sort((a, b) => a[1] - b[1]);
      addEdge(i, byDist[0][0]); // nearest
      if (rng() < 0.62) addEdge(i, byDist[1][0]); // second nearest, often
      if (rng() < 0.18) addEdge(i, byDist[2][0]); // third, occasionally
    }
  }

  // Cross-cluster links: hubs talk to hubs, plus two thin random links.
  addEdge(hubIndex[0], hubIndex[1]); // CONTEXTO ↔ DECISIONES
  addEdge(hubIndex[0], hubIndex[3]); // CONTEXTO ↔ MEMORIA
  addEdge(hubIndex[1], hubIndex[2]); // DECISIONES ↔ AGENTES
  addEdge(hubIndex[2], hubIndex[3]); // AGENTES ↔ MEMORIA
  for (let k = 0; k < 2; k++) {
    const a = Math.floor(rng() * positions.length);
    const b = Math.floor(rng() * positions.length);
    if (clusterOf[a] !== clusterOf[b]) addEdge(a, b);
  }

  // --- adjacency for pulse walks ---
  const neighbors = positions.map(() => [] as number[]);
  for (const [a, b] of edgePairs) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  const makeWalk = (hops: number): number[] => {
    const walk = [Math.floor(rng() * positions.length)];
    while (walk.length < hops) {
      const cur = walk[walk.length - 1];
      const prev = walk.length > 1 ? walk[walk.length - 2] : -1;
      const options = neighbors[cur].filter((n) => n !== prev);
      if (options.length === 0) {
        // dead end — leap to another cluster so the pulse visibly travels far
        let next = Math.floor(rng() * positions.length);
        let guard = 0;
        while (clusterOf[next] === clusterOf[cur] && guard++ < 20) {
          next = Math.floor(rng() * positions.length);
        }
        walk.push(next);
      } else {
        // Prefer a hop into a different cluster now and then (~20%).
        const cross = options.filter((n) => clusterOf[n] !== clusterOf[cur]);
        const pool = cross.length > 0 && rng() < 0.22 ? cross : options;
        walk.push(pool[Math.floor(rng() * pool.length)]);
      }
    }
    return walk;
  };

  const posRad = positions.map((p, i) => [p[0], p[1], p[2], radii[i]]);
  const edgeA = edgePairs.map(([a]) => [positions[a][0], positions[a][1], positions[a][2], 0]);
  const edgeB = edgePairs.map(([, b]) => [positions[b][0], positions[b][1], positions[b][2], 0]);

  return {
    nodeCount: positions.length,
    edgeCount: edgePairs.length,
    posRad,
    misc,
    edgeA,
    edgeB,
    pulseWalks: [makeWalk(14), makeWalk(14)],
    positions,
  };
}

/* ------------------------------------------------------------------ */
/* WGSL                                                                 */
/* ------------------------------------------------------------------ */

const COMMON_WGSL = /* wgsl */ `
  struct Cam {
    viewProj: mat4x4f,
    model: mat4x4f,
    anim: vec4f, // x: seconds
  }
  const LIGHT_DIR = vec3f(-0.45, 0.78, 0.55);
  const PAPER = vec3f(${PAPER}, ${PAPER}, 0.9608);

  // Matte lambert + faint sheen + depth fade toward the paper color.
  fn matte(n: vec3f, albedo: f32, viewDepth: f32, sheen: f32) -> vec3f {
    let normal = normalize(n);
    let l = normalize(LIGHT_DIR);
    let diff = max(dot(normal, l), 0.0);
    var c = albedo * (0.4 + 0.6 * diff);
    let h = normalize(l + vec3f(0.0, 0.25, 1.0));
    c += sheen * pow(max(dot(normal, h), 0.0), 22.0);
    let fog = clamp((viewDepth - 4.4) / 3.4, 0.0, 1.0);
    c = mix(c, PAPER.x, fog * 0.34);
    return vec3f(c, c, c);
  }
`;

function nodeShader(nodeCount: number): string {
  return /* wgsl */ `
    ${COMMON_WGSL}
    struct Nodes {
      posRad: array<vec4f, ${nodeCount}>,
      misc: array<vec4f, ${nodeCount}>,
    }
    @group(0) @binding(0) var<uniform> cam: Cam;
    @group(0) @binding(1) var<uniform> nodes: Nodes;

    struct VOut {
      @builtin(position) clip: vec4f,
      @location(0) n: vec3f,
      @location(1) shade: f32,
      @location(2) depth: f32,
    }

    @vertex fn vs_main(
      @location(0) position: vec3f,
      @location(1) normal: vec3f,
      @builtin(instance_index) i: u32,
    ) -> VOut {
      let pr = nodes.posRad[i];
      let misc = nodes.misc[i];
      let t = cam.anim.x;
      // gentle per-node breathing + a rare soft flare on flagged clusters
      let breathe = 1.0 + 0.055 * sin(t * 0.85 + misc.y);
      let flare = misc.z * pow(max(sin(t * 0.5 + misc.y * 7.0), 0.0), 26.0);
      let scale = pr.w * breathe * (1.0 + 0.22 * flare);
      let local = pr.xyz + position * scale;
      let world = (cam.model * vec4f(local, 1.0)).xyz;
      let clip = cam.viewProj * vec4f(world, 1.0);
      var o: VOut;
      o.clip = clip;
      o.n = (cam.model * vec4f(normal, 0.0)).xyz;
      o.shade = min(misc.x + flare * 0.16, 0.75);
      o.depth = clip.w;
      return o;
    }

    @fragment fn fs_main(v: VOut) -> @location(0) vec4f {
      return vec4f(matte(v.n, v.shade, v.depth, 0.05), 1.0);
    }
  `;
}

function edgeShader(edgeCount: number): string {
  return /* wgsl */ `
    ${COMMON_WGSL}
    struct Edges {
      a: array<vec4f, ${edgeCount}>,
      b: array<vec4f, ${edgeCount}>,
    }
    @group(0) @binding(0) var<uniform> cam: Cam;
    @group(0) @binding(1) var<uniform> edges: Edges;

    struct VOut {
      @builtin(position) clip: vec4f,
      @location(0) n: vec3f,
      @location(1) depth: f32,
    }

    @vertex fn vs_main(
      @location(0) position: vec3f,
      @location(1) normal: vec3f,
      @builtin(instance_index) i: u32,
    ) -> VOut {
      let pa = edges.a[i].xyz;
      let pb = edges.b[i].xyz;
      let delta = pb - pa;
      let len = max(length(delta), 1e-5);
      let dir = delta / len;
      // orthonormal frame around the segment; unit cylinder is Y-up, |y|<=0.5
      let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(dir.y) > 0.93);
      let t1 = normalize(cross(dir, up));
      let t2 = cross(dir, t1);
      let local = pa + dir * ((position.y + 0.5) * len) + t1 * position.x + t2 * position.z;
      let world = (cam.model * vec4f(local, 1.0)).xyz;
      let clip = cam.viewProj * vec4f(world, 1.0);
      var o: VOut;
      o.clip = clip;
      o.n = (cam.model * vec4f(t1 * normal.x + dir * normal.y + t2 * normal.z, 0.0)).xyz;
      o.depth = clip.w;
      return o;
    }

    @fragment fn fs_main(v: VOut) -> @location(0) vec4f {
      let c = matte(v.n, ${EDGE_RGB}, v.depth, 0.0);
      return vec4f(c, ${EDGE_ALPHA});
    }
  `;
}

const PULSE_SHADER = /* wgsl */ `
  ${COMMON_WGSL}
  struct Pulses { items: array<vec4f, 2> } // xyz position (model space), w radius
  @group(0) @binding(0) var<uniform> cam: Cam;
  @group(0) @binding(1) var<uniform> pulses: Pulses;

  struct VOut {
    @builtin(position) clip: vec4f,
    @location(0) n: vec3f,
    @location(1) depth: f32,
  }

  @vertex fn vs_main(
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @builtin(instance_index) i: u32,
  ) -> VOut {
    let p = pulses.items[i];
    let local = p.xyz + position * p.w;
    let world = (cam.model * vec4f(local, 1.0)).xyz;
    let clip = cam.viewProj * vec4f(world, 1.0);
    var o: VOut;
    o.clip = clip;
    o.n = (cam.model * vec4f(normal, 0.0)).xyz;
    o.depth = clip.w;
    return o;
  }

  @fragment fn fs_main(v: VOut) -> @location(0) vec4f {
    return vec4f(matte(v.n, 0.03, v.depth, 0.12), 1.0);
  }
`;

/** Present pass: sample the resolved scene texture straight through. */
const PRESENT_SHADER = /* wgsl */ `
  @group(0) @binding(0) var scene: texture_2d<f32>;
  @group(0) @binding(1) var sceneSampler: sampler;
  @fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSampleLevel(scene, sceneSampler, uv, 0.0);
  }
`;

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export interface BrainSceneOptions {
  /** Physical pixel size of the output — used for the internal scene target. */
  size: readonly [number, number];
}

/**
 * Pointer-driven orbit state, supplied per frame by the caller. The scene
 * itself stays stateless: omit it (or pass zeros) and you get the exact same
 * deterministic picture as before — `scripts/render-brain.ts` relies on that.
 */
export interface BrainInteraction {
  /** Extra orbit yaw in radians, layered on top of the auto-turntable. */
  yaw?: number;
  /**
   * Extra pitch in radians applied after the yaw (rotX on the model).
   * Callers should clamp it — the component uses ±0.5 rad.
   */
  pitch?: number;
  /**
   * Extra accumulated pulse phase in seconds. Pulses are a pure function of
   * `time + pulsePhase`, so growing this value while dragging speeds the
   * pulses up (or freezes them when held) without any jumps.
   */
  pulsePhase?: number;
}

export interface BrainScene {
  /** Record both passes into `frame`, ending on `output` (Surface or Target). */
  render(
    frame: Frame,
    output: Target,
    time: number,
    interaction?: BrainInteraction,
  ): void;
  /** Resize the internal scene target and camera aspect (physical pixels). */
  resize(size: readonly [number, number]): void;
}

const ROTATE_PERIOD = 27; // seconds per full turn
const PULSE_PERIOD = 3.4; // seconds per edge hop
const CAM_BASE: Vec3 = [0, 0.42, 5.45];

/** Column-major rotY(yaw) * rotX(pitch) — orbit-style model rotation. */
function modelMatrix(yaw: number, pitch: number): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  // Positive yaw drags the +Z (camera-facing) front toward +X / screen right;
  // positive pitch tips the top toward the viewer.
  return new Float32Array([
    cy, 0, -sy, 0,
    sx * sy, cx, sx * cy, 0,
    cx * sy, -sx, cx * cy, 0,
    0, 0, 0, 1,
  ]);
}

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

export async function createBrainScene(
  gpu: Gpu,
  opts: BrainSceneOptions,
): Promise<BrainScene> {
  const [{ draw, effect, geometry, sampler, target }, { cylinder, icosphere, perspectiveCamera }] =
    await Promise.all([import("vgpu"), import("vgpu/scene")]);

  const graph = buildGraph();

  const scene = target(gpu, {
    size: [Math.max(1, opts.size[0]), Math.max(1, opts.size[1])],
    depth: true,
    msaa: true,
    label: "brain.scene",
  });

  const camera = perspectiveCamera({
    fov: 34,
    aspect: opts.size[0] / Math.max(1, opts.size[1]),
    near: 0.1,
    far: 20,
    position: CAM_BASE,
    target: [0, -0.03, 0],
  });

  const sphereGeo = geometry(gpu, icosphere({ radius: 1, subdivisions: 2 }));
  const edgeGeo = geometry(
    gpu,
    cylinder({ radius: 0.0042, height: 1, radialSegments: 8, openEnded: true }),
  );

  const nodesDraw = draw(gpu, {
    shader: nodeShader(graph.nodeCount),
    geometry: sphereGeo,
    instances: graph.nodeCount,
    cull: "back",
    label: "brain.nodes",
    set: { nodes: { posRad: graph.posRad, misc: graph.misc } },
  });

  const edgesDraw = draw(gpu, {
    shader: edgeShader(graph.edgeCount),
    geometry: edgeGeo,
    instances: graph.edgeCount,
    cull: "back",
    blend: "alpha",
    label: "brain.edges",
    set: { edges: { a: graph.edgeA, b: graph.edgeB } },
  });

  const pulsesDraw = draw(gpu, {
    shader: PULSE_SHADER,
    geometry: sphereGeo,
    instances: 2,
    cull: "back",
    label: "brain.pulses",
    set: { pulses: { items: [[0, 0, 0, 0.05], [0, 0, 0, 0.05]] } },
  });

  const present = effect(gpu, PRESENT_SHADER, {
    set: {
      scene,
      sceneSampler: sampler(gpu, { minFilter: "linear", magFilter: "linear" }),
    },
  });

  /** Pulse positions as a pure function of time — deterministic, stateless. */
  function pulseAt(time: number, which: number): [number, number, number, number] {
    const walk = graph.pulseWalks[which];
    const speed = 1 / PULSE_PERIOD;
    const offset = which * 5.73; // desynchronize the two pulses
    const span = walk.length - 1;
    const f = time * speed + offset;
    const edgePos = f % span; // position along the walk, in edge units
    const idx = Math.floor(edgePos);
    const frac = smoothstep(edgePos - idx);
    const a = graph.positions[walk[idx]];
    const b = graph.positions[walk[idx + 1]];
    const swell = 1 + 0.25 * Math.sin(frac * Math.PI);
    // The walk is not cyclic: shrink the dot out over the last stretch of the
    // loop and back in at the start, so the wrap never reads as a teleport.
    const wrapFade = smoothstep(Math.min(edgePos, span - edgePos) / 0.4);
    return [
      a[0] + (b[0] - a[0]) * frac,
      a[1] + (b[1] - a[1]) * frac,
      a[2] + (b[2] - a[2]) * frac,
      0.062 * swell * wrapFade,
    ];
  }

  function updateCamera(time: number): void {
    // very gentle float on top of a mostly-fixed editorial camera
    camera.set({
      position: [
        CAM_BASE[0] + 0.3 * Math.sin(time * 0.11),
        CAM_BASE[1] + 0.13 * Math.sin(time * 0.16 + 1.3),
        CAM_BASE[2] + 0.18 * Math.sin(time * 0.07 + 0.5),
      ],
    });
    camera.lookAt([0, -0.03, 0]);
  }

  function updateUniforms(
    time: number,
    interaction: BrainInteraction,
  ): void {
    updateCamera(time);
    const yaw = interaction.yaw ?? 0;
    const pitch = interaction.pitch ?? 0;
    const pulsePhase = interaction.pulsePhase ?? 0;
    const camValue = {
      viewProj: camera.viewProjection,
      // Turntable never pauses — interaction yaw/pitch are layered on top,
      // so easing them back to zero hands control back seamlessly.
      model: modelMatrix((time / ROTATE_PERIOD) * Math.PI * 2 + yaw, pitch),
      anim: [time, 0, 0, 0] as [number, number, number, number],
    };
    nodesDraw.set({ cam: camValue });
    edgesDraw.set({ cam: camValue });
    pulsesDraw.set({
      cam: camValue,
      pulses: {
        items: [
          pulseAt(time + pulsePhase, 0),
          pulseAt(time + pulsePhase, 1),
        ],
      },
    });
  }

  return {
    render(
      frame: Frame,
      output: Target,
      time: number,
      interaction: BrainInteraction = {},
    ): void {
      updateUniforms(time, interaction);
      frame.pass(
        { target: scene, clear: [0, 0, 0, 0], clearDepth: 1 },
        (pass) => {
          pass.draw(edgesDraw);
          pass.draw(nodesDraw);
          pass.draw(pulsesDraw);
        },
      );
      frame.pass(output, present);
    },
    resize(size: readonly [number, number]): void {
      const w = Math.max(1, size[0]);
      const h = Math.max(1, size[1]);
      scene.resize([w, h]);
      camera.set({ aspect: w / h });
    },
  };
}

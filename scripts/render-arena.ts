/**
 * Headless preview renderer for the arena scene (Devin mark + OpenCode "O"
 * sharing one box).
 *
 *   npx tsx scripts/render-arena.ts
 *
 * Renders 1280x640 frames through the same scene code the browser component
 * uses, composited over the site's paper color, and writes them to
 * references/:
 *   - arena-preview.png        — the deterministic opening state (no steps)
 *   - arena-preview-throw.png  — mid-throw: the "O" grabbed, flung left,
 *                                released, and caught ~0.2s into free flight
 *
 * Note: this package is CJS ("type" is unset), so tsx compiles this file to
 * CJS — but `vgpu/node` and `@vgpu/adapter-node` are ESM-only. Dynamic
 * `import()` keeps them on the ESM loader.
 */

import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { Gpu, Target } from "vgpu";
import type { ArenaScene } from "../app/components/visuals/arena/scene";

const WIDTH = 1280;
const HEIGHT = 640;

// The component renders transparent-over-paper; composite over the site's
// paper color so the preview files show exactly what readers will see.
const PAPER = [248, 248, 245] as const;

function compositeOverPaper(pixels: Uint8Array): PNG {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const a = pixels[i * 4 + 3] / 255;
    // Scene output is premultiplied (same as the canvas alphaMode).
    png.data[i * 4] = Math.round(pixels[i * 4] + PAPER[0] * (1 - a));
    png.data[i * 4 + 1] = Math.round(pixels[i * 4 + 1] + PAPER[1] * (1 - a));
    png.data[i * 4 + 2] = Math.round(pixels[i * 4 + 2] + PAPER[2] * (1 - a));
    png.data[i * 4 + 3] = 255;
  }
  return png;
}

function coverage(pixels: Uint8Array, x0: number, x1: number): number {
  let covered = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = x0; x < x1; x++) {
      if (pixels[(y * WIDTH + x) * 4 + 3] > 0) covered++;
    }
  }
  return covered;
}

function edgeAlpha(px: Uint8Array): number {
  let sum = 0;
  const m = 3;
  for (let x = 0; x < WIDTH; x++) {
    for (let k = 0; k < m; k++) {
      sum += px[(k * WIDTH + x) * 4 + 3];
      sum += px[((HEIGHT - 1 - k) * WIDTH + x) * 4 + 3];
    }
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let k = 0; k < m; k++) {
      sum += px[(y * WIDTH + k) * 4 + 3];
      sum += px[(y * WIDTH + WIDTH - 1 - k) * 4 + 3];
    }
  }
  return sum;
}

async function main(): Promise<void> {
  const { frame, init, target } = await import("vgpu/node");
  const { createArenaScene } = await import(
    "../app/components/visuals/arena/scene"
  );

  const gpu: Gpu = await init();
  const arena: ArenaScene = createArenaScene(gpu, { size: [WIDTH, HEIGHT] });
  const out: Target = target(gpu, { size: [WIDTH, HEIGHT], label: "arena.out" });

  async function renderFrame(file: string): Promise<Uint8Array> {
    frame(gpu, (f) => arena.render(f, out));
    const pixels = new Uint8Array(
      await out.color.read({ mipLevel: 0, region: "all" }),
    );
    writeFileSync(file, PNG.sync.write(compositeOverPaper(pixels)));
    return pixels;
  }

  // Frame 1: the opening arrangement — also what reduced-motion shows.
  const a = await renderFrame("references/arena-preview.png");

  // Frame 2: grab the OpenCode body, drag it right and up, release mid-drag,
  // then let physics run ~0.2s so the still catches it mid-throw.
  const [bx, by] = arena.bodyPosition(1);
  const hit = arena.pick(bx, by);
  if (!hit || hit.body !== 1) {
    console.warn(`warning: pick at the O's center returned ${JSON.stringify(hit)}`);
  }
  const body = hit?.body ?? 1;
  const offX = hit?.offsetX ?? 0;
  const offY = hit?.offsetY ?? 0;
  const dt = 1 / 60;
  for (let i = 0; i <= 21; i++) {
    const t = i / 21;
    // Pointer travels ~1.4 units right in 0.35s → ~4 u/s of release speed.
    arena.step(dt, {
      body,
      x: bx + t * 1.4 + offX,
      y: by + t * 0.6 + offY,
      vx: 4.0,
      vy: 1.7,
    });
  }
  for (let i = 0; i < 12; i++) arena.step(dt, null); // released — mid-flight
  const b = await renderFrame("references/arena-preview-throw.png");

  // Sanity: transparent corners/edges (nothing clipped), ink in both halves.
  const half = Math.floor(WIDTH / 2);
  const report = (name: string, px: Uint8Array) => {
    const left = coverage(px, 0, half);
    const right = coverage(px, half, WIDTH);
    const edge = edgeAlpha(px);
    console.log(
      `${name}: left=${left} right=${right} px, edgeAlphaSum=${edge}`,
    );
    if (left === 0 || right === 0) {
      console.warn(`warning: ${name} has a mark missing from one half`);
    }
    if (edge !== 0) {
      console.warn(`warning: ${name} has ${edge} alpha on the frame edge — possible clipping`);
    }
  };
  report("arena-preview.png", a);
  report("arena-preview-throw.png", b);
  console.log("wrote references/arena-preview.png and arena-preview-throw.png");

  gpu.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

/**
 * Headless preview renderer for the 3D OpenCode mark.
 *
 *   npx tsx scripts/render-opencode.ts
 *
 * Renders two frames (960×960) through the same scene code the browser
 * component uses, composited over the site's paper color, and writes them
 * to references/:
 *   - opencode-preview.png    — the opening/static angle (startAngle)
 *   - opencode-preview-t2.png — a later turntable angle (~1/8 turn in)
 *
 * Note: this package is CJS ("type" is unset), so tsx compiles this file to
 * CJS — but `vgpu/node` and `@vgpu/adapter-node` are ESM-only ("import"
 * exports condition). Dynamic `import()` keeps them on the ESM loader.
 */

import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { Gpu, Target } from "vgpu";
import type { OpenCodeMarkScene } from "../app/components/visuals/opencode/scene";

const WIDTH = 960;
const HEIGHT = 960;

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

function alphaAt(px: Uint8Array, x: number, y: number): number {
  return px[(y * WIDTH + x) * 4 + 3];
}

function luminanceAt(px: Uint8Array, x: number, y: number): number {
  const i = (y * WIDTH + x) * 4;
  return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
}

async function main(): Promise<void> {
  const { frame, init, target } = await import("vgpu/node");
  const { OPENCODE_MARK, OPENCODE_OMEGA, createOpenCodeMarkScene } =
    await import("../app/components/visuals/opencode/scene");

  const gpu: Gpu = await init();
  const mark: OpenCodeMarkScene = createOpenCodeMarkScene(gpu, { size: [WIDTH, HEIGHT] });
  const out: Target = target(gpu, { size: [WIDTH, HEIGHT], label: "opencode.out" });

  async function renderFrame(angle: number, file: string): Promise<Uint8Array> {
    frame(gpu, (f) => mark.encode(f, out, angle));
    const pixels = new Uint8Array(await out.color.read({ mipLevel: 0, region: "all" }));
    writeFileSync(file, PNG.sync.write(compositeOverPaper(pixels)));
    return pixels;
  }

  // Frame 1: the angle the component shows at t=0 (and for reduced motion).
  const a = await renderFrame(OPENCODE_MARK.startAngle, "references/opencode-preview.png");
  // Frame 2: ~1/8 of a turn later — shows depth, inner walls, bar recess.
  await renderFrame(
    OPENCODE_MARK.startAngle + OPENCODE_OMEGA * (OPENCODE_MARK.turnSeconds / 8),
    "references/opencode-preview-t2.png",
  );

  // Sanity assertions: transparent corners; bar reads as mid-gray.
  const cornerAlpha =
    alphaAt(a, 4, 4) +
    alphaAt(a, WIDTH - 5, 4) +
    alphaAt(a, 4, HEIGHT - 5) +
    alphaAt(a, WIDTH - 5, HEIGHT - 5);
  if (cornerAlpha !== 0) {
    console.warn(`warning: expected transparent corners, got alpha sum ${cornerAlpha}`);
  }
  const barLum = luminanceAt(a, WIDTH / 2, Math.round(HEIGHT * 0.6));
  console.log(`preview.png: cornerAlphaSum=${cornerAlpha} barLum=${barLum.toFixed(1)} (bar, gray ~85)`);
  console.log("wrote references/opencode-preview.png and references/opencode-preview-t2.png");

  gpu.dispose();
}

void main();

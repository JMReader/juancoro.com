/**
 * Headless render of the otter scene -> references/otter-preview.png
 * (plus a tilted interaction pose and a side view).
 *
 * Run: npx tsx scripts/render-otter.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

// `vgpu/node` (and the whole @vgpu dependency chain) is ESM-only: its exports
// map has no "require"/"default" condition. Dynamic import() keeps this script
// working under tsx's CJS transform, which would turn a static import into a
// failing require().
const WIDTH = 960;
const HEIGHT = 960;

// Composite the (premultiplied) render over the site's paper color so the
// preview shows exactly what the component looks like on the page.
const PAPER = [248, 248, 245] as const;

function compositeOverPaper(pixels: Uint8Array, w: number, h: number): PNG {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const a = pixels[i * 4 + 3] / 255;
    png.data[i * 4] = Math.round(pixels[i * 4] + PAPER[0] * (1 - a));
    png.data[i * 4 + 1] = Math.round(pixels[i * 4 + 1] + PAPER[1] * (1 - a));
    png.data[i * 4 + 2] = Math.round(pixels[i * 4 + 2] + PAPER[2] * (1 - a));
    png.data[i * 4 + 3] = 255;
  }
  return png;
}

async function main(): Promise<void> {
  const { frame, init, target } = await import("vgpu/node");
  const { createOtterScene } = await import(
    "../app/components/visuals/otter/scene"
  );
  const gpu = await init();
  const scene = createOtterScene(gpu);
  scene.resize(WIDTH, HEIGHT);
  const output = target(gpu, { size: [WIDTH, HEIGHT] });

  // [time, yaw, pitch, filename] — the default shot is the same still pose
  // the component renders at t=0 (and under reduced motion); the second
  // exercises the drag/tilt path, the third turns her around to check the
  // silhouette from the side.
  const shots: Array<[number, number, number, string]> = [
    [0, 0, 0, "otter-preview.png"],
    [1.6, 0.55, 0.3, "otter-preview-tilt.png"],
    [3.1, 1.35, 0, "otter-preview-side.png"],
  ];

  for (const [time, yaw, pitch, name] of shots) {
    frame(gpu, (currentFrame) =>
      scene.render(currentFrame, output, time, { yaw, pitch }),
    );
    const pixels = await output.color.read({ mipLevel: 0, region: "all" });
    let covered = 0;
    let sum = 0;
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      const a = pixels[i * 4 + 3];
      if (a > 0) covered++;
      sum += a;
    }
    console.log(
      `t=${time} yaw=${yaw.toFixed(2)} pitch=${pitch.toFixed(2)} covered=${covered} px (${((covered / (WIDTH * HEIGHT)) * 100).toFixed(1)}%) meanA=${(sum / (WIDTH * HEIGHT)).toFixed(1)}`,
    );
    const png = compositeOverPaper(pixels, WIDTH, HEIGHT);
    const file = fileURLToPath(new URL(`../references/${name}`, import.meta.url));
    writeFileSync(file, PNG.sync.write(png));
    console.log(`wrote ${file}`);
  }

  gpu.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

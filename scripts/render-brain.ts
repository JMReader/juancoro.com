/**
 * Headless render of the brain node-graph for validation.
 *
 *   npx tsx scripts/render-brain.ts
 *
 * Renders two frames (t=0 and t=9.5s) through the same `createBrainScene`
 * code path the browser component uses, composites over the paper color
 * (#f8f8f5), and writes PNGs to references/.
 */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { BrainInteraction } from "../app/components/visuals/brain/scene";

const WIDTH = 960;
const HEIGHT = 540;
const PAPER = [248, 248, 245] as const;

async function main() {
  // Dynamic imports: under tsx this file runs as CJS (the project has no
  // "type": "module") and vgpu's packages only export an `import` condition.
  const { frame, init, target } = await import("vgpu/node");
  const { createBrainScene } = await import(
    "../app/components/visuals/brain/scene"
  );

  const gpu = await init();
  const brain = await createBrainScene(gpu, { size: [WIDTH, HEIGHT] });
  const output = target(gpu, { size: [WIDTH, HEIGHT] });

  const shots: Array<[number, BrainInteraction | undefined, string]> = [
    [0, undefined, "brain-preview.png"],
    [9.5, undefined, "brain-preview-t2.png"],
    // Same instant with a mid-drag pose — validates the interaction path.
    [9.5, { yaw: 0.55, pitch: 0.28, pulsePhase: 1.2 }, "brain-preview-interactive.png"],
  ];

  for (const [t, interaction, name] of shots) {
    frame(gpu, (f) => brain.render(f, output, t, interaction));
    const pixels = await output.color.read({ mipLevel: 0, region: "all" });
    const png = new PNG({ width: WIDTH, height: HEIGHT });
    // Composite the (effectively premultiplied) rgba8 buffer over the paper color.
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3] / 255;
      png.data[i] = Math.round(pixels[i] + PAPER[0] * (1 - a));
      png.data[i + 1] = Math.round(pixels[i + 1] + PAPER[1] * (1 - a));
      png.data[i + 2] = Math.round(pixels[i + 2] + PAPER[2] * (1 - a));
      png.data[i + 3] = 255;
    }
    writeFileSync(`references/${name}`, PNG.sync.write(png));
    console.log(`wrote references/${name} (t=${t})`);
  }

  gpu.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

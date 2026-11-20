// Agua para el loader yin-yang de koi — funciones puras exportadas a TSL.
import { fbmPerlin2d } from "@vgpu/wgsl-std/noise/perlin";
import { remap, saturate } from "@vgpu/wgsl-std/math";

// Interferencia de dos campos fbm desfasados → células de luz tipo caustics.
fn causticField(p: vec2f, t: f32) -> f32 {
    let n1 = fbmPerlin2d(p + vec2f(t * 0.05, t * 0.03), 4, 2.0, 0.5);
    let n2 = fbmPerlin2d(p * 1.3 - vec2f(t * 0.04, t * 0.06) + vec2f(7.3, 2.1), 4, 2.0, 0.5);
    let c = abs(n1 - n2);
    return pow(saturate(remap(0.28, 0.02, 0.0, 1.0, c)), 1.6);
}

// Fondo de pantalla: gradiente de profundidad + caustics sutiles cerca de la
// superficie + rayos inclinados tenues + viñeta.
export fn waterBackground(uv: vec2f, timeSeconds: f32) -> vec3f {
    let t = timeSeconds;
    let h = 1.0 - uv.y; // 1 = arriba (superficie), 0 = fondo
    var col = mix(vec3f(0.006, 0.027, 0.055), vec3f(0.05, 0.16, 0.26), h * 1.1);
    let caus = causticField(uv * vec2f(6.0, 3.5) + vec2f(0.0, t * 0.02), t);
    col += vec3f(0.25, 0.5, 0.7) * caus * 0.10 * saturate(h * 2.2 - 0.9);
    var rays = 0.0;
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let sx = uv.x * 2.0 - 1.0 + (1.0 - h) * 0.55;
        let c0 = -0.8 + fi * 0.4 + sin(t * 0.07 + fi * 1.9) * 0.08;
        rays += exp(-pow((sx - c0) * (9.0 + fi), 2.0)) * (0.5 + 0.5 * sin(t * 0.11 + fi * 2.3));
    }
    col += vec3f(0.35, 0.62, 0.9) * rays * 0.05 * saturate(h * 1.6 - 0.2);
    let d = length(uv - vec2f(0.5, 0.45));
    col *= saturate(remap(0.9, 0.3, 0.45, 1.0, d));
    return col;
}

// Campo escalar del agua (0..1): el mismo ambiente pero como luminosidad,
// para mapearlo a caracteres ASCII del lado TSL.
export fn waterField(uv: vec2f, timeSeconds: f32) -> f32 {
    let t = timeSeconds;
    let h = 1.0 - uv.y;
    var v = 0.05 + 0.32 * h; // profundidad
    let caus = causticField(uv * vec2f(6.0, 3.5) + vec2f(0.0, t * 0.02), t);
    v += caus * 0.5 * saturate(h * 2.2 - 0.9);
    var rays = 0.0;
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let sx = uv.x * 2.0 - 1.0 + (1.0 - h) * 0.55;
        let c0 = -0.8 + fi * 0.4 + sin(t * 0.07 + fi * 1.9) * 0.08;
        rays += exp(-pow((sx - c0) * (9.0 + fi), 2.0)) * (0.5 + 0.5 * sin(t * 0.11 + fi * 2.3));
    }
    v += rays * 0.22 * saturate(h * 1.6 - 0.2);
    let d = length(uv - vec2f(0.5, 0.45));
    v *= saturate(remap(0.95, 0.3, 0.45, 1.0, d));
    return saturate(v);
}

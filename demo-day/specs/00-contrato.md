# demo-day — contrato técnico compartido

Todos los agentes leen este archivo. Define el mundo común; cada spec
(`fondo-oceano-ascii.md`, `animaciones-koi.md`) sólo cubre su parte.

## Objetivo

Presentación HTML **B&W épica** para el demo day de Builders OFF The
Record (X Builder House 002, Salta). Título: **"CÓMO SER MANIJA CAMBIA
VIDAS"**. Corre en vivo, fullscreen, confiable (nada de WebGPU).

## Capas (canvas apilados + DOM)

```
z=3  DOM       #slides   — tipografía y contenido de cada slide
z=2  canvas    #fx       — kois, splash, letras arrastradas (agente animaciones)
z=1  canvas    #bg       — océano ASCII permanente (agente fondo)
z=0  body      #050505
```

- `#bg` y `#fx`: `<canvas>` fullscreen, `window.innerWidth×innerHeight`,
  `devicePixelRatio` aware, `image-rendering: pixelated` donde aplique.
- El océano ASCII vive **solo** en `#bg` y nunca corta entre slides.
- Todo lo animado encima (koi, partículas, letras en vuelo) vive en `#fx`.
- Las letras de cada slide son DOM (`<span>` por carácter) para kinetic
  type y para el "se lleva las letras" (ver spec animaciones).

## API pública del fondo (que animaciones consume)

`window.OCEAN` expone (contrato — implementa el agente fondo):

- `OCEAN.surfaceY(x, t)` → y (px) de la superficie del agua en la columna
  x en el instante t. Los kois entran/salen de agua contra esta línea.
- `OCEAN.splash(x, power)` → dispara un splash en x (el agente animaciones
  lo llama al salir/al entrar el koi). power ∈ [0,1].
- `OCEAN.setIntensity(v)` → multiplica amplitud/velocidad del oleaje
  (para subir la energía en beats posteriores). v ∈ [0,1].
- `OCEAN.freeze(b)` → pausa/reanuda (debug/presentador).

## Assets disponibles

- `assets/pixel-art/koi-black/` — sheet swim 96px (3 frames, pingpong)
  + `manifest.json`. Koi negro con marca de **luna**.
- `assets/pixel-art/koi-white/` — idem, koi blanco con marca de **sol**.
- `js/pixel-sprite.js` — runtime `PixelSprite` / `loadSprite()`.
- `demo-day/moodboard/raw/` — referencias visuales aprobadas
  (ocean.png, koi-leap.png, title-slide.png).
- `src/koi3d/water.wgsl` — campo de agua de referencia (puerto WGSL→2D).

## Reglas duras

- Paleta estricta B&W sobre `#050505`. Nada de color, nada de semi-alpha
  en sprites (alpha binario).
- Determinista: `requestAnimationFrame` con timestep fijo, seed fijo;
  reproducible siempre igual (seguro en vivo).
- Controles: `→`/click/space avanza · `F` fullscreen · `R` restart.
- Sin librerías nuevas sin aviso (vanilla JS; pixel-sprite.js ya está).
- Cada agente entrega su parte integrada detrás de su API; integración
  final la hace el orquestador en `demo-day/index.html`.

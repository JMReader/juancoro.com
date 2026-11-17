# Spec agente — FONDO: océano ASCII

**Responsable:** agente A. **Skills:** ninguna especial; leer
`src/koi3d/water.wgsl` + `koi-3d.html` (referencia de campo de agua) y
`demo-day/moodboard/raw/ocean.png` (target visual).
**Entrega:** `demo-day/ocean.js` + integración en `index.html` (`#bg`).

## Qué es

El mundo constante de la presentación: un mar ASCII en B&W que corre
siempre debajo de todo, nunca corta. Referencia visual aprobada:
`demo-day/moodboard/raw/ocean.png`.

## Render

- Canvas `#bg` fullscreen (ver contrato). Grilla de celdas ~12–16 px.
- Cada celda elige un glyph según el valor del campo de agua v(x,y,t).
- Rampa de glyphs (clara→oscura): `' ', '.', '·', ':', '·', '~', '≈',
  '+', '*', '#', '%', '@'` — afinar mirando la referencia.
- Campo de agua: value-noise 2D + scroll en t (port del `waterField` del
  WGSL); oleaje más denso/brillante abajo, más suave arriba. Línea de
  superficie ondulada visible (el "horizonte" del mar) — posición
  vertical ~55–65% de pantalla (tunable).
- Movimiento: deriva lenta idle; intensidad sube con
  `OCEAN.setIntensity` (el orquestador la sube en beats tardíos).
- `OCEAN.splash(x,power)`: perturbación local en la superficie — hundir
  la línea + ondas que se propagan + burst de glyphs claros subiendo.
- `OCEAN.surfaceY(x,t)` exacto — el koi entra/sale de agua contra esto.
- Colores: blanco/grises sobre `#050505`. Fondo cielo casi vacío
  (pocos glyphs tenues como estrellas lejanas, opcional sutil).
- Rendimiento: una pasada por celda por frame; pre-calcular rampa;
  target 60fps en laptop común.

## API a exponer (ver contrato)

`surfaceY`, `splash`, `setIntensity`, `freeze` en `window.OCEAN`.

## Criterios de aceptación

- Corre 60s seguidos sin jank ni drift raro (determinista con seed).
- `surfaceY` consistente con lo dibujado (el koi no "entra" aire).
- Splash visible y físico (hunde, propaga, decae).
- Intensidad 0→1 cambia energía sin saltos.
- B&W puro; `?` oculta el panel de ayuda si hay HUD.

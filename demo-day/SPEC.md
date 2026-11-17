# demo-day — "Cómo ser manija cambia VIDAS"

Presentación **B&W épica** para el demo day de **Builders OFF The
Record** (X Builder House 002, Salta). HTML single-page, fullscreen,
confiable en vivo.

## Mundo visual

- Paleta estricta blanco y negro sobre `#050505`.
- **Océano ASCII permanente** (canvas `#bg`) — nunca corta entre slides.
- **Dos kois protagonistas**: `koi-black` (luna) y `koi-white` (sol).
- Tipografía: display condensada pesada (all caps) + mono para datos.
  Kinetic type por carácter.
- Moodboard aprobado: `demo-day/moodboard/raw/`.

## Slides (8, confirmadas con Juan — tono piola, sin humo)

Metáfora eje: **el océano ASCII = el promedio**; el koi que salta es el
que no se ahoga ("en el promedio los petisos se ahogan"). Cada
`koi-leap` saca las letras del agua del promedio.

1. **INTRO** — negro → kois nadan → picada → **CÓMO SER MANIJA CAMBIA
   VIDAS** emerge.
2. **DE JUJUY** — `JUJUY → MELI` / "para un jujeño, entrar a Meli era
   romper todos los techos". Fran (JujuyDev) testigo.
3. **LA CHARLA** — Silver.dev ~mayo: "el promedio argentino labura en
   Meli o Naranja X".
4. **LA FRASE** (slide propia) — **EN EL PROMEDIO LOS PETISOS SE
   AHOGAN** — glyphs hundiéndose bajo la línea del agua. "Yo era feliz
   del promedio — no de Jujuy, sí de Argentina."
5. **EL PROCESO** — `SILVER.DEV → LAZO` / senior / día 3: código en prod.
6. **EL MOVIMIENTO** — `1200km sin entrada` (KASZEK) → `6–7 BA` →
   `TERRIA 🏆` → `asado` → `HackaTwin` (Contratar + Prestar).
7. **LA CASA** — `30 builders` / la casa devolvió las ganas de buildear.
8. **CIERRE** — "si dudaban, haganlo ahora — es el momento" +
   **QR → página de links** + `LA MANIJA SALVA CARRERAS Y VIDAS`.

Fotos reales ya pasadas a B&W por slide:
`demo-day/assets/photos/MANIFEST.md` (44, de X @Jmcoroo + @btestaferrig
+ @paisanos_io + LinkedIn).

## Transición `koi-leap` (la pieza clave)

- Koi sale del agua en **arco parabólico** atravesando la pantalla:
  `black` L→R, `white` R→L (**al revés**), alternando koi y dirección.
- **Se lleva las letras**: chars del slide saliente se desprenden tras el
  morro del koi y siguen su arco fuera de pantalla.
- Letras del entrante **emergen del agua** donde cayó el koi.
- **Apex progresivo**: cada salto más alto (`[20→100]`%) — la manija
  gana altura literalmente.
- Cierre: única transición con **los dos kois juntos**.
- Detalle mecánico completo: `specs/animaciones-koi.md`.

## Stack y división de trabajo (agentes)

- Canvas `#bg` (océano) + `#fx` (kois/letras) + DOM (slides). Contrato
  compartido: `specs/00-contrato.md`.
- **Agente Fondo** → `specs/fondo-oceano-ascii.md` (canvas 2D ASCII,
  expone `OCEAN.surfaceY/splash/setIntensity`).
- **Agente Animaciones** → `specs/animaciones-koi.md` (assets leap/dive
  vía pixel-art argentinian connect + canvas `#fx` + kinetic type).
- Vanilla JS + `js/pixel-sprite.js`. Sin WebGPU. Determinista (seed fijo).

## Pendiente (contenido — pensar después)

- Texto exacto por slide, n° final de slides, QR/links, si se graba.
- Dirección de la alternancia L→R/R→L (confirmar lectura de "al revés").

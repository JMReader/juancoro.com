# Spec agente — ANIMACIONES: kois, intro, transiciones `koi-leap`

**Responsable:** agente B. **Skills:** `pixel-art` (generar frames de
salto/dive vía argentinian connect chatgpt + `pixelize.py`); referencias
`demo-day/moodboard/raw/koi-leap.png` (target del salto).
**Entrega:** `demo-day/koi.js` + assets nuevos en
`assets/pixel-art/koi-{black,white}/` (`leap`, `dive`) + integración `#fx`.

## Piezas

### 1. Assets nuevos (pipeline pixel-art)

Generar por cada koi (black y white), desde los sheets swim como
referencia (`--image assets/pixel-art/koi-*/sheet.png`):

- `leap` — 2–3 frames: nariz-arriba saliendo, arco medio, nariz-abajo
  entrando. Mismo tamaño/paleta que swim.
- `dive` — nariz-abajo vertical (reutilizable del leap si cierra bien).
- Procesar con `pixelize.py`, declarar en `manifest.json` → `animations`.

### 2. Intro (antes del slide 1)

1. Pantalla negra → océano emerge lento.
2. Los dos kois nadan: black entra desde izquierda, white desde derecha,
   se cruzan cerca del centro — guiño taijitu.
3. Ambos **se tiran de picado** (nose-down) en el agua → doble splash.
4. Ripple se expande → aparece el slide 1 (título **"CÓMO SER MANIJA
   CAMBIA VIDES"** emergiendo del agua).

### 3. Transición `koi-leap` (entre slides) — LA PIEZA CLAVE

Secuencia por advance:

1. Koi sale del agua en **arco parabólico** atravesando la pantalla —
   transición i: `black` L→R; transición i+1: `white` **R→L** (espejada,
   "al revés"); sigue alternando koi y dirección.
   ⚠️ Si Juan quería siempre L→R: flag `KOI_DIR='ltr'` (definir al
   integrar — preguntar antes de hardcodear).
2. El koi **"se lleva las letras"**: los chars del slide saliente se
   desprenden con ~60–90 ms de delay tras el morro del koi y siguen su
   misma trayectoria (per-char stagger + rotación leve + scale-down),
   saliendo por el mismo borde que el pez. Ilusión de que los arrastra.
3. Splash de entrada y de salida (`OCEAN.splash`) + burst ASCII.
4. Las letras del slide entrante **emergen del agua** donde cayó el koi
   (suben a línea con ease-out, per-char stagger) — como si el mar las
   devolviera.
5. **Altura de apex progresiva**: `apex_i = [20,30,40,55,70,85,100]`% de
   pantalla por índice de transición — cada salto más alto (la manija
   gana altura). Escala del sprite ~1.4–1.8× en arco.
6. Cierre (beat final): **ambos kois saltan juntos** en arcos espejados
   (taijitu) — la única transición con doble koi.

### Timing y calidad

- Duración transición ~1.4 s; easing: lanzamiento ease-out, caída ease-in
  con squash al tocar agua.
- Durante el vuelo el koi rota tangente al arco (nariz al movimiento).
- Splash: burst de glyphs claros + ripples concéntricos en `#fx` encima
  del splash de `#bg` (se superponen para densidad).
- Todo interrumpible limpio si el usuario avanza rápido (state machine,
  nada de timeouts sueltos).

## Criterios de aceptación

- El "se lleva las letras" se lee clarísimo aun en pantalla rápida.
- Sin drift de sprites; kois siempre entran/salen por `surfaceY`.
- Intro completa ~6–8 s, skipeable con click.
- Ambos kois se ven distintos y reconocibles (luna/sol legibles).
- 60fps, determinista, B&W puro.

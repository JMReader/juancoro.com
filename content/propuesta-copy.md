# Propuesta de copy — "Cómo ganar un hackathon"

Borrador de texto para la versión épica (visuales full-bleed, menos cajas).
No toca estructura ni marcadores: `[SCENE:*]`, `[PROMPT:*]`, `[BANDA OSCURA]` quedan donde están.

Leyenda de estados:

- **[NEW]** — texto que hoy no existe.
- **[REWRITTEN]** — reemplaza texto actual (se cita el original).
- **[UNCHANGED]** — se deja como está (listado para el diff).

Voz: Juan Manuel Coro, Developer · de Jujuy. Ganó Hack CBA. Seco, directo, practicante. Voseo. Frases cortas.

---

## 1. Hero / apertura — 3 variantes

Elementos en juego: kicker, título, lede, primera línea hablada, la cita de Lincoln, el cierre de portada ("Afilar el hacha es…"), el grid de capítulos.

### Opción A — "La punchline primero" (evolución de la actual)

Para cuando la cita funcione mejor como cierre del hero que como apertura.

- kicker **[UNCHANGED]**: `CONCEPTOS Y HERRAMIENTAS`
- título **[UNCHANGED]**: `Menos improvisación. Más producto funcionando.`
- lede **[REWRITTEN]**:
  - Actual: `Un flujo para construir con IA y llegar a la demo con algo real.`
  - Propuesta: `El flujo con el que gané Hack CBA: IA, spec, una memoria compartida y una demo que funciona.`
- primera línea **[NEW]** (va antes de la cita, cierra el hero):
  `Lincoln lo dijo con un hacha. Nosotros lo hacemos con una spec.`
- cita **[UNCHANGED]** — pasa a ser el broche visual del hero, tamaño grande, full-bleed.
- cierre de portada **[UNCHANGED]**: `Afilar el hacha es la spec y el cerebro compartido. Talar es codear. …`

### Opción B — "El hacha primero" (abrir con la cita)

La cita abre la página en pantalla completa. El título responde.

- orden: cita → kicker → título → lede → línea puente.
- cita **[UNCHANGED]** (se mueve arriba):
  `«Dame seis horas para talar un árbol y pasaré las primeras cuatro afilando el hacha.» — Atribuida a Abraham Lincoln`
- kicker **[UNCHANGED]**: `CONCEPTOS Y HERRAMIENTAS`
- título **[UNCHANGED]**: `Menos improvisación. Más producto funcionando.`
- lede **[REWRITTEN]**:
  - Propuesta: `Cuatro de seis horas sin talar. En una hackathon la proporción es parecida: la mayor parte del trabajo no es codear.`
- línea puente **[NEW]** (lleva de la cita al grid de capítulos):
  `Esto es lo que afilo antes de tocar el teclado.`
- cierre de portada **[REWRITTEN]** (versión corta, porque la cita ya está arriba):
  - Propuesta: `Spec y cerebro compartido: el filo. Código: el golpe.`

### Opción C — "La confesión" (humor seco de la charla)

Recupera el chiste del deck: *"Cómo ganar hackathons. (yo no elegí este título)"*.

- kicker **[REWRITTEN]**:
  - Actual: `CONCEPTOS Y HERRAMIENTAS`
  - Propuesta: `CÓMO GANAR HACKATHONS (YO NO ELEGÍ ESTE TÍTULO)`
- título **[UNCHANGED]**: `Menos improvisación. Más producto funcionando.`
- lede **[REWRITTEN]**:
  - Propuesta: `Gané uno. En Jujuy no sobran hackathons para practicar, así que preparé el mío como si fuera el último.`
- primera línea **[NEW]**:
  `No hay truco. Hay preparación. Lincoln lo explicó antes que todos.`
- cita **[UNCHANGED]** — sigue donde está; la línea anterior la introduce.
- cierre de portada **[UNCHANGED]**.

### Opcional — frontmatter **[NEW]**

Si el kicker de la Opción C gana, considerá:
`title: "Cómo ganar un hackathon (yo no elegí este título)"` — con el subtítulo SEO actual movido a description. Solo si el chiste también vale para el `<title>`.

---

## 2. Intros de capítulo — reescritas

### 01 / DEFINIR — SDD

**[REWRITTEN]** intro.

- Actual: `Spec-Driven Development: escribir qué vamos a construir y usar esa especificación para guiar la implementación y comprobar el resultado.`
- Propuesta:
  `El prompt no es el plan. SDD es escribir primero qué tiene que pasar — y usar esa spec para guiar a la IA y comprobar lo que entrega.`

**[REWRITTEN]** línea siguiente.

- Actual: `Para una hackathon, usaría tres documentos cortos. El nivel de detalle tiene que alcanzar para que dos personas entiendan lo mismo.`
- Propuesta:
  `Tres documentos cortos alcanzan. La vara: dos personas tienen que entender lo mismo.`

**[UNCHANGED]**: la cita intermedia, los tres pasos, la nota de Spec Kit, el link, el `[PROMPT:sdd]`.

### 02 / COMPARTIR CONTEXTO — Cerebro compartido

**[REWRITTEN]** intro.

- Actual: `Cerebro Compartido es tu plugin para guardar decisiones y trabajo en Markdown dentro de un repo común.`
- Propuesta:
  `Cinco computadoras, varias IAs, una sola memoria. Cerebro Compartido guarda decisiones y trabajo en Markdown, dentro del repo del equipo.`
  (Dato real: el vault de Hack CBA se sincronizó entre cinco máquinas — ya está en la nota del capítulo.)

**[REWRITTEN]** cita intermedia — darle filo a la pregunta.

- Actual: `"¿Qué hizo Nano en la última media hora?"`
- Propuesta:
  `Pregunta real de una hackathon: "¿qué hizo Nano en la última media hora?" Con cerebro, la respuesta está en el repo — no en la memoria de nadie.`

**[UNCHANGED]**: `team/` y `each_one/`, los tres pasos, `[SCENE:brain]`, links, nota de seguridad.

### 03 / EJECUTAR — Devin / OpenCode

**[REWRITTEN]** intro.

- Actual: `Elegí un agente que puedas usar y darle tareas concretas. La spec y el cerebro le dan contexto; vos revisás lo que entrega.`
- Propuesta:
  `El agente no adivina: ejecuta lo que la spec define y el cerebro recuerda. Tu rol cambia — de escribir código a definir tareas y verificar entregas.`

**[REWRITTEN]** línea de delegación en el bloque Devin (más concreta, sin inventar capacidades).

- Actual: `Para la hackathon: asignale una tarea delimitada, el contrato de entrada/salida y una comprobación concreta. Pedile que deje un cambio revisable.`
- Propuesta:
  `Una tarea delimitada, un contrato de entrada/salida, una comprobación concreta. Lo que entrega se revisa como el trabajo de cualquier compañero: antes de integrarlo.`

**[REWRITTEN]** cierre del bloque OpenCode.

- Actual: `Usá un modelo económico para cambios simples y uno más capaz cuando el problema lo justifique. Medí cuánto gastás por tarea terminada.`
- Propuesta:
  `Modelo barato para cambios simples, modelo capaz cuando el problema lo pide. La métrica que importa: cuánto gastás por tarea terminada.`

**[UNCHANGED]**: definición de Devin + SWE, mención de Erasmo, links, ambos `[SCENE:*]`, `[PROMPT:delegar]`, nota de disponibilidad.

### 04 / HACER VISIBLE LA IDEA — vgpu.sh

**[REWRITTEN]** intro.

- Actual: `Una biblioteca TypeScript de WebGPU para shaders y gráficos acelerados. Tiene documentación y ejemplos pensados también para agentes.`
- Propuesta:
  `Las demos se juzgan con los ojos. vgpu es una biblioteca TypeScript de WebGPU para shaders y gráficos acelerados, con docs y ejemplos pensados también para agentes.`

**[REWRITTEN]** cita intermedia.

- Actual: `Un recurso visual que explique el producto puede hacer una demo mucho más clara.`
- Propuesta:
  `Si el jurado entiende el producto en diez segundos, los otros cincuenta son tuyos.`

**[REWRITTEN]** párrafo del meta-GUIño (los 3D de esta página).

- Actual: `Los tres gráficos 3D de esta página — el cerebro, la marca de Devin y la O de OpenCode — están hechos con vgpu y se renderizan en tu navegador ahora mismo.`
- Propuesta:
  `Esta página es su propia demo: el cerebro, la marca de Devin y la O de OpenCode están hechos con vgpu y se renderizan en tu navegador, ahora.`

**[UNCHANGED]**: los 4 pasos de "Cómo lo usaría", los comandos `npx vgpu`, la nota de alcance.

### 05 / TEMAS QUE SUMARÍA — La demo también se construye

**[NEW]** intro (hoy el capítulo entra directo a los tres puntos).

- Propuesta:
  `El código es la mitad del trabajo. La otra mitad es recorrido, integración y pitch — y también se construye.`

**[UNCHANGED]**: los tres ítems (MVP, integrar temprano, pitch y plan B) — ya están bien cortos.

**[REWRITTEN]** `[BANDA OSCURA]` — opción más seca para el cierre del cuerpo.

- Actual:
  `Una tarea está lista cuando podemos mostrarla. / El agente termina. El equipo verifica. La demo lo hace visible.`
- Propuesta:
  `El agente termina. El equipo verifica. La demo convence. / Nada está listo hasta que se puede mostrar.`

---

## 3. Captions de las figuras 3D

Cortos, con algo de humor. Pensados para render en mono; si se mantienen en mayúsculas funcionan igual.

### `[SCENE:brain]` **[REWRITTEN]**

- Actual: `EL CEREBRO COMPARTIDO, EN 3D — RENDERIZADO EN TU NAVEGADOR CON VGPU. CADA NODO ES UNA NOTA; CADA PULSO, CONTEXTO QUE VIAJA ENTRE CABEZAS.`
- Propuesta principal:
  `La memoria del equipo, latiendo en tu navegador.`
- Alternativas:
  - `Cada nodo es una nota. Cada pulso, contexto que viaja entre cabezas.`
  - `Cinco máquinas, una memoria. Renderizado acá, ahora, con vgpu.`

### `[SCENE:devin]` **[REWRITTEN]**

- Actual: `DEVIN — LA MARCA, EXTRUIDA EN 3D CON VGPU`
- Propuesta principal:
  `Devin, extruido en vivo. El render también se delegó.`
- Alternativas:
  - `La marca de Devin, en 3D. Extrusión cortesía de vgpu.`
  - `Devin. Hasta el logo entregó algo verificable.`

### `[SCENE:opencode]` **[REWRITTEN]**

- Actual: `OPENCODE — LA "O" DEL LOGO, EN 3D CON VGPU`
- Propuesta principal:
  `La «O» de OpenCode. Abierta, como corresponde.`
- Alternativas:
  - `OpenCode: la O, girando en tu GPU.`
  - `Código abierto, logo abierto, render abierto.`

---

## 4. Bloque de cierre **[NEW]**

Párrafo nuevo, justo antes de `# FUENTES Y RECURSOS`. Cierra la metáfora del hacha e invita a compartir.

### Propuesta principal

> El jurado ve la demo. No ve la spec que la hizo posible, ni el cerebro que la mantuvo en pie. Afilá antes, talá después — y si este flujo te sirve, pasaselo a tu equipo. Es la misma preparación con la que gané Hack CBA.

### Alternativas

- `Nadie aplaude el afilado. Aplauden el corte. Prepará la spec, compartí el cerebro, ensayá la demo — y contale a otro equipo cómo se hace.`
- `El hacha se presta; la preparación no. Si te servió, compartilo: la próxima demo que funcione puede salir de este texto.`

Footer **[UNCHANGED]**: `Juan Manuel Coro · Material para compartir — X @Jmcoroo · LinkedIn /in/j-mcoro`

---

## 5. Resumen para el diff

| Bloque | Estado |
|---|---|
| kicker | UNCHANGED (salvo Opción C) |
| título hero | UNCHANGED |
| lede | REWRITTEN (una variante por opción) |
| primera línea / puente con la cita | NEW |
| cita Lincoln | UNCHANGED — solo cambia posición según opción |
| cierre de portada | UNCHANGED (A, C) / REWRITTEN (B) |
| intro cap. 01 | REWRITTEN |
| intro cap. 02 + cita "Nano" | REWRITTEN |
| intro cap. 03 + línea delegación + cierre OpenCode | REWRITTEN |
| intro cap. 04 + cita + meta-GUIño | REWRITTEN |
| cap. 05 intro | NEW |
| BANDA OSCURA | REWRITTEN |
| captions brain / devin / opencode | REWRITTEN |
| párrafo pre-fuentes | NEW |
| pasos, prompts, notas, links, fuentes, footer | UNCHANGED |

Nada de "revolucionario", nada de "game-changer". Todo verificable contra `como-ganar-un-hackathon.md`.

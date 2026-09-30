---
slug: como-ganar-un-hackathon
title: "Cómo ganar un hackathon: recursos y herramientas"
description: "SDD, Cerebro Compartido, Devin, OpenCode y vgpu.sh: qué son, cómo usarlos y dónde enfocarte para llegar a una demo que funcione."
author: Juan Manuel Coro
date: 2026-09-29
lang: es-AR
---
<!--
  FUENTE DE VERDAD DEL TEXTO DEL POST.
  Editá libremente. Los marcadores [SCENE:*], [PROMPT:*], [DETAILS], [FIGURE]
  son bloques especiales que yo convierto en componentes — no los borres.
  Cuando termines de editar avisame y sincronizo el JSX con este archivo.
-->

# PORTADA

kicker: CONCEPTOS Y HERRAMIENTAS

# Como ganar un hackathon 

Herramientas para dar vida a una idea en tiempos cortos

## Grid 01 — SDD

Spec funcional. Spec técnica. Plan de tareas.

## Grid 02 — Cerebro compartido

Contexto común. Leer antes. Guardar al cerrar.

## Grid 03 — Devin / OpenCode

Tareas chicas. Un agente, un objetivo. Verificar el resultado.

## Grid 04 — vgpu.sh

Gráficos con WebGPU. Un recurso visual que ayude a la demo.

puente: No hay truco. Hay preparación. Lincoln lo explicó antes que todos.

> «Dame seis horas para talar un árbol y pasaré las primeras cuatro afilando el hacha.»
> — Atribuida a Abraham Lincoln

cierre de portada: Afilar el hacha es la spec y el cerebro compartido. Talar es codear. MVP acotado. Integración temprana. Demo ensayada.

---

# 01 / DEFINIR — SDD ¿Que es? y porque es importante 

intro: SDD o Spec-Driven Development: es una metodoloigia que permite describir a detalle qué vamos a construir y usar ese documento para guiar la implementación y comprobar el resultado de la mano de agentes de IA .

> Primero entendemos punta a punta que queremos construir, después le  damos vida con la IA.

Para una hackathon, usaría tres documentos cortos. El nivel de detalle tiene que alcanzar para que dos personas entiendan lo mismo y un agente pueda especificarlo.

Esta separación es una adaptación práctica como recomnedacion. Hay skills como Spec Kit reúne el diseño técnico en el plan y luego genera las tareas.

link: [https://github.github.com/spec-kit/quickstart.html](https://github.github.com/spec-kit/quickstart.html) — Ver GitHub Spec Kit

Basicamente el, procesos se divide en 3 pasos uno con cada documentgo 

### Paso 1 — Spec funcional

**Qué y para quién.** desribe el Usuario, el problema,  el flujo principal, alcance y criterios de aceptación.  
*Ejemplo:[otro ejemplo mas facil de entender y usemos el mismo a lo largo dle documento por ejemplo para uber]*

### Paso 2 — Spec técnica

**Cómo lo hacemos.** Stack conocido, datos, APIs, contratos y qué vamos a simular para la demo.
*Ejemplo: front, endpoint de parcela y formato de respuesta acordado. Datos de muestra identificados como tales.*

### Paso 3 — Plan

**Quién hace qué y en qué orden.** Tareas pequeñas, responsables, dependencias y cómo validar cada entrega.
*Ejemplo: contrato primero, front y API en paralelo, integrar y probar la URL pública.*



[PROMPT:sdd]
Ayudame a acotar este proyecto para una hackathon.
Primero hacé una spec funcional con usuario, problema, flujo principal,
qué queda afuera y criterios de aceptación.
Resolvé conmigo las dudas antes de proponer tecnología.
Después armemos la spec técnica y un plan de tareas pequeñas,
con responsables, dependencias y una forma de verificar cada tarea.
[/PROMPT]

---

# 02 / COMPARTIR CONTEXTO — Tu equipo y sus IAs, con la misma memoria

intro: Cerebro Compartido es un plugin que guarda las decisiones y el trabajo del equipo en Markdown, dentro de un repo común. Básicamente, todas las computadoras e IAs del equipo leen y escriben en el mismo lugar.

El repo se divide en dos: `team/` guarda la verdad compartida y `each_one/<vos>/` guarda el trabajo de cada persona o agente.

> Pregunta real de una hackathon: "¿qué hizo Nano en la última media hora?" Con cerebro, la respuesta está en el repo — no en la memoria de nadie.

Lo usaría para retomar una tarea, encontrar una decisión y ver qué hizo otro sin volver a explicarle el proyecto a cada IA.

### Paso 1 — Instalar y configurar

Instalá el plugin siguiendo el README. Decile al agente: `corré cerebro-setup`. Configura el cerebro, el equipo y la sincronización.

### Paso 2 — Leer antes de trabajar

Invocá `cerebro-leer` para traer el contexto vigente, próximos pasos y bloqueos.

### Paso 3 — Guardar al terminar

Pedile: `cerrá esto con cerebro-cierre`. Guarda lo que cambió y deja contexto para la siguiente tarea.

[FIGURE:brain svg estático — el grafo interactivo vive en la portada]
caption: CINCO MÁQUINAS, UNA MEMORIA — EL GRAFO DE LA PORTADA, EN REPOSO.
[/FIGURE]

links:

- [https://github.com/JMReader/cerebro-compartido](https://github.com/JMReader/cerebro-compartido) — Plugin cerebro-compartido
- [https://github.com/JMReader/shared-brain](https://github.com/JMReader/shared-brain) — Vault usado en Hack CBA

nota: El vault de Hack CBA se sincronizó entre cinco computadoras. Las decisiones comunes necesitan mantenerse vigentes. No guardar secretos ni archivos .env.

---

# 03 / EJECUTAR — Devin con SWE, u OpenCode

intro: El agente no adivina: ejecuta lo que la spec define y el cerebro recuerda. Básicamente tu rol cambia — pasás de escribir código a definir tareas concretas y verificar lo que entrega.

[SCENE:arena — Devin y la O de OpenCode conviviendo en un mismo espacio con física; agarrables y lanzables]
caption: DEVIN Y LA «O» DE OPENCODE, EN LA MISMA ARENA — AGARRÁLAS Y TIRÁLAS.
[/SCENE]

## Devin + modelos SWE

Devin puede escribir, ejecutar y probar código solo. SWE es la familia de modelos de Cognition: el agente y el modelo cumplen roles distintos.

Para la hackathon le daría una tarea delimitada, el contrato de entrada/salida y una comprobación concreta. Lo que entrega se revisa igual que el trabajo de cualquier compañero: antes de integrarlo.

[SCENE:otter — la nutria de Devin, mascota, en 3D junto al texto]

**Hablá con Erasmo Hernández** para consultar demos, acceso o actividades de comunidad de Cognition. Créditos o beneficios dependen de lo que esté disponible.

links:

- [https://docs.devin.ai/](https://docs.devin.ai/) — Devin
- [https://www.linkedin.com/in/erasmohernandez/](https://www.linkedin.com/in/erasmohernandez/) — Erasmo

## OpenCode, controlando el gasto

OpenCode es un agente open source que corre en la terminal, el IDE o el escritorio. Permite usar modelos gratuitos disponibles o conectar un proveedor.

Es una opción barata si elegís bien el modelo y acotás las tareas — que el software sea abierto no hace gratis a las APIs.

Usaría un modelo barato para cambios simples y uno más capaz cuando el problema lo pide. La métrica que importa: cuánto gastás por tarea terminada.

links:

- [https://opencode.ai/](https://opencode.ai/) — OpenCode
- [https://devin.ai/pricing](https://devin.ai/pricing) — Planes de Devin



[PROMPT:delegar]
Leé la spec y el contexto del cerebro antes de empezar.
Implementá solamente esta tarea: [tarea].
Entrada esperada: [contrato]. Salida esperada: [contrato].
El resultado está listo cuando: [criterio verificable].
Si el contrato es ambiguo, preguntá antes de cambiarlo.
Mostrame cómo lo comprobaste y cerrá con cerebro-cierre.
[/PROMPT]

nota: La disponibilidad de modelos SWE y las cuotas dependen del producto y del plan vigente. No se asume una promoción ni uso ilimitado.

---

# 04 / HACER VISIBLE LA IDEA — vgpu.sh

intro: vgpu es una biblioteca de TypeScript para hacer gráficos con WebGPU — shaders, efectos y visualizaciones aceleradas por GPU. Viene con documentación y ejemplos pensados también para agentes.

Sirve para construir visuales en el navegador, y también corre en Node para hacer pruebas headless.

> Si el jurado entiende el producto en diez segundos, los otros cincuenta son tuyos.

Esta página es su propia demo: el cerebro de la portada, la nutria de Devin y la O de OpenCode están hechos con vgpu y se renderizan en tu navegador, ahora.

links:

- [https://vgpu.sh](https://vgpu.sh) — Documentación y ejemplos
- [https://github.com/vercel-labs/vgpu](https://github.com/vercel-labs/vgpu) — Repositorio

## Cómo lo usaría en una hackathon

1. Buscaría en los ejemplos algo que ayude a explicar el problema.
2. Partiría de ese ejemplo, no de cero.
3. Le daría al agente la documentación y el objetivo visual.
4. Lo probaría en la máquina y el navegador de la demo, con una alternativa estática.

```
npx vgpu docs
npx vgpu examples search "raymarching"
npx vgpu check
```

nota: Ejemplo de uso propuesto: mostrar un terreno o un fenómeno visual. No reemplaza el flujo funcional ni es un servicio de alquiler de GPU.

---

# 05 / TEMAS QUE SUMARÍA — La demo también se construye

intro: Básicamente: el código es la mitad del trabajo. La otra mitad es recorrido, integración y pitch — y también se construye.

### MVP y criterio del jurado

Elegir un usuario, un problema y un recorrido completo. Revisar qué evalúa el track y decidir qué queda afuera.

### Integrar desde temprano

Acordar contratos entre front y back. Tener una versión desplegada que todos puedan abrir antes del sprint final.

### Pitch y plan B

Ensayar problema, solución y demo. Tener datos listos y una grabación de respaldo. Si algo es simulado, decirlo.

[BANDA OSCURA]
Nada está listo hasta que se puede mostrar.
El agente termina. El equipo verifica. La demo convence.
[/BANDA OSCURA]

---

# 06 / PARA EMPEZAR — Un prompt para dejar todo listo

intro: Básicamente: si arrancás una hackathon mañana, pegá esto en tu agente y tenés el flujo completo — cerebro, spec, plan y visuales.

[PROMPT:setup — el mega-prompt, se muestra siempre abierto]
Preparame el setup completo para una hackathon con este flujo:

1. CEREBRO — Instalá el plugin cerebro-compartido
   (github.com/JMReader/cerebro-compartido) y corré cerebro-setup
   conmigo. Dejá el vault creado y team/ con las decisiones
   iniciales del proyecto.

2. SPEC — Creá tres documentos en el repo:
   · spec-funcional.md: usuario, problema, flujo principal,
     qué queda afuera y criterios de aceptación.
   · spec-tecnica.md: stack, contratos de datos y qué se simula
     para la demo.
   · plan.md: tareas chicas con responsable, dependencias y
     cómo se verifica cada una.
   Arrancalos con lo que sepas y marcame las preguntas que
   falten antes de codear.

3. DEMO — Si la demo vive en el navegador, instalá vgpu
   (npm i vgpu) y dejame una escena de ejemplo corriendo con
   fallback estático.

4. PLAN DE AGENTES — Asigname qué hace cada agente del equipo:
   tarea, contrato de entrada/salida y criterio verificable.

Cuando termines, cerrá con cerebro-cierre así cualquier agente
retoma el contexto sin que se lo repita.
[/PROMPT]

nota: Ajustalo al proyecto concreto antes de mandarlo. Un agente con contexto equivocado prepara muy bien el proyecto equivocado.

---

# CIERRE

El jurado ve la demo. No ve la spec que la hizo posible, ni el cerebro que la mantuvo en pie. Afilá antes, talá después — y si este flujo te sirve, pasáselo a tu equipo. Es la misma preparación con la que gané Hack CBA.

---

# FUENTES Y RECURSOS

Consultados el 29 de septiembre de 2026. Los consejos de hackathon son una propuesta práctica; las capacidades se basan en la documentación enlazada.

- [https://github.github.com/spec-kit/quickstart.html](https://github.github.com/spec-kit/quickstart.html) — GitHub Spec Kit: especificación, diseño técnico y tareas
- [https://github.com/JMReader/cerebro-compartido](https://github.com/JMReader/cerebro-compartido) — Cerebro Compartido: README y uso de las tres skills
- [https://github.com/JMReader/shared-brain](https://github.com/JMReader/shared-brain) — SharedBrain: estructura del vault
- [https://github.com/vercel-labs/vgpu](https://github.com/vercel-labs/vgpu) — Vercel Labs vgpu: README oficial
- [https://docs.devin.ai/get-started/devin-intro](https://docs.devin.ai/get-started/devin-intro) — Cognition: capacidades y buenas instrucciones para Devin
- [https://cognition.com/blog/new-self-serve-plans-for-devin](https://cognition.com/blog/new-self-serve-plans-for-devin) — Cognition: planes y cuotas
- [https://opencode.ai/](https://opencode.ai/) — OpenCode: modelos y opciones de uso
- [https://luma.com/ita42zws](https://luma.com/ita42zws) — Devin Buenos Aires Meetup: demo con Erasmo Hernández

---

footer: Juan Manuel Coro · Material para compartir — X @Jmcoroo · LinkedIn /in/j-mcoro
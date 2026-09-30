import type { Metadata } from "next";
import { HeaderActions } from "../../components/HeaderActions";
import { ExitProject } from "../../components/ExitProject";
import { CopyPrompt } from "../../components/CopyPrompt";
import { BrainScene } from "../../components/visuals/brain/BrainScene";
import { ArenaScene } from "../../components/visuals/arena/ArenaScene";
import { OtterScene } from "../../components/visuals/otter/OtterScene";

const TITLE = "Cómo ganar un hackathon: recursos y herramientas";
const DESCRIPTION =
  "SDD, Cerebro Compartido, Devin, OpenCode y vgpu.sh: qué son, cómo usarlos y dónde enfocarte para llegar a una demo que funcione.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  authors: [{ name: "Juan Manuel Coro", url: "https://juancoro.com" }],
  alternates: { canonical: "/blog/como-ganar-un-hackathon" },
  openGraph: {
    type: "article",
    locale: "es_AR",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 960, height: 540 }],
  },
  twitter: {
    card: "summary_large_image",
    creator: "@Jmcoroo",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

const PROMPT_SDD = `Ayudame a acotar este proyecto para una hackathon.
Primero hacé una spec funcional con usuario, problema, flujo principal,
qué queda afuera y criterios de aceptación.
Resolvé conmigo las dudas antes de proponer tecnología.
Después armemos la spec técnica y un plan de tareas pequeñas,
con responsables, dependencias y una forma de verificar cada tarea.`;

const PROMPT_DELEGATE = `Leé la spec y el contexto del cerebro antes de empezar.
Implementá solamente esta tarea: [tarea].
Entrada esperada: [contrato]. Salida esperada: [contrato].
El resultado está listo cuando: [criterio verificable].
Si el contrato es ambiguo, preguntá antes de cambiarlo.
Mostrame cómo lo comprobaste y cerrá con cerebro-cierre.`;

const PROMPT_SETUP = `Preparame el setup completo para una hackathon con este flujo:

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
retoma el contexto sin que se lo repita.`;

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: TITLE,
  description: DESCRIPTION,
  inLanguage: "es-AR",
  author: {
    "@type": "Person",
    name: "Juan Manuel Coro",
    sameAs: ["https://x.com/Jmcoroo", "https://www.linkedin.com/in/j-mcoro/"],
  },
  dateModified: "2026-09-29",
  about: ["Hackathons", "Spec-Driven Development", "Desarrollo de software con IA"],
};

export default function ComoGanarUnHackathon() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <header className="site-header">
        <span className="mono">JUAN MANUEL CORO / HACKATHON PLAYBOOK</span>
        <HeaderActions />
      </header>

      <section className="summary hero">
        <span className="hero-rail" aria-hidden="true">
          HACKATHON PLAYBOOK · 2026 · JMC
        </span>
        <small>CONCEPTOS Y HERRAMIENTAS</small>
        <h1>Cómo ganar un hackathon</h1>
        <div className="hero-split">
          <div>
            <p className="lede">
              Herramientas para dar vida a una idea en tiempos cortos.
            </p>
          </div>
          <div className="stage hero-stage">
            <BrainScene
              fallback={
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/fallbacks/brain-graph.svg"
                  alt="Grafo del cerebro compartido: notas y agentes conectados"
                />
              }
            />
          </div>
        </div>
        <div className="summary-grid">
          <article>
            <a href="#sdd">
              <small>01</small>
              <svg viewBox="0 0 100 70" aria-hidden="true">
                <g fill="none" stroke="#777" strokeWidth="1.5">
                  <path d="M10 10h25v48H10z M42 17h25v41H42z M74 24h18v34H74z" />
                  <path d="M35 34h7m25 0h7" />
                </g>
                <g fill="#181818">
                  <circle cx="22" cy="25" r="3" />
                  <circle cx="54" cy="31" r="3" />
                  <circle cx="83" cy="37" r="3" />
                </g>
              </svg>
              <h3>SDD</h3>
              <p>
                Spec funcional.
                <br />
                Spec técnica.
                <br />
                Plan de tareas.
              </p>
            </a>
          </article>
          <article>
            <a href="#brain">
              <small>02</small>
              <svg viewBox="0 0 100 70" aria-hidden="true">
                <g fill="none" stroke="#aaa">
                  <path d="M10 35L35 12 62 28 86 10M35 12L42 55 62 28 88 52M10 35L42 55 88 52M62 28L86 10 88 52" />
                </g>
                <g fill="#181818">
                  <circle cx="10" cy="35" r="4" />
                  <circle cx="35" cy="12" r="5" />
                  <circle cx="62" cy="28" r="5" />
                  <circle cx="86" cy="10" r="3" />
                  <circle cx="42" cy="55" r="3" />
                  <circle cx="88" cy="52" r="4" />
                </g>
              </svg>
              <h3>Cerebro compartido</h3>
              <p>
                Contexto común.
                <br />
                Leer antes.
                <br />
                Guardar al cerrar.
              </p>
            </a>
          </article>
          <article>
            <a href="#agents">
              <small>03</small>
              <svg viewBox="0 0 100 70" aria-hidden="true">
                <g fill="none" stroke="#777" strokeWidth="1.5">
                  <path d="M10 15h80v48H10z M24 28l12 9-12 9 M48 47h18" />
                </g>
              </svg>
              <h3>Devin / OpenCode</h3>
              <p>
                Tareas chicas.
                <br />
                Un agente, un objetivo.
                <br />
                Verificar el resultado.
              </p>
            </a>
          </article>
          <article>
            <a href="#vgpu">
              <small>04</small>
              <svg viewBox="0 0 100 70" aria-hidden="true">
                <g fill="none" stroke="#777" strokeWidth="1">
                  <ellipse cx="50" cy="35" rx="38" ry="25" />
                  <ellipse cx="50" cy="35" rx="23" ry="25" />
                  <ellipse cx="50" cy="35" rx="8" ry="25" />
                  <path d="M12 35h76M19 20h62M19 50h62" />
                </g>
              </svg>
              <h3>vgpu.sh</h3>
              <p>
                Gráficos con WebGPU.
                <br />
                Un recurso visual
                <br />
                que ayude a la demo.
              </p>
            </a>
          </article>
        </div>
        <p className="bridge">
          No hay truco. Hay preparación. Lincoln lo explicó antes que todos.
        </p>
        <blockquote className="axe">
          <p>
            «Dame seis horas para talar un árbol y pasaré las primeras cuatro
            afilando el hacha.»
          </p>
          <footer>ATRIBUIDA A ABRAHAM LINCOLN</footer>
        </blockquote>
        <div className="closing-line">
          Afilar el hacha es la spec y el cerebro compartido. Talar es codear.
          MVP acotado. Integración temprana. Demo ensayada.
        </div>
        <ExitProject />
      </section>

      <main className="wrap">
        <section className="chapter" id="sdd">
          <div className="two">
            <div>
              <small>01 / DEFINIR</small>
              <h2>SDD ¿Qué es? y por qué es importante</h2>
              <p className="intro">
                SDD o Spec-Driven Development: es una metodología que permite
                describir a detalle qué vamos a construir y usar ese documento
                para guiar la implementación y comprobar el resultado de la mano
                de agentes de IA.
              </p>
              <blockquote>
                Primero entendemos punta a punta qué queremos construir, después
                le damos vida con la IA.
              </blockquote>
              <p>
                Para una hackathon, usaría tres documentos cortos. El nivel de
                detalle tiene que alcanzar para que dos personas entiendan lo
                mismo y un agente pueda especificarlo.
              </p>
              <p>
                Básicamente, el proceso se divide en 3 pasos, uno con cada
                documento.
              </p>
              <p className="note">
                Esta separación es una adaptación práctica como recomendación.
                Hay skills como Spec Kit que reúnen el diseño técnico en el plan
                y luego generan las tareas.
              </p>
              <a
                href="https://github.github.com/spec-kit/quickstart.html"
                target="_blank"
                rel="noopener"
              >
                Ver GitHub Spec Kit ↗
              </a>
            </div>
            <div className="steps">
              <div className="step">
                <h3>Spec funcional</h3>
                <p>
                  <b>Qué y para quién.</b> Describe el usuario, el problema, el
                  flujo principal, alcance y criterios de aceptación.
                </p>
                <p className="label">
                  Ejemplo: un pasajero pide un viaje y ve el auto acercarse en
                  el mapa. La demo termina cuando puede compartir el link del
                  viaje en vivo.
                </p>
              </div>
              <div className="step">
                <h3>Spec técnica</h3>
                <p>
                  <b>Cómo lo hacemos.</b> Stack conocido, datos, APIs, contratos
                  y qué vamos a simular para la demo.
                </p>
                <p className="label">
                  Ejemplo: mapa en el front, endpoint del viaje y formato de
                  respuesta acordado. Los conductores son datos de muestra,
                  identificados como tales.
                </p>
              </div>
              <div className="step">
                <h3>Plan</h3>
                <p>
                  <b>Quién hace qué y en qué orden.</b> Tareas pequeñas,
                  responsables, dependencias y cómo validar cada entrega.
                </p>
                <p className="label">
                  Ejemplo: contrato del viaje primero, mapa y API en paralelo,
                  integrar y probar el link público del viaje.
                </p>
              </div>
            </div>
          </div>
          <details>
            <summary>Prompt para empezar</summary>
            <pre>{PROMPT_SDD}</pre>
            <CopyPrompt text={PROMPT_SDD} />
          </details>
        </section>

        <section className="chapter" id="brain">
          <div className="two">
            <div>
              <small>02 / COMPARTIR CONTEXTO</small>
              <h2>
                Tu equipo y sus IAs,
                <br />
                con la misma memoria
              </h2>
              <p className="intro">
                Cerebro Compartido es un plugin que guarda las decisiones y el
                trabajo del equipo en Markdown, dentro de un repo común.
                Básicamente, todas las computadoras e IAs del equipo leen y
                escriben en el mismo lugar.
              </p>
              <p>
                El repo se divide en dos: <code>team/</code> guarda la verdad
                compartida y <code>each_one/&lt;vos&gt;/</code> guarda el
                trabajo de cada persona o agente.
              </p>
              <blockquote>
                Pregunta real de una hackathon: “¿qué hizo Nano en la última
                media hora?” Con cerebro, la respuesta está en el repo — no en
                la memoria de nadie.
              </blockquote>
              <p>
                Lo usaría para retomar una tarea, encontrar una decisión y ver
                qué hizo otro sin volver a explicarle el proyecto a cada IA.
              </p>
            </div>
            <div className="steps">
              <div className="step">
                <h3>Instalar y configurar</h3>
                <p>
                  Instalá el plugin siguiendo el README. Decile al agente:{" "}
                  <code>corré cerebro-setup</code>. Configura el cerebro, el
                  equipo y la sincronización.
                </p>
              </div>
              <div className="step">
                <h3>Leer antes de trabajar</h3>
                <p>
                  Invocá <code>cerebro-leer</code> para traer el contexto
                  vigente, próximos pasos y bloqueos.
                </p>
              </div>
              <div className="step">
                <h3>Guardar al terminar</h3>
                <p>
                  Pedile: <code>cerrá esto con cerebro-cierre</code>. Guarda lo
                  que cambió y deja contexto para la siguiente tarea.
                </p>
              </div>
            </div>
          </div>
          <figure className="figure">
            <div className="stage stage-wide">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/fallbacks/brain-graph.svg"
                alt="Grafo de segundo cerebro: notas y agentes conectados"
              />
            </div>
            <figcaption>
              CINCO MÁQUINAS, UNA MEMORIA — EL GRAFO DE LA PORTADA, EN REPOSO.
            </figcaption>
          </figure>
          <div className="link-row">
            <a
              href="https://github.com/JMReader/cerebro-compartido"
              target="_blank"
              rel="noopener"
            >
              Plugin cerebro-compartido ↗
            </a>
            <a
              href="https://github.com/JMReader/shared-brain"
              target="_blank"
              rel="noopener"
            >
              Vault usado en Hack CBA ↗
            </a>
          </div>
          <p className="note">
            El vault de Hack CBA se sincronizó entre cinco computadoras. Las
            decisiones comunes necesitan mantenerse vigentes. No guardar
            secretos ni archivos .env.
          </p>
        </section>

        <section className="chapter" id="agents">
          <small>03 / EJECUTAR</small>
          <h2>Devin con SWE, u OpenCode</h2>
          <p className="intro">
            El agente no adivina: ejecuta lo que la spec define y el cerebro
            recuerda. Básicamente tu rol cambia — pasás de escribir código a
            definir tareas concretas y verificar lo que entrega.
          </p>
          <figure className="figure arena-figure">
            <div className="stage arena-stage">
              <ArenaScene
                fallback={
                  <div className="arena-fallback">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/fallbacks/devin-mark.svg"
                      alt="La marca de Devin"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/fallbacks/opencode-mark.svg"
                      alt="La O del logo de OpenCode"
                    />
                  </div>
                }
              />
            </div>
            <figcaption>
              DEVIN Y LA «O» DE OPENCODE, EN LA MISMA ARENA — AGARRÁLAS Y
              TIRÁLAS.
            </figcaption>
          </figure>
          <div className="two">
            <div>
              <h3>Devin + modelos SWE</h3>
              <p>
                Devin puede escribir, ejecutar y probar código solo. SWE es la
                familia de modelos de Cognition: el agente y el modelo cumplen
                roles distintos.
              </p>
              <p>
                Para la hackathon le daría una tarea delimitada, el contrato de
                entrada/salida y una comprobación concreta. Lo que entrega se
                revisa igual que el trabajo de cualquier compañero: antes de
                integrarlo.
              </p>
              <p>
                <b>Hablá con Erasmo Hernández</b> para consultar demos, acceso o
                actividades de comunidad de Cognition. Créditos o beneficios
                dependen de lo que esté disponible.
              </p>
              <div className="link-row">
                <a href="https://docs.devin.ai/" target="_blank" rel="noopener">
                  Devin ↗
                </a>
                <a
                  href="https://www.linkedin.com/in/erasmohernandez/"
                  target="_blank"
                  rel="noopener"
                >
                  Erasmo ↗
                </a>
              </div>
              <div className="stage otter-stage">
                <OtterScene
                  fallback={
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src="/fallbacks/otter.svg"
                      alt="La nutria, mascota de Devin"
                    />
                  }
                />
              </div>
            </div>
            <div>
              <h3>OpenCode, controlando el gasto</h3>
              <p>
                OpenCode es un agente open source que corre en la terminal, el
                IDE o el escritorio. Permite usar modelos gratuitos disponibles
                o conectar un proveedor.
              </p>
              <p>
                Es una opción barata si elegís bien el modelo y acotás las
                tareas — que el software sea abierto no hace gratis a las APIs.
              </p>
              <p>
                Usaría un modelo barato para cambios simples y uno más capaz
                cuando el problema lo pide. La métrica que importa: cuánto
                gastás por tarea terminada.
              </p>
              <div className="link-row">
                <a href="https://opencode.ai/" target="_blank" rel="noopener">
                  OpenCode ↗
                </a>
                <a
                  href="https://devin.ai/pricing"
                  target="_blank"
                  rel="noopener"
                >
                  Planes de Devin ↗
                </a>
              </div>
            </div>
          </div>
          <details>
            <summary>Prompt para delegar una tarea</summary>
            <pre>{PROMPT_DELEGATE}</pre>
            <CopyPrompt text={PROMPT_DELEGATE} />
          </details>
          <p className="note">
            La disponibilidad de modelos SWE y las cuotas dependen del producto
            y del plan vigente. No se asume una promoción ni uso ilimitado.
          </p>
        </section>

        <section className="chapter" id="vgpu">
          <div className="two">
            <div>
              <small>04 / HACER VISIBLE LA IDEA</small>
              <h2>vgpu.sh</h2>
              <p className="intro">
                vgpu es una biblioteca de TypeScript para hacer gráficos con
                WebGPU — shaders, efectos y visualizaciones aceleradas por GPU.
                Viene con documentación y ejemplos pensados también para
                agentes.
              </p>
              <p>
                Sirve para construir visuales en el navegador, y también corre
                en Node para hacer pruebas headless.
              </p>
              <blockquote>
                Si el jurado entiende el producto en diez segundos, los otros
                cincuenta son tuyos.
              </blockquote>
              <p>
                Esta página es su propia demo: el cerebro de la portada, la
                nutria de Devin y la O de OpenCode están hechos con vgpu y se
                renderizan en tu navegador, ahora.
              </p>
              <div className="link-row">
                <a href="https://vgpu.sh" target="_blank" rel="noopener">
                  Documentación y ejemplos ↗
                </a>
                <a
                  href="https://github.com/vercel-labs/vgpu"
                  target="_blank"
                  rel="noopener"
                >
                  Repositorio ↗
                </a>
              </div>
            </div>
            <div>
              <h3>Cómo lo usaría en una hackathon</h3>
              <ol>
                <li>
                  Buscaría en los ejemplos algo que ayude a explicar el
                  problema.
                </li>
                <li>Partiría de ese ejemplo, no de cero.</li>
                <li>
                  Le daría al agente la documentación y el objetivo visual.
                </li>
                <li>
                  Lo probaría en la máquina y el navegador de la demo, con una
                  alternativa estática.
                </li>
              </ol>
              <pre>{`npx vgpu docs
npx vgpu examples search "raymarching"
npx vgpu check`}</pre>
              <p className="note">
                Ejemplo de uso propuesto: mostrar un terreno o un fenómeno
                visual. No reemplaza el flujo funcional ni es un servicio de
                alquiler de GPU.
              </p>
            </div>
          </div>
        </section>

        <section className="chapter" id="extra">
          <small>05 / TEMAS QUE SUMARÍA</small>
          <h2>La demo también se construye</h2>
          <p className="intro">
            Básicamente: el código es la mitad del trabajo. La otra mitad es
            recorrido, integración y pitch — y también se construye.
          </p>
          <div className="extras">
            <article>
              <h3>MVP y criterio del jurado</h3>
              <p>
                Elegir un usuario, un problema y un recorrido completo. Revisar
                qué evalúa el track y decidir qué queda afuera.
              </p>
            </article>
            <article>
              <h3>Integrar desde temprano</h3>
              <p>
                Acordar contratos entre front y back. Tener una versión
                desplegada que todos puedan abrir antes del sprint final.
              </p>
            </article>
            <article>
              <h3>Pitch y plan B</h3>
              <p>
                Ensayar problema, solución y demo. Tener datos listos y una
                grabación de respaldo. Si algo es simulado, decirlo.
              </p>
            </article>
          </div>
          <div className="darkband">
            <h3>Nada está listo hasta que se puede mostrar.</h3>
            <p>El agente termina. El equipo verifica. La demo convence.</p>
          </div>
        </section>

        <section className="chapter" id="setup">
          <small>06 / PARA EMPEZAR</small>
          <h2>Un prompt para dejar todo listo</h2>
          <p className="intro">
            Básicamente: si arrancás una hackathon mañana, pegá esto en tu
            agente y tenés el flujo completo — cerebro, spec, plan y visuales.
          </p>
          <div className="setup-prompt">
            <pre>{PROMPT_SETUP}</pre>
            <CopyPrompt text={PROMPT_SETUP} />
          </div>
          <p className="note">
            Ajustalo al proyecto concreto antes de mandarlo. Un agente con
            contexto equivocado prepara muy bien el proyecto equivocado.
          </p>
        </section>

        <section className="chapter">
          <p className="closing">
            El jurado ve la demo. No ve la spec que la hizo posible, ni el
            cerebro que la mantuvo en pie. Afilá antes, talá después — y si este
            flujo te sirve, pasáselo a tu equipo. Es la misma preparación con la
            que gané Hack CBA.
          </p>
        </section>

        <section className="chapter sources">
          <h2>Fuentes y recursos</h2>
          <p>
            Consultados el 29 de septiembre de 2026. Los consejos de hackathon
            son una propuesta práctica; las capacidades se basan en la
            documentación enlazada.
          </p>
          <ul>
            <li>
              <a href="https://github.github.com/spec-kit/quickstart.html">
                GitHub Spec Kit: especificación, diseño técnico y tareas
              </a>
            </li>
            <li>
              <a href="https://github.com/JMReader/cerebro-compartido">
                Cerebro Compartido: README y uso de las tres skills
              </a>
            </li>
            <li>
              <a href="https://github.com/JMReader/shared-brain">
                SharedBrain: estructura del vault
              </a>
            </li>
            <li>
              <a href="https://github.com/vercel-labs/vgpu">
                Vercel Labs vgpu: README oficial
              </a>
            </li>
            <li>
              <a href="https://docs.devin.ai/get-started/devin-intro">
                Cognition: capacidades y buenas instrucciones para Devin
              </a>
            </li>
            <li>
              <a href="https://cognition.com/blog/new-self-serve-plans-for-devin">
                Cognition: planes y cuotas
              </a>
            </li>
            <li>
              <a href="https://opencode.ai/">
                OpenCode: modelos y opciones de uso
              </a>
            </li>
            <li>
              <a href="https://luma.com/ita42zws">
                Devin Buenos Aires Meetup: demo con Erasmo Hernández
              </a>
            </li>
          </ul>
        </section>

        <footer className="footer">
          <span>Juan Manuel Coro · Material para compartir</span>
          <span>
            <a href="https://x.com/Jmcoroo">X @Jmcoroo</a> &nbsp;{" "}
            <a href="https://www.linkedin.com/in/j-mcoro/">LinkedIn</a>
          </span>
        </footer>
      </main>
    </>
  );
}

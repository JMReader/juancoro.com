# juancoro.com

Blog personal de Juan Manuel Coro. Next.js + TypeScript, desplegado en Vercel.

- `/` y `/blog` redirigen al único post publicado por ahora.
- Los gráficos 3D del post (cerebro compartido, marca de Devin, O de OpenCode)
  están renderizados en el navegador con [vgpu](https://vgpu.sh) (WebGPU) y son
  interactivos: arrastrar rota la escena con inercia y el hover hace parallax.
  Con `prefers-reduced-motion` o sin WebGPU se muestra un SVG estático.
- El contenido del post se edita en `content/como-ganar-un-hackathon.md`
  (fuente de verdad; el JSX se sincroniza desde ahí).

## Desarrollo

```sh
npm install
npm run dev
```

Los componentes vgpu viven en `app/components/visuals/*/`. Los shaders WGSL van
inline en `scene.ts`; cada componente tiene un script headless en
`scripts/render-*.ts` que compila los shaders contra el GPU real y renderiza
PNGs de prueba con Node:

```sh
npx tsx scripts/render-brain.ts
npx tsx scripts/render-devin.ts
npx tsx scripts/render-opencode.ts
```

`npm exec --no -- vgpu doctor` verifica el entorno WebGPU.

## Deploy

- Repo: [JMReader/juancoro.com](https://github.com/JMReader/juancoro.com) (rama `main`).
- Proyecto Vercel: `juancoro-com` — conectado al repo, cada push a `main`
  despliega a producción. URL de producción: `https://juancoro-com.vercel.app`.
- Dominios configurados en el proyecto: `juancoro.com` (apex) y
  `www.juancoro.com` (redirect 308 al apex).

**Pendiente — DNS en el registrar (Donweb):** apuntar el dominio a Vercel con
una de estas dos opciones:

1. Registros en Donweb (recomendada): A `@` → `76.76.21.21` y CNAME `www` →
   `cname.vercel-dns.com`.
2. O delegar los nameservers a `ns1.vercel-dns.com` / `ns2.vercel-dns.com`.

Cuando el DNS propague, Vercel emite el certificado automáticamente.

# juancoro.com

Blog personal de Juan Manuel Coro. Next.js + TypeScript, desplegado en Vercel.

- `/` y `/blog` redirigen al único post publicado por ahora.
- Los gráficos 3D del post (cerebro compartido, marca de Devin, O de OpenCode)
  están renderizados en el navegador con [vgpu](https://vgpu.sh) (WebGPU),
  con fallback a SVG cuando WebGPU no está disponible.

## Desarrollo

```sh
npm install
npm run dev
```

Los componentes vgpu viven en `app/components/visuals/*/`. Cada uno tiene un
script headless en `scripts/render-*.ts` que renderiza PNGs de prueba con Node:

```sh
npx tsx scripts/render-brain.ts
npx tsx scripts/render-devin.ts
npx tsx scripts/render-opencode.ts
```

Validación de shaders: `npm exec --no -- vgpu check <archivo.wgsl> --require-validation`
y `npm exec --no -- vgpu doctor` para verificar el entorno WebGPU.

## Deploy

Vercel (importar el repo `JMReader/juancoro.com`). El dominio `juancoro.com`
apunta al deployment; DNS configurado en el registrar según las instrucciones
de Vercel (A `76.76.21.21` para el apex, CNAME `www` a `cname.vercel-dns.com`).

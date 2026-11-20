import { wgslVitePlugin } from 'vgpu/client';
export default {
  plugins: [wgslVitePlugin({ minify: true })],
  build: { rollupOptions: { input: 'koi-3d.html' }, outDir: 'dist-koi' },
};

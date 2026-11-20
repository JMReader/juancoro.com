import { wgslVitePlugin } from 'vgpu/client';

export default {
  plugins: [wgslVitePlugin({ minify: true })],
};

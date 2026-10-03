import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 相对路径：构建产物可放在任意目录、通过本地服务直接打开
  base: './',
  server: { port: 5173, open: true },
  build: {
    outDir: 'dist',
    // wasm 体积较大，单独分块便于缓存
    rollupOptions: {
      output: {
        manualChunks: { sqlite: ['sql.js'] }
      }
    }
  }
});

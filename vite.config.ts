import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Vite 配置:Tauri + React + HMR
// - server.port 1420 是 Tauri 约定的开发端口
// - envPrefix 包含 TAURI_ENV_ 前缀变量
// - build.target 适配三平台 WebView(Chrome 100 / Safari 13)
// - Tailwind v4 通过 @tailwindcss/vite 插件接入,CSS 内 @import "tailwindcss" 即可
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 避免 Vite 监听 Rust 编译产物(target 目录中的 dll 在链接时会被锁定,导致 EBUSY 崩溃)
      ignored: ['**/target/**', '**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});

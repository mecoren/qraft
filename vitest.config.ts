import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// 与 vite.config.ts 保持一致:应用版本唯一数据源 = package.json 的 version 字段,
// 经 define 注入 __APP_VERSION__,保证测试环境与构建产物行为一致。
const appVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))
  .version as string;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

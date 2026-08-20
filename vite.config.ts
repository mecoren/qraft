import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// 应用版本唯一数据源 = package.json 的 version 字段。
// 通过 define 注入全局常量 __APP_VERSION__,前端不再硬编码版本号;
// 发版时统一使用 scripts/bump-version.sh 升级(package.json 为源,同步
// src-tauri/Cargo.toml 与 src-tauri/tauri.conf.json)。
const appVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))
  .version as string;

// Vite 配置:Tauri + React + HMR
// - server.port 1420 是 Tauri 约定的开发端口
// - envPrefix 包含 TAURI_ENV_ 前缀变量
  // - build.target 适配三平台 WebView(Chrome 100 / Safari 14)
  //   注:Safari 14 起支持 BigInt,进制转换器等工具依赖 BigInt 做任意精度运算,故不低于 14
// - Tailwind v4 通过 @tailwindcss/vite 插件接入,CSS 内 @import "tailwindcss" 即可
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
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
    // Vite 8 使用 rolldown + esbuild 转译,esbuild 尚不支持把解构等现代语法
    // 降级到过低的 target(会报 "Transforming destructuring ... is not supported yet")。
    // 因此 target 不能低于 es2022:现代 WebView(Windows WebView2 / macOS WKWebView /
    // Linux webkit2gtk-4.1)均支持 es2022,足以运行全部用到的语法(BigInt、可选链等)。
    target: ['es2022', 'chrome120', 'safari16'],
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // 依赖分包:把体积大/变更频率低的第三方库单独成 chunk,
    // 提升浏览器/WebView 缓存命中率,避免任意工具改动都让用户重新下载整个 vendor。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Monaco 编辑器体积极大,单独隔离,且只有用到编辑器的工具才会加载其分包
          if (id.includes('monaco-editor')) return 'monaco';
          // 其余第三方库按顶层包名聚合为 vendor,降低首屏 chunk 数量
          if (id.includes('@tauri-apps')) return 'tauri';
          const parts = id.split('node_modules/');
          const last = parts[parts.length - 1];
          const match = last.split('/')[0];
          if (match.startsWith('@')) {
            // 作用域包(@xxx/yyy)取两级
            const scoped = last.split('/').slice(0, 2).join('/');
            return `vendor-${scoped}`;
          }
          return `vendor-${match}`;
        },
      },
    },
  },
});

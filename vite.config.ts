import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { cpSync, existsSync, readFileSync } from 'node:fs';

// 应用版本唯一数据源 = package.json 的 version 字段。
// 通过 define 注入全局常量 __APP_VERSION__,前端不再硬编码版本号;
// 发版时统一使用 scripts/bump-version.sh 升级(package.json 为源,同步
// src-tauri/Cargo.toml 与 src-tauri/tauri.conf.json)。
const appVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))
  .version as string;

// PDF 工具运行时资源(由 scripts/copy-pdf-assets.mjs 同步进 src/tools/pdf/assets/pdf):
// pdfjs 的 standard_fonts(标准 14 字体替代)与 cmaps(CJK 映射表)是按路径
// 动态加载的资源,不经 import 图 —— Vite 不会打包。这里用 closeBundle 钩子
// 整目录拷进产物,运行时以 import.meta.url 相对寻址(与 pdfRender.ts 的
// URL 拼法对齐:dist/assets/pdf/standard_fonts/…)。
function copyPdfRuntimeAssets() {
  return {
    name: 'copy-pdf-runtime-assets',
    closeBundle() {
      const src = path.resolve(__dirname, 'src/tools/pdf/assets/pdf');
      const dest = path.resolve(__dirname, 'dist/assets/pdf');
      if (!existsSync(src)) {
        throw new Error(
          `[copy-pdf-runtime-assets] 缺少 ${src}:请先运行 pnpm copy:pdf 同步 pdfjs 资源`,
        );
      }
      cpSync(src, dest, { recursive: true });
    },
  };
}

// Vite 配置:Tauri + React + HMR
// - server.port 14200:Tauri 约定的 1420 落在 Windows Hyper-V/winnat 的
//   保留端口区间内(本机实测排除 1330-1429,listen 报 EACCES),故改用 14200;
//   需与 src-tauri/tauri.conf.json 的 devUrl / devCsp 保持一致
// - envPrefix 包含 TAURI_ENV_ 前缀变量
  // - build.target 适配三平台 WebView(Chrome 100 / Safari 14)
  //   注:Safari 14 起支持 BigInt,进制转换器等工具依赖 BigInt 做任意精度运算,故不低于 14
// - Tailwind v4 通过 @tailwindcss/vite 插件接入,CSS 内 @import "tailwindcss" 即可
export default defineConfig({
  plugins: [react(), tailwindcss(), copyPdfRuntimeAssets()],
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
    port: 14200,
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
    // 使用 rolldown 原生 advancedChunks(而非 manualChunks):
    // Vite 的虚拟模块 vite/preload-helper 不受 manualChunks 管辖,会被 rolldown
    // 放进「第一个被共享的大依赖」chunk —— 实测曾落入 mermaid 分包,导致入口为拿到
    // 该辅助函数而静态加载整个 686KB 的 @mermaid-js/parser。这里用最高优先级组把它
    // 钉进独立的 runtime 小 chunk,入口只静态依赖 ~1KB 的 runtime。
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'runtime', test: /vite[\\/]preload-helper/, priority: 300 },
            // tslib 被 radix 系(首屏侧边栏右键菜单)与 @peculiar 系(证书工具,懒加载)
            // 共同依赖;不显式钉出时 rolldown 会把它并进 asn1-cms 分包,导致入口为拿
            // tslib 而静态加载 ~113KB 的证书 ASN.1 解析器。高优先级组强制其独立成小包。
            { name: 'vendor-tslib', test: /[\\/]tslib[\\/]/, priority: 150 },
            // @monaco-editor/(loader|react) 仅编辑器类工具(懒加载 chunk)使用。
            // 注意不能用 id.includes('monaco-editor') 这类宽泛匹配:pnpm 的
            // .pnpm/@monaco-editor+react@… 目录名同样含该子串,且实测 rolldown 会把
            // 入口必需的 react 本体寄存进该组 chunk,入口为拿 react 又得静态加载它。
            // 显式钉出后,包装层(~22KB)只在打开编辑器工具时才随懒 chunk 加载。
            { name: 'vendor-@monaco-editor', test: /[\\/]@monaco-editor[\\/]/, priority: 150 },
            // 同理显式钉出 react 本体,避免被寄存进某个懒加载分包导致入口静态依赖它
            { name: 'vendor-react', test: /[\\/]node_modules[\\/]react[\\/]/, priority: 160 },
            {
              name(id) {
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
              test: /node_modules/,
            },
          ],
        },
      },
    },
  },
});

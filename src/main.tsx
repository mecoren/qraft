import 'reflect-metadata';
import { createRoot } from 'react-dom/client';
import monacoLoader from '@monaco-editor/loader';
import { App } from './App';
import { initThemeOnStartup, initFontSettingsOnStartup } from './lib/theme';
import { applyPlatformClass } from './lib/platform';
import './styles/globals.css';

// Monaco 加载策略 —— 走项目内置资源,不联网。
// 默认 loader 会从 https://cdn.jsdelivr.net 拉 monaco-editor,但生产 CSP
// script-src 'self' 会拦掉跨域脚本,WebView2 里编辑器就出不来。
// dev 模式 Tauri 不注入 devCsp 所以看不出问题,prod 才会爆。
// 这里 指向 scripts/copy-monaco.mjs 同步到 public/monaco/vs 的目录,
// 配合 CSP 的 worker-src 'self' blob: 让 Monaco 内的 worker 也能起。
// 必须在任何 <Editor /> 挂载之前调用 —— 放到 main.tsx 顶层 import 阶段即可。
monacoLoader.config({
  paths: {
    vs: `${import.meta.env.BASE_URL}monaco/vs`,
  },
});

// 应用启动:在 React 渲染前应用主题与字体设置,避免 FOUC(闪烁)
// - initThemeOnStartup: 读取 localStorage 的 theme_mode/color_palette,
//   设置 <html data-palette="..."> 和 .dark 类
// - initFontSettingsOnStartup: 应用字体族/字号/字重,通过 CSS 变量注入
// - applyPlatformClass: 在 <html> 添加 .platform-{win|mac|linux},
//   激活自定义标题栏与 Linux CSS 模糊回退的平台规则
initThemeOnStartup();
initFontSettingsOnStartup();
applyPlatformClass();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(<App />);

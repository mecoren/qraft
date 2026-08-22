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
  // 中文本地化说明(「先 import nls.messages.zh-cn 再加载 monaco」同源):
  // - zh-cn.js 是纯脚本,由 index.html 在 <head> 里经典 <script> 静态引入,
  //   严格早于本入口执行,已把 globalThis._VSCODE_NLS_MESSAGES 设为中文消息表;
  //   Monaco 的 localize() 每次调用时懒读该全局,查找栏/折叠提示等内置 UI 即为中文。
  // - 这里故意不配置 'vs/nls'.availableLanguages:该配置会让 vs/nls.messages-loader
  //   插件 AMD-require zh-cn.js,但纯脚本无 define() 注册、回调永不触发,
  //   editor.main 将永久挂起(编辑器空白),是已踩过的坑,勿回退。
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

// 生产构建禁用 WebView2 默认右键菜单(返回/刷新/另存为/打印/检查等浏览器项):
// - 仅 Tauri 运行时 + PROD 生效;dev 保留默认菜单便于调试。
// - 应用内自定义右键菜单(Monaco 中文菜单 / Tab·列表 Radix 菜单 / TextCompare
//   的原生样式化菜单)均自行监听 contextmenu 且自绘 UI,preventDefault 只
//   拦截浏览器默认菜单、不阻断事件传播,互不影响。
if (import.meta.env.PROD && '__TAURI_INTERNALS__' in window) {
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(<App />);

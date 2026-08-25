import 'reflect-metadata';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initThemeOnStartup, initFontSettingsOnStartup } from './lib/theme';
import { applyPlatformClass } from './lib/platform';
import './styles/globals.css';

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

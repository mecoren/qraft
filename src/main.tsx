import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PopoutApp } from './PopoutApp';
import { POPOUT_QUERY_KEY } from '@/lib/popout-window';
import { initThemeOnStartup, initFontSettingsOnStartup } from './lib/theme';
import { applyPlatformClass } from './lib/platform';
import { scheduleIdlePrefetch } from './lib/idle-prefetch';
// i18n 实例在模块导入时初始化(默认 zh-CN);
// general.language 的启动同步由 configStore hydrate 后执行(见 store 层)。
import '@/i18n';
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

// 启动分支:URL 携带 ?popout=<toolId> 时渲染弹窗壳(PopoutApp 内部校验 toolId,
// 非法值显示「未找到工具」),否则渲染完整主窗口应用。
// 两条路径共用上方的主题/字体/平台类初始化。
const popoutToolId = new URLSearchParams(window.location.search).get(POPOUT_QUERY_KEY);

createRoot(rootEl).render(
  popoutToolId ? <PopoutApp toolId={popoutToolId} /> : <App />,
);

// 空闲预取重型懒加载链(Markdown 工具 → mermaid/katex/worker),
// 消除首次进入该工具时的磁盘读取尖峰;dev 与冷启动零影响。
// 弹窗窗口按需加载自身工具即可,不参与主窗口的预取。
if (!popoutToolId) {
  scheduleIdlePrefetch({
    dev: import.meta.env.DEV,
    loaders: [() => import('./tools/MarkdownPreview')],
  });
}

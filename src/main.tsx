import 'reflect-metadata';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import {
  initThemeOnStartup,
  initFontSettingsOnStartup,
} from './lib/theme';
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

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(<App />);

/**
 * 应用国际化核心:i18next 实例 + 非组件层可用的 t()。
 *
 * 设计要点:
 * - 资源静态打包(两语言合计 <30KB gz),无需懒加载;
 * - fallbackLng 恒为 zh-CN:en 缺失键回退中文,迁移期永不白屏;
 * - 键缺失时返回键名(parseMissingKeyHandler),让遗漏在 UI 上自暴露而非抛错;
 * - locale 的持久化走既有 general.language 配置管道(configStore,见 store 层)。
 */
import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

export type Locale = 'zh-CN' | 'en-US';

export const FALLBACK_LOCALE: Locale = 'zh-CN';

let currentLocale: Locale = FALLBACK_LOCALE;

const instance: I18n = i18next.createInstance();

// 注册 react-i18next:useTranslation 在未包 Provider 的场景(如直接渲染组件的
// 单测)也能命中全局实例,避免 90+ 组件测试各自包 Provider
void instance.use(initReactI18next).init({
  lng: currentLocale,
  fallbackLng: FALLBACK_LOCALE,
  defaultNS: 'translation',
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  interpolation: { escapeValue: false },
  parseMissingKeyHandler: (key) => key,
});

/** 非组件层(store / lib / 工具函数)使用的翻译函数 */
export function t(key: string, options?: Record<string, unknown>): string {
  return instance.t(key, options ?? {}) as string;
}

/** 当前语言 */
export function getLocale(): Locale {
  return currentLocale;
}

/** 切换语言(幂等);调用方负责持久化到 configStore */
export function changeLocale(locale: Locale): void {
  currentLocale = locale;
  void instance.changeLanguage(locale);
}

/** 供 React 层把 i18next 实例接入 react-i18next(I18nextProvider) */
export function getI18nInstance(): I18n {
  return instance;
}

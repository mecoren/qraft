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

// 工具级文案片段(locales/tools/<tool_id>.{zh,en}.json,扁平全前缀键):
// 并行迁移各工具时只新增自己的片段文件、不改主 locale;构建期在此聚合,
// 展开为嵌套对象后深合并进主资源(键冲突以片段为准)。
const toolFragments = import.meta.glob('./locales/tools/*.json', {
  eager: true,
}) as Record<string, { default: Record<string, string> }>;

/** {"a.b.c": "v"} → { a: { b: { c: "v" } } }(i18next 以 . 为键分隔符) */
function expandFlatKeys(flat: Record<string, string>): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let cursor = nested;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        cursor[part] = value;
        return;
      }
      if (typeof cursor[part] !== 'object' || cursor[part] === null) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    });
  }
  return nested;
}

/** 深合并 source 进 target(片段场景仅涉及对象与字符串值) */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof existing === 'object' &&
      existing !== null
    ) {
      deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

/** 聚合对应语言的工具片段(zh→zh-CN,en→en-US;其余后缀忽略) */
function mergeToolFragments(base: Record<string, unknown>, suffix: 'zh' | 'en'): void {
  for (const [file, mod] of Object.entries(toolFragments)) {
    if (!file.endsWith(`.${suffix}.json`)) continue;
    deepMerge(base, expandFlatKeys(mod.default));
  }
}

mergeToolFragments(zhCN as Record<string, unknown>, 'zh');
mergeToolFragments(enUS as Record<string, unknown>, 'en');

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

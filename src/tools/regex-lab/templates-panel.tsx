/**
 * Regex Lab 子面板:常用模板库(Templates)
 *
 * 收录日常高频的整条正则(URL / 邮箱 / 日期 / 数字 / 代码注释等,数据源
 * regex-templates.json,与 Rust 集成测试共读守卫引擎兼容性)。点击模板
 * 把 pattern + flags + 样本文本一并写入工作区,用户即刻看到实时命中效果
 * 后再按需改写;「只填正则」按钮保留现有测试文本,仅替换 pattern/flags。
 *
 * 交互与 QuickReferencePanel 同构:分类折叠 + 关键词过滤(按解析后的
 * 说明 + pattern 匹配)。
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, LayoutTemplate } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import templateData from '@/lib/regex-templates.json';

export interface RegexTemplateItem {
  pattern: string;
  flags: string;
  tplKey: string;
  sample: string;
}

export interface RegexTemplateCategoryData {
  id: string;
  templates: RegexTemplateItem[];
}

/** JSON 单一数据源(Rust 集成测试 include_str! 同一文件,双侧同步守卫) */
export const REGEX_TEMPLATES = templateData.categories as RegexTemplateCategoryData[];

/** 拉丁/中文大小写无关过滤(按解析后的说明 + pattern 匹配) */
function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function TemplatesPanel({
  onApply,
}: {
  /** 点击模板时回调(整条应用:pattern + flags + 样本文本) */
  onApply: (tpl: RegexTemplateItem) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleCategory = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return REGEX_TEMPLATES;
    return REGEX_TEMPLATES.map((cat) => ({
      ...cat,
      templates: cat.templates.filter(
        (tpl) =>
          matches(tpl.pattern, q) ||
          matches(t(`tools.regex_tester.tpl_${tpl.tplKey}`), q) ||
          matches(t(`tools.regex_tester.tplcat_${cat.id}`), q),
      ),
    })).filter((cat) => cat.templates.length > 0);
  }, [query, t]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="regex-templates">
      <div className="flex h-[26px] items-center gap-1.5 border-b border-input px-2">
        <LayoutTemplate aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">{t('tools.regex_tester.templates_title')}</span>
      </div>
      <div className="border-b border-border p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('tools.regex_tester.templates_search')}
          className="h-7 text-xs"
          data-testid="templates-search"
          aria-label={t('tools.regex_tester.templates_search')}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {t('tools.regex_tester.templates_empty')}
            </p>
          ) : (
            filtered.map((cat) => {
              const isCollapsed = collapsed.has(cat.id) && !query.trim();
              return (
                <section key={cat.id} className="mb-3">
                  <h3 className="mb-1 px-1">
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => toggleCategory(cat.id)}
                      aria-expanded={!isCollapsed}
                      data-testid={`tpl-category-${cat.id}`}
                    >
                      {isCollapsed ? (
                        <ChevronRight aria-hidden className="size-3" />
                      ) : (
                        <ChevronDown aria-hidden className="size-3" />
                      )}
                      {t(`tools.regex_tester.tplcat_${cat.id}`)}
                    </button>
                  </h3>
                  {!isCollapsed && (
                    <ul className="space-y-0.5">
                      {cat.templates.map((tpl) => {
                        const desc = t(`tools.regex_tester.tpl_${tpl.tplKey}`);
                        return (
                          <li key={tpl.tplKey}>
                            <button
                              type="button"
                              className="flex w-full flex-col gap-0.5 rounded px-1 py-1 text-left transition-colors hover:bg-accent"
                              onClick={() => onApply(tpl)}
                              data-testid={`tpl-apply-${tpl.tplKey}`}
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                                  /{tpl.pattern}/{tpl.flags}
                                </span>
                              </span>
                              <span
                                className={cn(
                                  'text-xs leading-snug text-muted-foreground',
                                  desc.startsWith('tools.regex_tester.') && 'text-destructive',
                                )}
                              >
                                {desc}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

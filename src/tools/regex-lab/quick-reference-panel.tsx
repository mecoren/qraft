/**
 * Regex Lab 子面板:快速参考(Quick Reference)
 *
 * regex101 右侧面板:分类浏览 + 关键词过滤;点击 token 插入 pattern 光标处。
 * 分类标题与 token 说明均走 i18n(键:tools.regex_tester.ref_<id> / qr_<key>)。
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { QUICK_REFERENCE } from './quick-reference';

/** 拉丁/中文大小写与空白无关过滤(按解析后的说明 + 语法匹配) */
function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function QuickReferencePanel({
  onInsert,
}: {
  /** 点击 token 时回调(插入 pattern 的 token 文本 + 光标偏移) */
  onInsert: (token: string, cursorOffset: number) => void;
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
    if (!q) return QUICK_REFERENCE;
    return QUICK_REFERENCE.map((cat) => ({
      ...cat,
      tokens: cat.tokens.filter(
        (tk) => matches(tk.syntax, q) || matches(t(`tools.regex_tester.qr_${tk.qrKey}`), q),
      ),
    })).filter((cat) => cat.tokens.length > 0);
  }, [query, t]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="quick-reference">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <BookOpen aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">{t('tools.regex_tester.quick_reference')}</span>
      </div>
      <div className="border-b border-border p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('tools.regex_tester.quick_reference_search')}
          className="h-7 text-xs"
          data-testid="quick-reference-search"
          aria-label={t('tools.regex_tester.quick_reference_search')}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {t('tools.regex_tester.quick_reference_empty')}
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
                      data-testid={`ref-category-${cat.id}`}
                    >
                      {isCollapsed ? (
                        <ChevronRight aria-hidden className="size-3" />
                      ) : (
                        <ChevronDown aria-hidden className="size-3" />
                      )}
                      {t(`tools.regex_tester.ref_${cat.id}`)}
                    </button>
                  </h3>
                  {!isCollapsed && (
                    <ul className="space-y-0.5">
                      {cat.tokens.map((tk) => {
                        const desc = t(`tools.regex_tester.qr_${tk.qrKey}`);
                        return (
                          <li key={tk.syntax}>
                            <button
                              type="button"
                              className="flex w-full flex-col rounded px-1 py-1 text-left transition-colors hover:bg-accent"
                              onClick={() =>
                                onInsert(tk.syntax, tk.cursorOffset ?? tk.syntax.length)
                              }
                              title={desc}
                            >
                              <code className="font-mono text-xs text-foreground">{tk.syntax}</code>
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

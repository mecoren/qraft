/**
 * 语言模式选择器 —— 仿 VSCode 右下角「选择语言模式」对话框
 *
 * 点击状态栏语言徽章打开,列出全部支持的语言;当前语言高亮并打勾。
 * 每项带语言图标(Material Icon Theme,与文件图标主题同源)。
 * 顶部提供搜索框(按名称/标识过滤),选择后即时应用到激活 Tab 并关闭。
 */
import { useMemo, useState, type JSX } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { EditorLanguage } from '@/components/ui/code-editor';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QUICK_LANGUAGES } from './languageMap';
import { LanguageIcon } from './languageIcons';

export interface EditorLanguagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLanguage: EditorLanguage;
  onSelect: (language: EditorLanguage) => void;
  /** 测试定位用 */
  'data-testid'?: string;
}

export function EditorLanguagePicker({
  open,
  onOpenChange,
  currentLanguage,
  onSelect,
  'data-testid': dataTestId,
}: EditorLanguagePickerProps): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // 按关键词过滤(label / id 不区分大小写包含匹配);打开时重置搜索词由 open 驱动的 key 实现
  // plaintext 的显示名走 i18n(其余语言名两种语言一致,直接用静态 label)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return QUICK_LANGUAGES;
    return QUICK_LANGUAGES.filter((lang) => {
      if (lang.id.toLowerCase().includes(q)) return true;
      if (lang.label.toLowerCase().includes(q)) return true;
      return (
        lang.id === 'plaintext' && t('tools.text_editor.lang_plaintext').toLowerCase().includes(q)
      );
    });
  }, [query, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setQuery('');
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid={dataTestId} className="max-w-sm gap-0 p-0" hideCloseButton>
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm font-semibold">
            {t('tools.text_editor.select_language_mode')}
          </DialogTitle>
        </DialogHeader>
        {/* 搜索框(仿 VSCode Quick Pick 过滤输入) */}
        <div className="border-b border-border px-3 py-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('tools.text_editor.picker_search_placeholder')}
            data-testid={`${dataTestId}-search`}
            className="h-8 text-xs"
          />
        </div>
        <ScrollArea className="max-h-80">
          <div className="flex flex-col p-1.5" data-testid={`${dataTestId}-list`}>
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t('tools.text_editor.picker_empty')}
              </div>
            ) : (
              filtered.map((lang) => {
                const selected = lang.id === currentLanguage;
                return (
                  <button
                    key={lang.id}
                    type="button"
                    data-testid={`${dataTestId}-lang-${lang.id}`}
                    onClick={() => onSelect(lang.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'bg-sidebar-primary/15 font-medium text-sidebar-primary'
                        : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {/* 语言图标(Material Icon Theme,参考图片的彩色图标列表) */}
                    {selected ? (
                      <Check aria-hidden className="size-3.5 shrink-0" />
                    ) : (
                      <span className="flex size-3.5 shrink-0 items-center justify-center" />
                    )}
                    <LanguageIcon language={lang.id} />
                    <span className="truncate">
                      {lang.id === 'plaintext' ? t('tools.text_editor.lang_plaintext') : lang.label}
                    </span>
                    <span className="ml-auto truncate text-[10px] text-muted-foreground/60">
                      ({lang.id})
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 语言模式选择器 —— 仿 VSCode 右下角「选择语言模式」对话框
 *
 * 点击状态栏语言徽章打开,列出全部支持的语言;当前语言高亮并打勾。
 * 每项带语言图标(Material Icon Theme,与文件图标主题同源)。
 * 顶部 cmdk 搜索框(按名称/标识过滤),选择后即时应用到激活 Tab 并关闭。
 * 使用统一 CommandDialog 壳组件(动画为「从中间放大」)。
 *
 * 行为相对旧版(普通 Input + ScrollArea + button)的升级:获得 cmdk
 * 键盘上下键导航 + 回车触发,交互更贴近 VSCode Quick Pick;
 * i18n 文案与 data-testid 契约(`-search` / `-list` / `-lang-<id>`)保持不变。
 */
import { useMemo, useState, type JSX } from 'react';
import { Check, Sparkles } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DialogTitle } from '@/components/ui/dialog';
import type { EditorLanguage } from '@/components/ui/code-editor';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';
import { QUICK_LANGUAGES } from './languageMap';
import { LanguageIcon } from './languageIcons';

export interface EditorLanguagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLanguage: EditorLanguage;
  onSelect: (language: EditorLanguage) => void;
  /** 选择首项「自动检测」的回调;提供后才渲染该首项(VSCode「自动检测」样式) */
  onSelectAuto?: () => void;
  /** 测试定位用 */
  'data-testid'?: string;
}

export function EditorLanguagePicker({
  open,
  onOpenChange,
  currentLanguage,
  onSelect,
  onSelectAuto,
  'data-testid': dataTestId,
}: EditorLanguagePickerProps): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // 按关键词过滤(label / id 不区分大小写包含匹配),plaintext 显示名走 i18n。
  // 打开时重置搜索词由 onOpenChange 中的 setQuery('') 实现。
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
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setQuery('');
        onOpenChange(next);
      }}
      contentTestId={dataTestId}
      /* 宽度以全局搜索(SearchDialog)为基准:同为固定 48rem,高度由外壳固定 */
      contentClassName="w-[48rem] max-w-[calc(100vw-2rem)]"
      hideCloseButton
      shouldFilter={false}
      header={
        <>
          {/* 与其他对话框一致:标题用 sr-only 隐藏,仅保留无障碍可读名,
           * 顶部不再显示可见标题栏,只留搜索输入框 */}
          <DialogTitle className="sr-only">
            {t('tools.text_editor.select_language_mode')}
          </DialogTitle>
          {/* 统一使用壳组件默认输入样式(h-11 / px-3 / border-b),与全局查找一致 */}
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('tools.text_editor.picker_search_placeholder')}
            data-testid={`${dataTestId}-search`}
          />
        </>
      }
    >
      {/* 依赖外壳固定高度:去掉 max-h 上限,让列表 flex-1 填满整个对话框,
       * 超出部分由滚动条查看,不再在底部留白色空白 */}
      <CommandList data-testid={`${dataTestId}-list`}>
        {/* 首项「自动检测」(VSCode 语言模式列表同款):仅在未输入筛选词时展示;
         * 不做持久高亮,悬停 / 键盘选中时由 cmdk 高亮(勾只用于具体语言项) */}
        {onSelectAuto && query.trim() === '' && (
          <CommandItem
            value="auto-detect"
            data-testid={`${dataTestId}-auto`}
            onSelect={() => onSelectAuto()}
            className="rounded-none px-3 py-1.5"
          >
            {/* 占位与语言项的勾选列对齐,但恒不显示勾 */}
            <span className="flex size-3.5 shrink-0 items-center justify-center" />
            <Sparkles aria-hidden className="size-3.5 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
            <span className="truncate">{t('tools.text_editor.picker_auto_detect')}</span>
          </CommandItem>
        )}
        {filtered.length === 0 ? (
          <CommandEmpty>{t('tools.text_editor.picker_empty')}</CommandEmpty>
        ) : (
          filtered.map((lang) => {
            const selected = lang.id === currentLanguage;
            return (
              <CommandItem
                key={lang.id}
                value={lang.id}
                data-testid={`${dataTestId}-lang-${lang.id}`}
                onSelect={() => onSelect(lang.id)}
                /* VSCode 列表行:高亮满宽平铺,不做内缩圆角 */
                className={cn(
                  'rounded-none px-3 py-1.5',
                  selected && 'bg-accent font-medium text-accent-foreground',
                )}
              >
                {/* 语言图标(Material Icon Theme,与 VSCode 语言模式列表同布局) */}
                {selected ? (
                  <Check aria-hidden className="size-3.5 shrink-0" />
                ) : (
                  <span className="flex size-3.5 shrink-0 items-center justify-center" />
                )}
                <LanguageIcon language={lang.id} />
                {/* 标识符紧跟显示名之后(VSCode 样式),不再推到行尾 */}
                <span className="truncate">
                  {lang.id === 'plaintext' ? t('tools.text_editor.lang_plaintext') : lang.label}
                </span>
                <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">
                  ({lang.id})
                </span>
              </CommandItem>
            );
          })
        )}
      </CommandList>
    </CommandDialog>
  );
}
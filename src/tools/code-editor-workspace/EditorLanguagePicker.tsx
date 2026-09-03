/**
 * 语言模式选择器 —— 仿 VSCode 右下角「选择语言模式」对话框
 *
 * 点击状态栏语言徽章打开,列出全部支持的语言;当前语言高亮并打勾。
 * 每项带语言图标(Material Icon Theme,与文件图标主题同源)。
 * 顶部 cmdk 搜索框(按名称/标识过滤),选择后即时应用到激活 Tab 并关闭。
 * 使用统一 QuickPickDialog 壳组件(动画为「从中间放大」)。
 *
 * 行为相对旧版(普通 Input + ScrollArea + button)的升级:获得 cmdk
 * 键盘上下键导航 + 回车触发,交互更贴近 VSCode Quick Pick;
 * i18n 文案与 data-testid 契约(`-search` / `-list` / `-lang-<id>`)保持不变。
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { QuickPickDialog, type QuickPickGroup, type QuickPickItem } from '@/components/ui/command';
import type { EditorLanguage } from '@/components/ui/code-editor';
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

  // 数据驱动分组:首项「自动检测」(未输入筛选词 + 提供回调) + 可搜索语言列表
  const groups = useMemo<QuickPickGroup[]>(() => {
    const items: QuickPickItem[] = [];
    if (onSelectAuto && query.trim() === '') {
      items.push({
        key: 'auto-detect',
        value: 'auto-detect',
        checkColumn: true,
        leading: <LanguageIcon language={currentLanguage} />,
        label: t('tools.text_editor.picker_auto_detect'),
        trailing: `(${currentLanguage})`,
        testId: dataTestId ? `${dataTestId}-auto` : undefined,
        onSelect: () => onSelectAuto(),
      });
    }
    for (const lang of filtered) {
      items.push({
        key: lang.id,
        value: lang.id,
        checkColumn: true,
        selected: lang.id === currentLanguage,
        leading: <LanguageIcon language={lang.id} />,
        label: lang.id === 'plaintext' ? t('tools.text_editor.lang_plaintext') : lang.label,
        trailing: `(${lang.id})`,
        testId: dataTestId ? `${dataTestId}-lang-${lang.id}` : undefined,
        onSelect: () => onSelect(lang.id),
      });
    }
    return [{ items }];
  }, [query, filtered, currentLanguage, onSelectAuto, onSelect, dataTestId, t]);

  return (
    <QuickPickDialog
      open={open}
      onOpenChange={(next) => {
        setQuery('');
        onOpenChange(next);
      }}
      contentTestId={dataTestId}
      /* 宽度沿用 QuickPickDialog 默认(对齐全局搜索 48rem),高度随内容伸缩 */
      hideCloseButton
      shouldFilter={false}
      /* 标题用 sr-only 隐藏,仅保留无障碍可读名,顶部只留搜索输入框 */
      title={t('tools.text_editor.select_language_mode')}
      placeholder={t('tools.text_editor.picker_search_placeholder')}
      value={query}
      onValueChange={setQuery}
      groups={groups}
      empty={t('tools.text_editor.picker_empty')}
      inputTestId={dataTestId ? `${dataTestId}-search` : undefined}
      listTestId={dataTestId ? `${dataTestId}-list` : undefined}
    />
  );
}

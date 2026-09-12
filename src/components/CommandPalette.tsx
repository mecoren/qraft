import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { QuickPickDialog, type QuickPickGroup, type QuickPickItem } from '@/components/ui/command';
import { History, Home, Settings, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { useHistoryStore } from '@/store/historyStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useUiStore } from '@/store/uiStore';
import { isPopoutSupported, openToolInNewWindow } from '@/lib/popout-window';
import { CATALOG_CATEGORIES, TOOL_CATALOG, pickText } from '@/lib/tool-catalog';
import { fuzzyRank } from '@/lib/fuzzy-match';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenHistory,
}: CommandPaletteProps): JSX.Element {
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const openTool = useUiStore((s) => s.openTool);
  const goWelcome = useUiStore((s) => s.goWelcome);
  const detected = useUiStore((s) => s.detectedTools);
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  const { t } = useTranslation();
  // 自管查询(shouldFilter=false,过滤由 fuzzyRank 接管:子串优先+缩写子序列)。
  // 关闭态派生为空串:下次打开自然回到全量列表,免去 effect 里 setState(级联渲染)
  const [queryRaw, setQueryRaw] = useState('');
  const query = open ? queryRaw : '';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const totalCount = TOOL_CATALOG.length;
  const categoryLabelMap = new Map<string, string>();
  for (const cat of CATALOG_CATEGORIES) {
    categoryLabelMap.set(cat.id, pickText(cat.label));
  }

  /** 工具条目 → 统一 QuickPickItem 行(图标 + 加粗主文本 [+描述] + 类别徽章) */
  const toolItem = (
    entry: (typeof TOOL_CATALOG)[number],
    extraKeywords: string,
    onPick: () => void,
    description?: ReactNode,
  ): QuickPickItem => ({
    key: entry.id,
    value: `${entry.name.zh} ${entry.name.en} ${entry.keywords.join(' ')} ${extraKeywords}`,
    leading: <entry.icon aria-hidden className="size-4 shrink-0 opacity-70" />,
    label: <span className="font-medium">{pickText(entry.name)}</span>,
    // 覆盖描述优先(如剪贴板命中原因),否则回退到工具自带的 description
    description: description ?? (entry.description ? pickText(entry.description) : undefined),
    trailing: categoryLabelMap.get(entry.category),
    trailingStyle: 'badge' as const,
    onSelect: onPick,
  });

  const groups = useMemo<QuickPickGroup[]>(() => {
    const closeAfter = (fn: () => void) => () => {
      fn();
      onOpenChange(false);
    };
    // 模糊过滤(value 拼接 zh+en+keywords,与子串时代口径一致)并按
    // 相关度排序;剪贴板检测组不做过滤(应用启动时的推荐语义,非查询结果)
    const rankItems = (items: QuickPickItem[]): QuickPickItem[] =>
      fuzzyRank(items, query, (item) => item.value ?? item.key);
    const result: QuickPickGroup[] = [];

    // 剪贴板检测到的工具优先展示
    if (detected.length > 0) {
      const items: QuickPickItem[] = [];
      for (const d of detected) {
        const entry = TOOL_CATALOG.find((c) => c.id === d.toolId);
        if (!entry) continue;
        items.push(
          toolItem(
            entry,
            d.reason,
            closeAfter(() => openTool(d.toolId)),
            t(d.reason),
          ),
        );
      }
      if (items.length > 0) {
        result.push({ key: 'detect', heading: t('chrome.palette.detect_clipboard'), items });
      }
    }

    // 全部工具(模糊过滤 + 相关度排序)
    result.push({
      key: 'tools',
      heading: t('chrome.palette.group_tools'),
      items: rankItems(
        TOOL_CATALOG.map((entry) =>
          toolItem(
            entry,
            '',
            closeAfter(() => {
              if (entry.special === 'settings') onOpenSettings?.();
              else if (entry.special === 'extensions') useUiStore.getState().setView('extensions');
              else openTool(entry.id);
            }),
          ),
        ),
      ),
    });

    // 操作区(模糊过滤 + 相关度排序)
    const actions: QuickPickItem[] = [];
    if (currentToolId && isPopoutSupported(currentToolId)) {
      actions.push({
        key: 'popout-current',
        value: 'popout new window open current tool 在新窗口打开 弹出',
        leading: <SquareArrowOutUpRight aria-hidden className="size-4 shrink-0 opacity-70" />,
        label: <span className="font-medium">{t('chrome.palette.popout_current')}</span>,
        onSelect: closeAfter(() => void openToolInNewWindow(currentToolId)),
      });
    }
    actions.push(
      {
        key: 'back-home',
        value: 'home welcome 所有工具 首页 all tools home',
        leading: <Home aria-hidden className="size-4 shrink-0 opacity-70" />,
        label: <span className="font-medium">{t('chrome.palette.back_home')}</span>,
        onSelect: closeAfter(() => goWelcome()),
      },
      {
        key: 'open-settings',
        value: 'settings open settings 打开设置',
        leading: <Settings aria-hidden className="size-4 shrink-0 opacity-70" />,
        label: <span className="font-medium">{t('chrome.palette.open_settings')}</span>,
        onSelect: closeAfter(() => onOpenSettings?.()),
      },
      {
        key: 'open-history',
        value: 'history open history 打开历史',
        leading: <History aria-hidden className="size-4 shrink-0 opacity-70" />,
        label: <span className="font-medium">{t('chrome.palette.open_history')}</span>,
        onSelect: closeAfter(() => onOpenHistory?.()),
      },
      {
        key: 'clear-history',
        value: 'clear history 清空历史 clear',
        leading: <Trash2 aria-hidden className="size-4 shrink-0 opacity-70" />,
        label: <span className="font-medium">{t('chrome.palette.clear_history')}</span>,
        onSelect: closeAfter(() => void clearHistory()),
      },
    );
    result.push({
      key: 'actions',
      heading: t('chrome.palette.group_actions'),
      items: rankItems(actions),
    });

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [detected, currentToolId, onOpenChange, onOpenSettings, onOpenHistory, t, query]);

  return (
    <QuickPickDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('chrome.app.name')}
      description={t('chrome.palette.description')}
      placeholder={t('chrome.palette.placeholder')}
      hideCloseButton
      shouldFilter={false}
      value={query}
      onValueChange={setQueryRaw}
      groups={groups}
      empty={t('chrome.palette.no_match')}
      footerTestId="palette-footer"
      count={t('chrome.command_footer.count', { count: totalCount })}
      footerCountTestId="palette-footer-count"
    />
  );
}

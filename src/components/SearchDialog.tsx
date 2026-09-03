/**
 * SearchDialog —— 全局搜索弹窗(VSCode 风格)
 *
 * 居中浮层大面板:顶部搜索框 + 按「工具 / 工具区块 / 设置 / 设置项 / 页面」
 * 分组的滚动结果列表。复用 cmdk Command 提供 ↑↓ 键盘导航与 Enter 触发;
 * 结果过滤由 search-index 的 searchIndex() 驱动(静态索引 + 线性匹配)。
 *
 * 交互:
 * - 选择结果 → 写入 searchStore.target,关闭面板;
 *   App 层 useSearchJump / SettingsDialog 完成跳转 + 锚点定位高亮。
 * - 默认进入「文本」模式(Ctrl+Shift+F 对应 VSCode「在文件中查找」),
 *   可点输入框前导区的按钮切到「功能」模式;切换模式会清空查询。
 * - 空查询展示全量索引,便于浏览全部功能。
 * - 输入防抖 80ms,避免每键重扫(索引量小,主要为输入体验)。
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  FileText,
  Home,
  History,
  Info,
  Keyboard,
  Puzzle,
  Settings,
  Files,
  type LucideIcon,
} from 'lucide-react';
import { QuickPickDialog, type QuickPickGroup, type QuickPickItem } from '@/components/ui/command';
import { searchIndex, type SearchEntry, type SearchEntryKind } from '@/lib/search-index';
import { MATCH_BATCH_SIZE, searchTabsText } from '@/lib/editor-text-search';
import { getCatalogEntry } from '@/lib/tool-catalog';
import { useSearchStore } from '@/store/searchStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 分组展示顺序与标签(存 i18n 键,组件层翻译) */
const KIND_LABEL: Record<SearchEntryKind, string> = {
  tool: 'chrome.search_dialog.group_tool',
  'tool-section': 'chrome.search_dialog.group_tool_section',
  setting: 'chrome.search_dialog.group_setting',
  'setting-field': 'chrome.search_dialog.group_setting_field',
  page: 'chrome.search_dialog.group_page',
};

/** 搜索模式 */
type SearchMode = 'feature' | 'text';

/** 模式切换项(label 存 i18n 键) */
const MODES: { id: SearchMode; labelKey: string; icon: LucideIcon }[] = [
  { id: 'feature', labelKey: 'chrome.search_dialog.mode_feature', icon: Search },
  { id: 'text', labelKey: 'chrome.search_dialog.mode_text', icon: Files },
];

/** 文本模式匹配行内容高亮(匹配片段橙黄背景,区分大小写跟随搜索) */
function HighlightLine({ content, query }: { content: string; query: string }): JSX.Element {
  const q = query.trim().toLowerCase();
  if (!q) return <span className="truncate">{content}</span>;
  const lower = content.toLowerCase();
  const parts: JSX.Element[] = [];
  let from = 0;
  while (from < lower.length) {
    const pos = lower.indexOf(q, from);
    const key = parts.length;
    if (pos === -1) {
      parts.push(<span key={key}>{content.slice(from)}</span>);
      break;
    }
    if (pos > from) {
      parts.push(<span key={key}>{content.slice(from, pos)}</span>);
    }
    parts.push(
      <mark key={parts.length} className="search-text-match-inline">
        {content.slice(pos, pos + q.length)}
      </mark>,
    );
    from = pos + q.length;
  }
  return <span className="flex min-w-0 items-center gap-1 font-mono text-xs">{parts}</span>;
}

/** 结果项图标:工具用自身图标,其余按类型映射(静态组件,避免渲染期创建组件) */
function EntryIcon({ entry }: { entry: SearchEntry }): JSX.Element {
  let Icon: LucideIcon;
  switch (entry.kind) {
    case 'tool':
      Icon = getCatalogEntry(entry.target.toolId ?? '')?.icon ?? FileText;
      break;
    case 'tool-section':
      Icon = FileText;
      break;
    case 'setting':
      Icon = Settings;
      break;
    case 'setting-field':
      Icon = Keyboard;
      break;
    case 'page': {
      switch (entry.target.view) {
        case 'welcome':
          Icon = Home;
          break;
        case 'history':
          Icon = History;
          break;
        case 'extensions':
          Icon = Puzzle;
          break;
        case 'about':
          Icon = Info;
          break;
        default:
          Icon = Settings;
      }
      break;
    }
  }
  return (
    <Icon
      aria-hidden
      className="size-4 shrink-0 text-muted-foreground"
      strokeWidth={ICON_STROKE_WIDTH}
    />
  );
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps): JSX.Element {
  const { t } = useTranslation();
  // 默认文本模式:对齐 Ctrl+Shift+F「在文件中查找」的语义
  const [mode, setMode] = useState<SearchMode>('text');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loadedMatchCount, setLoadedMatchCount] = useState(MATCH_BATCH_SIZE);
  const listFooterRef = useRef<HTMLButtonElement>(null);

  // 文本编辑工作区已打开文件
  const tabs = useEditorWorkspaceStore((s) => s.workspace.tabs);

  // 输入防抖:80ms 后刷新结果,避免每键重扫
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 80);
    return () => window.clearTimeout(t);
  }, [query]);

  const grouped = useMemo(() => searchIndex(debounced), [debounced]);

  const tabGroups = useMemo(
    () => (mode === 'text' ? searchTabsText(tabs, debounced, loadedMatchCount) : []),
    [mode, tabs, debounced, loadedMatchCount],
  );

  const total = useMemo(() => {
    if (mode === 'text') {
      return tabGroups.reduce((n, g) => n + g.count, 0);
    }
    return [...grouped.values()].reduce((n, list) => n + list.length, 0);
  }, [mode, grouped, tabGroups]);

  const loadedCount = useMemo(
    () => tabGroups.reduce((total, group) => total + group.matches.length, 0),
    [tabGroups],
  );

  useEffect(() => {
    setLoadedMatchCount(MATCH_BATCH_SIZE);
  }, [mode, debounced]);

  /** 切换模式时清空查询,避免跨模式残留 */
  const switchMode = (next: SearchMode) => {
    setMode(next);
    setQuery('');
    setDebounced('');
  };

  const handleSelect = (entry: SearchEntry) => {
    useSearchStore.getState().requestJump(entry.target);
    onOpenChange(false);
  };

  /** 文本结果点击:跳转到文本编辑器对应 tab,由 useSearchJump 做高亮定位 */
  const handleTextSelect = (tabId: string) => {
    const q = debounced.trim();
    if (!q) return;
    useSearchStore.getState().requestJump({
      view: 'tool',
      toolId: 'text_editor',
      tabId,
      textQuery: q,
    });
    onOpenChange(false);
  };

  const handleLoadMore = () => {
    setLoadedMatchCount((count) => count + MATCH_BATCH_SIZE);
  };

  const featureGroups = useMemo(
    () =>
      [...grouped.entries()]
        .map(([kind, entries]): QuickPickGroup | null =>
          entries.length === 0
            ? null
            : {
                key: kind,
                heading: t(KIND_LABEL[kind]),
                items: entries.map((entry): QuickPickItem => ({
                  key: entry.id,
                  value: `${entry.id} ${entry.title} ${entry.keywords.join(' ')}`,
                  leading: <EntryIcon entry={entry} />,
                  label: entry.title,
                  description: entry.description,
                  trailing: entry.group,
                  trailingStyle: 'badge',
                  onSelect: () => handleSelect(entry),
                })),
              },
        )
        .filter((g): g is QuickPickGroup => g !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
    [grouped, t],
  );

  // —— 数据驱动分组:文本模式按文件分组(行内容经 HighlightLine 高亮),功能模式按类型分组 ——
  const groups = useMemo(() => {
    if (mode === 'text') {
      return tabGroups.map((g): QuickPickGroup => ({
        key: g.tabId,
        heading: (
          <span className="flex w-full items-center justify-between gap-2">
            <span className="truncate">{g.tabTitle}</span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              {g.truncated
                ? t('chrome.search_dialog.lines_progress', {
                    current: g.matches.length,
                    total: g.count,
                  })
                : t('chrome.search_dialog.lines_count', { count: g.count })}
            </span>
          </span>
        ),
        items: g.matches.map((m): QuickPickItem => ({
          key: `${g.tabId}:${m.line}`,
          value: `${g.tabId}:${m.line}:${m.lineContent}`,
          leading: (
            <span className="w-8 shrink-0 text-right font-mono text-[10px] leading-none text-muted-foreground">
              {m.line}
            </span>
          ),
          label: <HighlightLine content={m.lineContent} query={debounced} />,
          ariaLabel: `${g.tabTitle}:${m.line}: ${m.lineContent}`,
          onSelect: () => handleTextSelect(g.tabId),
        })),
      }));
    }
    return featureGroups;
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [mode, tabGroups, featureGroups, debounced, t]);

  const emptyNode = (() => {
    if (mode === 'text') {
      if (tabs.length === 0) return t('chrome.search_dialog.need_editor_file');
      if (debounced.trim() === '') return t('chrome.search_dialog.text_search_hint');
      return t('chrome.search_dialog.no_matches', { query: debounced.trim() });
    }
    return t('chrome.search_dialog.no_matches', { query: debounced.trim() });
  })();

  return (
    <QuickPickDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('chrome.search_dialog.sr_title')}
      /* 无障碍描述随模式变化(默认文本模式) */
      description={
        mode === 'text' ? t('chrome.search_dialog.sr_desc_text') : t('chrome.search_dialog.sr_desc')
      }
      /* VSCode Quick Pick:统一壳,宽度/高度均由 QuickPickDialog 默认对齐「全局搜索」 */
      shouldFilter={false}
      value={query}
      onValueChange={setQuery}
      /* 模式切换按钮嵌入 leading 前导区(查询由自身 state 管理 + shouldFilter=false,
       * cmdk 仅负责结果列表的 ↑↓ 键盘导航与 Enter 触发) */
      leading={
        <div className="mr-2 flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={active}
                onClick={() => switchMode(m.id)}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon aria-hidden className="size-3.5" strokeWidth={ICON_STROKE_WIDTH} />
                {t(m.labelKey)}
              </button>
            );
          })}
        </div>
      }
      placeholder={
        mode === 'text'
          ? t('chrome.search_dialog.placeholder_text')
          : t('chrome.search_dialog.placeholder_global')
      }
      inputProps={{
        autoFocus: true,
        'aria-label':
          mode === 'text'
            ? t('chrome.search_dialog.aria_text')
            : t('chrome.search_dialog.aria_global'),
      }}
      groups={groups}
      empty={emptyNode}
      preserveSelectionOnChange={mode === 'text'}
      listFooter={
        mode === 'text' && tabGroups.some((g) => g.truncated) ? (
          <button
            type="button"
            ref={listFooterRef}
            onClick={handleLoadMore}
            className="w-full px-6 py-2 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('chrome.search_dialog.too_many_hits')} ·{' '}
            {t('chrome.search_dialog.load_more_count', { count: MATCH_BATCH_SIZE })}
          </button>
        ) : undefined
      }
      count={
        mode === 'text'
          ? t('chrome.command_footer.loaded_count', { loaded: loadedCount, total })
          : t('chrome.command_footer.count', { count: total })
      }
    />
  );
}

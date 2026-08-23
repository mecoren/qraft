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
 * - 空查询展示全量索引,便于浏览全部功能。
 * - 输入防抖 80ms,避免每键重扫(索引量小,主要为输入体验)。
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
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
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { searchIndex, type SearchEntry, type SearchEntryKind } from '@/lib/search-index';
import { searchTabsText, type TabGroup } from '@/lib/editor-text-search';
import { getCatalogEntry } from '@/lib/tool-catalog';
import { useSearchStore } from '@/store/searchStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 分组展示顺序与中文标签 */
const KIND_LABEL: Record<SearchEntryKind, string> = {
  tool: '工具',
  'tool-section': '工具区块',
  setting: '设置',
  'setting-field': '设置项',
  page: '页面',
};

/** 搜索模式 */
type SearchMode = 'feature' | 'text';

/** 模式切换项 */
const MODES: { id: SearchMode; label: string; icon: LucideIcon }[] = [
  { id: 'feature', label: '功能', icon: Search },
  { id: 'text', label: '文本', icon: Files },
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

/** 文件分组的文本搜索结果 */
function TextResultGroup({
  group,
  query,
  onSelect,
}: {
  group: TabGroup;
  query: string;
  onSelect: (tabId: string) => void;
}): JSX.Element {
  return (
    <CommandGroup
      key={group.tabId}
      heading={
        <span className="flex w-full items-center justify-between gap-2">
          <span className="truncate">{group.tabTitle}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
            {group.count} 行
          </span>
        </span>
      }
    >
      {group.matches.map((m) => (
        <CommandItem
          key={`${group.tabId}:${m.line}`}
          value={`${group.tabId}:${m.line}:${m.lineContent}`}
          onSelect={() => onSelect(group.tabId)}
          aria-label={`${group.tabTitle}:${m.line}: ${m.lineContent}`}
          className="py-1.5"
        >
          <span className="w-8 shrink-0 text-right font-mono text-[10px] leading-none text-muted-foreground">
            {m.line}
          </span>
          <HighlightLine content={m.lineContent} query={query} />
        </CommandItem>
      ))}
    </CommandGroup>
  );
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
  const [mode, setMode] = useState<SearchMode>('text');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // 文本编辑工作区已打开文件
  const tabs = useEditorWorkspaceStore((s) => s.workspace.tabs);

  // 输入防抖:80ms 后刷新结果,避免每键重扫
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 80);
    return () => window.clearTimeout(t);
  }, [query]);

  const grouped = useMemo(() => searchIndex(debounced), [debounced]);

  const tabGroups = useMemo(
    () => (mode === 'text' ? searchTabsText(tabs, debounced) : []),
    [mode, tabs, debounced],
  );

  const total = useMemo(() => {
    if (mode === 'text') {
      return tabGroups.reduce((n, g) => n + g.count, 0);
    }
    return [...grouped.values()].reduce((n, list) => n + list.length, 0);
  }, [mode, grouped, tabGroups]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden p-0">
        <DialogTitle className="sr-only">全局搜索</DialogTitle>
        <DialogDescription className="sr-only">搜索所有功能,回车跳转</DialogDescription>
        <Command shouldFilter={false}>
          {/* 受控搜索输入:查询由自身 state 管理,searchIndex 驱动结果过滤;
           * cmdk 仅负责结果列表的 ↑↓ 键盘导航与 Enter 触发 */}
          <div className="flex items-center gap-2 border-b px-3">
            {/* 模式切换:功能搜索(工具/设置/页面) / 文本搜索(编辑器内容) */}
            <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5">
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
                    {m.label}
                  </button>
                );
              })}
            </div>
            <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'text' ? '搜索编辑器文本...' : '搜索所有功能、工具、设置...'}
              autoFocus
              aria-label={mode === 'text' ? '文本搜索' : '全局搜索'}
              className="flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandList className="max-h-[60vh]">
            {mode === 'text' ? (
              /* —— 文本搜索模式:按文件分组展示匹配行 —— */
              tabs.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  请先在文本编辑器中打开文件
                </div>
              ) : debounced.trim() === '' ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  输入关键字搜索已打开文件的内容
                </div>
              ) : total === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  未找到匹配「{debounced.trim()}」的内容
                </div>
              ) : (
                tabGroups.map((g) => (
                  <TextResultGroup
                    key={g.tabId}
                    group={g}
                    query={debounced}
                    onSelect={handleTextSelect}
                  />
                ))
              )
            ) : total === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                未找到匹配「{debounced.trim()}」的内容
              </div>
            ) : (
              grouped.size > 0 &&
              [...grouped.entries()].map(([kind, entries]) => (
                <CommandGroup key={kind} heading={KIND_LABEL[kind]}>
                  {entries.map((entry) => {
                    return (
                      <CommandItem
                        key={entry.id}
                        value={`${entry.id} ${entry.title} ${entry.keywords.join(' ')}`}
                        onSelect={() => handleSelect(entry)}
                        className="py-2"
                      >
                        <EntryIcon entry={entry} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{entry.title}</div>
                          {entry.description && (
                            <div className="truncate text-xs text-muted-foreground">
                              {entry.description}
                            </div>
                          )}
                        </div>
                        <span className="ml-2 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                          {entry.group}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))
            )}
          </CommandList>
          <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↓</kbd>
              导航
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                Enter
              </kbd>
              跳转
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
              关闭
            </span>
            <span className="ml-auto">{total} 条结果</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

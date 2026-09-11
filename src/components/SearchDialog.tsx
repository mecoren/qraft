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
  CaseSensitive,
  Regex,
  WholeWord,
  Replace,
  ReplaceAll,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { QuickPickDialog, type QuickPickGroup, type QuickPickItem } from '@/components/ui/command';
import { searchIndex, type SearchEntry, type SearchEntryKind } from '@/lib/search-index';
import {
  MATCH_BATCH_SIZE,
  compileMatcher,
  isRegexQueryValid,
  replaceInContent,
  searchTabsText,
  type TextSearchOptions,
} from '@/lib/editor-text-search';
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

/** 文本模式匹配选项切换钮(图标 + i18n 提示;id 对应 TextSearchOptions 开关) */
const MATCH_TOGGLES: { key: keyof TextSearchOptions; labelKey: string; icon: LucideIcon }[] = [
  { key: 'caseSensitive', labelKey: 'chrome.search_dialog.match_case', icon: CaseSensitive },
  { key: 'wholeWord', labelKey: 'chrome.search_dialog.match_word', icon: WholeWord },
  { key: 'regex', labelKey: 'chrome.search_dialog.match_regex', icon: Regex },
];

/**
 * 文本模式匹配行内容高亮:匹配片段橙黄背景。
 * 与 searchTabsText / 编辑器跳转高亮共用 compileMatcher,
 * 保证任一开关组合下列表、行内 <mark>、编辑器 decoration 三处口径一致。
 */
function HighlightLine({
  content,
  query,
  options,
}: {
  content: string;
  query: string;
  options?: TextSearchOptions;
}): JSX.Element {
  const matcher = compileMatcher(query, options);
  if (!matcher) return <span className="truncate">{content}</span>;
  const hits = matcher(content);
  if (hits.length === 0) return <span className="truncate">{content}</span>;
  const parts: JSX.Element[] = [];
  let from = 0;
  for (const { start, end } of hits) {
    const key = parts.length;
    if (start > from) {
      parts.push(<span key={key}>{content.slice(from, start)}</span>);
    }
    parts.push(
      <mark key={parts.length} className="search-text-match-inline">
        {content.slice(start, end)}
      </mark>,
    );
    from = end;
  }
  if (from < content.length) {
    parts.push(<span key={parts.length}>{content.slice(from)}</span>);
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
  // 文本模式匹配选项(仅语义开关,重置查询/切模式时一并复位,对齐 VSCode)
  const [matchOptions, setMatchOptions] = useState<TextSearchOptions>({});
  const listFooterRef = useRef<HTMLButtonElement>(null);
  // —— 跨文件查找替换(VSCode「在文件中替换」)——
  /** 替换栏是否展开(文本模式专属;展开显示替换输入框与替换动作) */
  const [replaceOpen, setReplaceOpen] = useState(false);
  /** 替换文本(空串 = 替换为空;正则模式支持 $1 反向引用) */
  const [replacement, setReplacement] = useState('');

  // 文本编辑工作区已打开文件
  const tabs = useEditorWorkspaceStore((s) => s.workspace.tabs);

  // 输入防抖:80ms 后刷新结果,避免每键重扫
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(query);
      // 新查询 => 新结果集,分页游标回到首批
      setLoadedMatchCount(MATCH_BATCH_SIZE);
    }, 80);
    return () => window.clearTimeout(t);
  }, [query]);

  const grouped = useMemo(() => searchIndex(debounced), [debounced]);

  const tabGroups = useMemo(
    () => (mode === 'text' ? searchTabsText(tabs, debounced, loadedMatchCount, matchOptions) : []),
    [mode, tabs, debounced, loadedMatchCount, matchOptions],
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

  /** 切换模式时清空查询/匹配选项/替换栏,避免跨模式残留 */
  const switchMode = (next: SearchMode) => {
    setMode(next);
    setQuery('');
    setDebounced('');
    setLoadedMatchCount(MATCH_BATCH_SIZE);
    setMatchOptions({});
    setReplaceOpen(false);
    setReplacement('');
  };

  const handleSelect = (entry: SearchEntry) => {
    useSearchStore.getState().requestJump(entry.target);
    onOpenChange(false);
  };

  /** 文本结果点击:跳转到文本编辑器对应 tab,由 useSearchJump 做同口径高亮定位 */
  const handleTextSelect = (tabId: string) => {
    const q = debounced.trim();
    if (!q) return;
    useSearchStore.getState().requestJump({
      view: 'tool',
      toolId: 'text_editor',
      tabId,
      textQuery: q,
      // 匹配选项随信令透传,编辑器高亮与列表/行内口径一致
      textSearchOptions: matchOptions,
    });
    onOpenChange(false);
  };

  // —— 跨文件替换:作用于已打开 Tab 的内容(setTabContent 标 dirty,
  // 用户经保存流程落盘——替换只改内存,不直接写文件,可 Ctrl+Z 撤销)——

  /** 对单个 tab 执行替换并写回 store;无命中/无变化返回 0 */
  const applyReplaceToTab = (tabId: string): number => {
    const store = useEditorWorkspaceStore.getState();
    const tab = store.workspace.tabs.find((tb) => tb.id === tabId);
    // 大文件 Tab 只读不可编辑;untitled 纯内存 Tab 同样可替换
    if (!tab || tab.largeFile) return 0;
    const result = replaceInContent(tab.content, debounced, replacement, matchOptions);
    if (!result || result.replacements === 0 || result.content === tab.content) return 0;
    store.setTabContent(tabId, result.content);
    return result.replacements;
  };

  /** 替换单个文件(分组标题按钮):toast 报告替换次数 */
  const handleReplaceFile = (tabId: string, tabTitle: string) => {
    const count = applyReplaceToTab(tabId);
    if (count > 0) {
      toast.success(t('chrome.search_dialog.replace_file_done', { title: tabTitle, count }));
    } else {
      toast.info(t('chrome.search_dialog.replace_file_none', { title: tabTitle }));
    }
  };

  /** 全部替换(替换栏按钮):遍历全部命中分组,累计替换数;toast 汇总 */
  const handleReplaceAll = () => {
    let files = 0;
    let count = 0;
    for (const group of tabGroups) {
      const n = applyReplaceToTab(group.tabId);
      if (n > 0) {
        files++;
        count += n;
      }
    }
    if (count > 0) {
      toast.success(t('chrome.search_dialog.replace_all_done', { files, count }));
    } else {
      toast.info(t('chrome.search_dialog.replace_all_none'));
    }
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
            <span className="min-w-0 flex-1 truncate">{g.tabTitle}</span>
            {/* 替换栏展开时:分组标题右侧显示「替换该文件」按钮(仅替换该 tab) */}
            {replaceOpen && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleReplaceFile(g.tabId, g.tabTitle);
                }}
                title={t('chrome.search_dialog.replace_file_title', { title: g.tabTitle })}
                aria-label={t('chrome.search_dialog.replace_file_title', { title: g.tabTitle })}
                data-testid={`search-replace-file-${g.tabId}`}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Replace aria-hidden className="size-3" strokeWidth={ICON_STROKE_WIDTH} />
              </button>
            )}
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
          label: <HighlightLine content={m.lineContent} query={debounced} options={matchOptions} />,
          ariaLabel: `${g.tabTitle}:${m.line}: ${m.lineContent}`,
          onSelect: () => handleTextSelect(g.tabId),
        })),
      }));
    }
    return featureGroups;
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [mode, tabGroups, featureGroups, debounced, t, replaceOpen, replacement, matchOptions]);

  const emptyNode = (() => {
    if (mode === 'text') {
      if (tabs.length === 0) return t('chrome.search_dialog.need_editor_file');
      if (debounced.trim() === '') return t('chrome.search_dialog.text_search_hint');
      // 非法正则专门提示:与「确实无匹配」区分开,用户能立即意识到写错了
      if (!isRegexQueryValid(debounced, matchOptions)) {
        return t('chrome.search_dialog.invalid_regex');
      }
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
      /* 文本模式:输入框尾随「替换」展开钮 + 三枚匹配选项切换钮(Aa 大小写/整词/正则),
       * 激活态 accent 色直观指示当前口径;仅文本模式显示 */
      inputTrailing={
        mode === 'text' ? (
          <div className="ml-2 flex shrink-0 items-center gap-0.5">
            {/* 替换栏展开/收起(VSCode 同款心智:点箭头展开替换输入框) */}
            <button
              type="button"
              aria-pressed={replaceOpen}
              aria-label={t('chrome.search_dialog.toggle_replace')}
              title={t('chrome.search_dialog.toggle_replace')}
              data-testid="search-toggle-replace"
              onClick={() => setReplaceOpen((v) => !v)}
              className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                replaceOpen
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Replace
                aria-hidden
                className={`size-3.5 transition-transform ${replaceOpen ? '' : 'scale-y-[-1]'}`}
                strokeWidth={ICON_STROKE_WIDTH}
              />
            </button>
            {MATCH_TOGGLES.map(({ key, labelKey, icon: Icon }) => {
              const active = matchOptions[key] === true;
              // 正则激活且当前查询非法:图标描红,提示用户正则写错了
              const invalid = key === 'regex' && !isRegexQueryValid(debounced, matchOptions);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  title={t(labelKey)}
                  aria-label={t(labelKey)}
                  onClick={() => setMatchOptions((prev) => ({ ...prev, [key]: !prev[key] }))}
                  className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  } ${invalid ? 'text-destructive' : ''}`}
                >
                  <Icon aria-hidden className="size-3.5" strokeWidth={ICON_STROKE_WIDTH} />
                </button>
              );
            })}
          </div>
        ) : undefined
      }
      groups={groups}
      empty={emptyNode}
      preserveSelectionOnChange={mode === 'text'}
      /* 替换栏(文本模式 + 替换展开时):替换输入框 + 全部替换按钮。
       * 用 hint 槽渲染在搜索框与结果列表之间(VSCode「在文件中替换」布局) */
      hint={
        mode === 'text' && replaceOpen ? (
          <div data-testid="search-replace-bar" className="flex w-full items-center gap-2 py-1.5">
            <Replace
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={ICON_STROKE_WIDTH}
            />
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder={t('chrome.search_dialog.replace_placeholder')}
              aria-label={t('chrome.search_dialog.replace_placeholder')}
              data-testid="search-replace-input"
              /* 阻断 cmdk 键盘导航接管输入框内的方向键(Esc 仍冒泡关闭弹窗) */
              onKeyDown={(e) => e.stopPropagation()}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 font-mono text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
            />
            <button
              type="button"
              onClick={handleReplaceAll}
              disabled={tabGroups.length === 0}
              title={t('chrome.search_dialog.replace_all_title')}
              aria-label={t('chrome.search_dialog.replace_all_title')}
              data-testid="search-replace-all"
              className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ReplaceAll aria-hidden className="size-3.5" strokeWidth={ICON_STROKE_WIDTH} />
              {t('chrome.search_dialog.replace_all')}
            </button>
          </div>
        ) : undefined
      }
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

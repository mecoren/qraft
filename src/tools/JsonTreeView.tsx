/**
 * JsonTreeView —— JSON 树结构视图(参考 JetBrains 系 JSON 树插件)
 *
 * - 对象节点:`{} 图标 + 键名 + [object] 徽标 + (N 属性)`,可折叠
 * - 数组节点:`[] 图标 + 键名 + [array] 徽标 + (N 元素)`,可折叠,元素以索引为键
 * - 叶子节点:键名: 值,值按类型着色(string 橙 / number 蓝 / boolean 紫 / null 灰斜体)
 * - 默认展开前两层;工具栏提供展开全部 / 收起全部(遍历编量,防超大文档卡死)
 * - 折叠的子树不渲染(React 天然懒加载),超大数组/对象在折叠态下零开销
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Braces,
  Brackets,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

/** 展开全部时最多收集的容器路径数(防止超大文档一次性全展开卡死 UI) */
const MAX_EXPAND_PATHS = 5000;
/** 单个容器最多渲染的子节点数(超出截断并提示) */
const MAX_VISIBLE_CHILDREN = 1000;

export interface JsonTreeViewProps {
  /** 已解析的 JSON 值(由调用方负责解析与错误处理) */
  value: unknown;
  className?: string;
  'data-testid'?: string;
}

/** 收集全部「容器」路径(对象/数组),用于展开全部 */
function collectContainerPaths(value: unknown): string[] {
  const paths: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (paths.length >= MAX_EXPAND_PATHS) return;
    if (Array.isArray(v)) {
      paths.push(path);
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (v !== null && typeof v === 'object') {
      paths.push(path);
      for (const [k, item] of Object.entries(v)) walk(item, `${path}.${k}`);
    }
  };
  walk(value, '$');
  return paths;
}

/** 收集默认展开路径(深度 ≤ defaultDepth 的容器) */
function collectDefaultExpanded(value: unknown, defaultDepth: number): string[] {
  const paths: string[] = [];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (Array.isArray(v)) {
      if (depth <= defaultDepth) paths.push(path);
      if (depth < defaultDepth) v.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
    } else if (v !== null && typeof v === 'object') {
      if (depth <= defaultDepth) paths.push(path);
      if (depth < defaultDepth)
        for (const [k, item] of Object.entries(v)) walk(item, `${path}.${k}`, depth + 1);
    }
  };
  walk(value, '$', 1);
  return paths;
}

interface JsonNodeProps {
  /** 节点键名(根节点为 null,显示 root) */
  label: string | null;
  value: unknown;
  path: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  /** 是否为数组元素(元素行以索引样式呈现) */
  isArrayItem?: boolean;
}

/** 叶子值按类型着色 */
function LeafValue({ value }: { value: unknown }): JSX.Element {
  if (value === null) return <span className="italic text-muted-foreground">null</span>;
  switch (typeof value) {
    case 'string':
      return <span className="break-all text-orange-700 dark:text-orange-300">"{value}"</span>;
    case 'number':
      return <span className="text-sky-700 dark:text-sky-300">{String(value)}</span>;
    case 'boolean':
      return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>;
    default:
      // undefined / function 等 JSON 外类型:parse 后不应出现,兜底展示
      return <span className="text-muted-foreground">{String(value)}</span>;
  }
}

function JsonNode({
  label,
  value,
  path,
  expanded,
  onToggle,
  isArrayItem,
}: JsonNodeProps): JSX.Element {
  const { t } = useTranslation();
  const isOpen = expanded.has(path);
  const isContainer = Array.isArray(value) || (value !== null && typeof value === 'object');

  if (!isContainer) {
    return (
      <div className="flex items-baseline gap-1.5 py-px pl-6 leading-5">
        {label !== null && (
          <>
            <span
              className={cn(
                'shrink-0 text-sm text-foreground',
                isArrayItem && 'text-muted-foreground',
              )}
            >
              {isArrayItem ? `[${label}]` : label}
            </span>
            <span className="shrink-0 text-muted-foreground">:</span>
          </>
        )}
        <LeafValue value={value} />
      </div>
    );
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const countLabel = Array.isArray(value)
    ? t('chrome.json_tree.count_elements', { count: value.length })
    : t('chrome.json_tree.count_properties', { count: entries.length });
  const truncated = entries.length > MAX_VISIBLE_CHILDREN;
  const visibleEntries = truncated ? entries.slice(0, MAX_VISIBLE_CHILDREN) : entries;
  const Icon = Array.isArray(value) ? Brackets : Braces;

  return (
    <div>
      <button
        type="button"
        data-path={path}
        aria-expanded={isOpen}
        onClick={() => entries.length > 0 && onToggle(path)}
        className="flex w-full items-baseline gap-1.5 rounded px-1 py-px text-left leading-5 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {entries.length > 0 ? (
          isOpen ? (
            <ChevronDown
              aria-hidden
              className="size-3.5 shrink-0 self-center text-muted-foreground"
            />
          ) : (
            <ChevronRight
              aria-hidden
              className="size-3.5 shrink-0 self-center text-muted-foreground"
            />
          )
        ) : (
          <span className="inline-block size-3.5 shrink-0 self-center" aria-hidden />
        )}
        <Icon aria-hidden className="size-3.5 shrink-0 self-center text-muted-foreground" />
        {label !== null && (
          <span className={cn('text-sm font-medium text-foreground', isArrayItem && 'font-normal')}>
            {isArrayItem ? `[${label}]` : label}
          </span>
        )}
        <span className="rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
          {Array.isArray(value) ? '[array]' : '[object]'}
        </span>
        <span className="text-xs text-muted-foreground">{countLabel}</span>
      </button>
      {isOpen && (
        <div className="ml-[13px] border-l border-border/60 pl-2">
          {visibleEntries.map(([k, v]) => (
            <JsonNode
              key={k}
              label={k}
              value={v}
              path={Array.isArray(value) ? `${path}[${k}]` : `${path}.${k}`}
              expanded={expanded}
              onToggle={onToggle}
              isArrayItem={Array.isArray(value)}
            />
          ))}
          {truncated && (
            <div className="py-1 pl-6 text-xs text-muted-foreground">
              {t('chrome.json_tree.hidden_children', {
                count: entries.length - MAX_VISIBLE_CHILDREN,
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function JsonTreeView({
  value,
  className,
  'data-testid': dataTestId,
}: JsonTreeViewProps): JSX.Element {
  const { t } = useTranslation();
  // expanded 为空 Set 时表示「尚未手动操作」,按默认规则(前两层)展示:
  // 用哨兵值区分「收起全部」与「未初始化」,避免初始渲染误判。
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const allPaths = useMemo(() => collectContainerPaths(value), [value]);
  const defaultExpanded = useMemo(() => new Set(collectDefaultExpanded(value, 2)), [value]);

  const effective = expanded ?? defaultExpanded;
  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const base = prev ?? defaultExpanded;
      const next = new Set(base);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const expandAll = (): void => setExpanded(new Set(allPaths));
  const collapseAll = (): void => setExpanded(new Set<string>());

  const isRootPrimitive = !Array.isArray(value) && (value === null || typeof value !== 'object');

  return (
    // 嵌入式子视图(仅被 JsonFormatter 树形输出面板使用):
    // 外框由调用方面板提供,这里只保留工具栏 + 树滚动区,避免卡片套卡片
    <div
      className={cn('flex h-full min-h-0 flex-col bg-background', className)}
      data-testid={dataTestId}
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={expandAll}
          disabled={allPaths.length === 0}
          data-testid="tree-expand-all"
        >
          <ChevronsUpDown aria-hidden className="size-3.5" />
          {t('chrome.json_tree.expand_all')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={collapseAll}
          disabled={allPaths.length === 0}
          data-testid="tree-collapse-all"
        >
          <ChevronsDownUp aria-hidden className="size-3.5" />
          {t('chrome.json_tree.collapse_all')}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {isRootPrimitive
            ? t('chrome.json_tree.primitive')
            : t('chrome.json_tree.container_nodes', { count: allPaths.length })}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1" aria-label={t('chrome.json_tree.aria')}>
        <div className="p-2 font-mono">
          <JsonNode label={null} value={value} path="$" expanded={effective} onToggle={toggle} />
        </div>
      </ScrollArea>
    </div>
  );
}

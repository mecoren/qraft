import { useMemo, useRef, useState, type KeyboardEvent, type JSX } from 'react';
import {
  Braces,
  Binary,
  Wand2,
  FileSearch,
  ArrowLeftRight,
  GitCompare,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/Logo';
import { ToolIcon } from '@/lib/tool-icon';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolCategory, ToolMetadata } from '@/types/tool';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { ThemeModeToggle } from '@/components/ui/theme-mode-toggle';

/** 分类 → 中文显示名与图标映射,与 Rust ToolCategory 对齐 */
const CATEGORY_META: Record<ToolCategory, { label: string; icon: LucideIcon }> = {
  formatter: { label: '格式化', icon: Braces },
  encoder: { label: '编解码', icon: Binary },
  generator: { label: '生成器', icon: Wand2 },
  parser: { label: '解析器', icon: FileSearch },
  converter: { label: '转换器', icon: ArrowLeftRight },
  comparator: { label: '比较器', icon: GitCompare },
};

const CATEGORY_ORDER: ToolCategory[] = [
  'formatter',
  'encoder',
  'generator',
  'parser',
  'converter',
  'comparator',
];

export function SideNav(): JSX.Element {
  const tools = useToolStateStore((s) => s.availableTools);
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  const selectTool = useToolStateStore((s) => s.selectTool);
  /** 收集所有工具按钮元素,用于键盘上下导航 */
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** 侧栏搜索关键字 */
  const [query, setQuery] = useState('');

  /** 全量扁平化工具列表(按分类顺序),供键盘导航与搜索使用 */
  const flatTools = useMemo(() => {
    const grouped = new Map<ToolCategory, ToolMetadata[]>();
    for (const t of tools) {
      const list = grouped.get(t.category) ?? [];
      list.push(t);
      grouped.set(t.category, list);
    }
    return CATEGORY_ORDER.flatMap((c) => grouped.get(c) ?? []);
  }, [tools]);

  /** 按搜索关键字过滤后的扁平列表 */
  const filteredFlat = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatTools;
    return flatTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.join(' ').toLowerCase().includes(q),
    );
  }, [flatTools, query]);

  /** 按分类归集过滤后的工具,仅保留有结果的分类 */
  const groupedFiltered = useMemo(() => {
    const map = new Map<ToolCategory, ToolMetadata[]>();
    for (const t of filteredFlat) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return map;
  }, [filteredFlat]);

  /** toolId → 在 filteredFlat 中的索引,供键盘导航定位按钮 */
  const flatIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    filteredFlat.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [filteredFlat]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const next = (index + dir + filteredFlat.length) % filteredFlat.length;
    buttonRefs.current[next]?.focus();
  };

  return (
    <nav
      aria-label="工具导航"
      className="flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      {/* 品牌区:Logo + 名称 */}
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-3">
        {/* Logo 为透明背景,图形随 --logo-fg 主题变量自动反色 */}
        <Logo className="size-7 shrink-0" />
        <span className="text-sm font-semibold tracking-tight">Qraft</span>
      </div>

      {/* 搜索栏:DevToys 标志性组件,过滤工具列表 */}
      <div className="border-b border-sidebar-border p-3">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工具..."
            aria-label="搜索工具"
            className="h-9 pl-8"
          />
        </div>
      </div>

      {/* 工具列表滚动区 */}
      <ScrollArea className="flex-1">
        {filteredFlat.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            未找到匹配「{query}」的工具
          </p>
        ) : (
          <ul className="flex flex-col gap-4 p-2">
            {CATEGORY_ORDER.map((cat) => {
              const list = groupedFiltered.get(cat);
              if (!list || list.length === 0) return null;
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              return (
                <li key={cat}>
                  <h3 className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Icon aria-hidden className="size-3" />
                    {meta.label}
                  </h3>
                  <ul className="flex flex-col">
                    {list.map((t) => {
                      const idx = flatIndexMap.get(t.id) ?? 0;
                      const active = t.id === currentToolId;
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            ref={(el) => {
                              buttonRefs.current[idx] = el;
                            }}
                            aria-current={active ? 'true' : undefined}
                            onClick={() => selectTool(t.id)}
                            onKeyDown={(e) => handleKeyDown(e, idx)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-[12px] transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                              active
                                ? 'bg-sidebar-primary/15 font-medium text-sidebar-primary'
                                : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                            )}
                          >
                            <ToolIcon
                              name={t.icon}
                              fallback={Icon}
                              aria-hidden
                              className="size-4 shrink-0"
                            />
                            <span className="truncate">{t.name}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      {/* 侧栏底部:主题模式切换 */}
      <div className="border-t border-sidebar-border p-2">
        <ThemeModeToggle variant="sidebar" />
      </div>
    </nav>
  );
}

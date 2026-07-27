import { useMemo, useRef, type KeyboardEvent, type JSX } from 'react';
import {
  Braces,
  Binary,
  Wand2,
  FileSearch,
  ArrowLeftRight,
  GitCompare,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolCategory, ToolMetadata } from '@/types/tool';
import { ScrollArea } from '@/components/ui/scroll-area';
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

  const grouped = useMemo(() => {
    const map = new Map<ToolCategory, ToolMetadata[]>();
    for (const t of tools) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return map;
  }, [tools]);

  /** 扁平化所有工具,供键盘导航顺序遍历 */
  const flatTools = useMemo(() => {
    return CATEGORY_ORDER.flatMap((c) => grouped.get(c) ?? []);
  }, [grouped]);

  /** toolId → 在 flatTools 中的索引,供键盘导航定位按钮(避免渲染期 mutation) */
  const flatIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    flatTools.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [flatTools]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const next = (index + dir + flatTools.length) % flatTools.length;
    buttonRefs.current[next]?.focus();
  };

  return (
    <nav
      aria-label="工具导航"
      className="flex h-full w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      {/* 工具列表滚动区 */}
      <ScrollArea className="flex-1">
        <ul className="flex flex-col gap-4 p-2">
          {CATEGORY_ORDER.map((cat) => {
            const list = grouped.get(cat);
            if (!list || list.length === 0) return null;
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <li key={cat}>
                <h3 className="px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Icon aria-hidden className="h-3 w-3" />
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
                            'w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors',
                            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                            active &&
                              'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground',
                          )}
                        >
                          {t.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      {/* 侧栏底部:主题模式切换 */}
      <div className="border-t border-sidebar-border p-2">
        <ThemeModeToggle variant="sidebar" />
      </div>
    </nav>
  );
}

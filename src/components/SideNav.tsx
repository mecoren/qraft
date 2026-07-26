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

/** 分类 → 显示名与图标映射,与 Rust ToolCategory 对齐 */
const CATEGORY_META: Record<ToolCategory, { label: string; icon: LucideIcon }> = {
  formatter: { label: 'Formatter', icon: Braces },
  encoder: { label: 'Encoder', icon: Binary },
  generator: { label: 'Generator', icon: Wand2 },
  parser: { label: 'Parser', icon: FileSearch },
  converter: { label: 'Converter', icon: ArrowLeftRight },
  comparator: { label: 'Comparator', icon: GitCompare },
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

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const next = (index + dir + flatTools.length) % flatTools.length;
    buttonRefs.current[next]?.focus();
  };

  let flatIndex = -1;

  return (
    <nav
      aria-label="工具导航"
      className="h-full w-56 border-r border-border bg-card"
    >
      <ScrollArea className="h-full">
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
                    flatIndex += 1;
                    const idx = flatIndex;
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
                            'hover:bg-accent hover:text-accent-foreground',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
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
    </nav>
  );
}

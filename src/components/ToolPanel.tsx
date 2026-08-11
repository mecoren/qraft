import { createElement, type JSX } from 'react';
import { Star } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getCatalogEntry, type CatalogEntry } from '@/lib/tool-catalog';
import { useUiStore } from '@/store/uiStore';
import { getToolComponent } from '@/tools/registry';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';
import type { ToolMetadata, ToolCategory, Alert, AlertLevel } from '@/types/tool';

export interface ToolPanelProps {
  toolId: string;
  alerts?: Alert[];
}

const ALERT_STYLE: Record<AlertLevel, string> = {
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-destructive/10 text-destructive',
};

/** 目录分类 → Rust ToolCategory 映射(仅为兼容 ToolMetadata 类型) */
const CATEGORY_MAP: Record<CatalogEntry['category'], ToolCategory> = {
  encoder: 'encoder',
  tester: 'parser',
  formatter: 'formatter',
  generator: 'generator',
  graphic: 'converter',
  text: 'comparator',
  converter: 'converter',
};

/** 由目录条目构造 ToolPanel 工具组件所需的 ToolMetadata 兼容对象 */
export function catalogToMetadata(entry: CatalogEntry): ToolMetadata {
  return {
    id: entry.id,
    name: entry.name,
    category: CATEGORY_MAP[entry.category],
    icon: '',
    description: entry.description,
    input_schema: null,
    output_schema: null,
    tags: entry.keywords,
    version: '1.0.0',
    timeout_secs: null,
    streaming_supported: false,
  };
}

/**
 * 工具页 —— DevToys 风格:大标题 + 描述 + 右侧收藏切换,下方为工具工作区。
 */
export function ToolPanel({ toolId, alerts = [] }: ToolPanelProps): JSX.Element {
  const entry = getCatalogEntry(toolId);
  const isFavorite = useUiStore((s) => s.favorites.includes(toolId));
  const toggleFavorite = useUiStore((s) => s.toggleFavorite);
  // 小写命名 + createElement,明确表示从注册表查找组件类型并实例化,而非在渲染期创建新组件
  // 避免 React Compiler ESLint 规则 react-hooks/static-components 误报
  const toolComponent = getToolComponent(toolId);

  if (!entry) {
    return (
      <div role="status" className="flex items-center justify-center h-full text-muted-foreground">
        未找到工具
      </div>
    );
  }

  // 提取为局部变量,符合 JSX PascalCase 组件约定,避免 ESLint 误报
  const ToolIcon = entry.icon;

  return (
    <div className="flex h-full flex-col bg-background-layer">
      {/* 页头:图标盒 + 标题 + 描述 + 收藏切换(Dashboard 风格) */}
      <header className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-lg',
              'bg-primary/10 text-primary ring-1 ring-inset ring-primary/15',
            )}
          >
            <ToolIcon className="size-5" strokeWidth={ICON_STROKE_WIDTH} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">{entry.name}</h1>
            <p className="mt-0.5 text-body-sm text-muted-foreground">{entry.description}</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="toggle-favorite"
          aria-pressed={isFavorite}
          onClick={() => toggleFavorite(toolId)}
          className={cn(
            'mt-1 flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all duration-base ease-standard',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isFavorite
              ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
              : 'border-border bg-card/60 text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          <Star
            aria-hidden
            className={cn('size-3.5', isFavorite && 'fill-current')}
            strokeWidth={ICON_STROKE_WIDTH}
          />
          {isFavorite ? '已收藏' : '收藏'}
        </button>
      </header>

      {/* 工具工作区:由工具组件自行管理内部布局与滚动 */}
      <div className="min-h-0 flex-1 overflow-hidden px-6 pb-5">
        {toolComponent ? (
          createElement(toolComponent, { toolId, metadata: catalogToMetadata(entry) })
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            该工具界面尚未接入,敬请期待
          </div>
        )}
      </div>

      {/* 底部 alerts */}
      {alerts.length > 0 && (
        <>
          <Separator />
          <footer
            role="region"
            aria-label="工具警告"
            className="flex max-h-32 flex-col gap-1 overflow-auto p-2"
          >
            {alerts.map((a, i) => (
              <div
                key={i}
                role="alert"
                className={cn('rounded px-2 py-1 font-mono text-xs', ALERT_STYLE[a.level])}
              >
                [{a.level}] {a.message}
              </div>
            ))}
          </footer>
        </>
      )}
    </div>
  );
}

import { createElement, Suspense, useEffect, useState, type ComponentType, type JSX } from 'react';
import { Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { getCatalogEntry, pickText, type CatalogEntry } from '@/lib/tool-catalog';
import { MAX_KEEPALIVE_TOOLS, pushVisited } from '@/lib/keepalive';
import { getToolComponent, type ToolProps } from '@/tools/registry';
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
  editor: 'converter',
  text: 'comparator',
  converter: 'converter',
};

/** 由目录条目构造 ToolPanel 工具组件所需的 ToolMetadata 兼容对象 */
export function catalogToMetadata(entry: CatalogEntry): ToolMetadata {
  return {
    id: entry.id,
    name: pickText(entry.name),
    category: CATEGORY_MAP[entry.category],
    icon: '',
    description: pickText(entry.description),
    input_schema: null,
    output_schema: null,
    tags: entry.keywords,
    version: '1.0.0',
    timeout_secs: null,
    streaming_supported: false,
  };
}

/**
 * 工具页 —— 顶部标题区已迁移至 Titlebar 左段,此组件直接渲染工具工作区。
 */
export function ToolPanel({ toolId, alerts = [] }: ToolPanelProps): JSX.Element {
  const entry = getCatalogEntry(toolId);

  // 工具级 keepalive:记录已访问过的工具 id,全部保持挂载,切换工具时仅切换显隐。
  // 工具组件内部的本地 state(输入/输出/选项)与滚动位置随 DOM 保留,切走再切回不丢失。
  const [visited, setVisited] = useState<string[]>(() => (toolId ? [toolId] : []));
  useEffect(() => {
    if (!toolId) return;
    // 在异步回调内更新,避免在 effect 同步体内 setState 触发的级联渲染 lint 错误
    const id = toolId;
    const h = setTimeout(() => {
      // LRU 容量上限:超出 MAX_KEEPALIVE_TOOLS 时淘汰最久未访问的工具(真卸载,
      // 触发其 Monaco 实例 dispose),防止长会话内存无界增长
      setVisited((v) => pushVisited(v, id, MAX_KEEPALIVE_TOOLS));
    }, 0);
    return () => clearTimeout(h);
  }, [toolId]);

  if (!entry) {
    return (
      <div role="status" className="flex items-center justify-center h-full text-muted-foreground">
        未找到工具
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background-layer">
      {/* 工具工作区:由工具组件自行管理内部布局与滚动。
       * 遍历所有已访问工具,当前工具显示、其余 display:none(DOM 不卸载,内容/滚动保留)。
       * 工具组件为懒加载(React.lazy):首次访问时经 Suspense 展示加载态,
       * 模块加载完成后缓存,再次切回无需重新请求 chunk。 */}
      <div className="min-h-0 flex-1 overflow-hidden px-3 pt-2 pb-3">
        {visited.map((id) => {
          const visitedEntry = getCatalogEntry(id);
          // 小写命名 + createElement,明确表示从注册表查找组件类型并实例化,而非在渲染期创建新组件
          // 避免 React Compiler ESLint 规则 react-hooks/static-components 误报
          const visitedComponent = getToolComponent(id);
          return (
            <div key={id} data-tool-id={id} className={cn('h-full', id !== toolId && 'hidden')}>
              {visitedEntry && visitedComponent ? (
                <Suspense
                  fallback={
                    <div
                      role="status"
                      className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground"
                    >
                      {/* 与 font-picker / IpParser 的加载态同一视觉语言:Loader2 + animate-spin */}
                      <Loader2 aria-hidden className="size-4 animate-spin" />
                      加载工具…
                    </div>
                  }
                >
                  {createElement(visitedComponent as ComponentType<ToolProps>, {
                    toolId: id,
                    metadata: catalogToMetadata(visitedEntry),
                  })}
                </Suspense>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  该工具界面尚未接入,敬请期待
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部 alerts */}
      {alerts.length > 0 && (
        <>
          <Separator />
          <footer role="region" aria-label="工具警告" className="max-h-32">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-1 p-2">
                {alerts.map((a, i) => (
                  <div
                    key={i}
                    role="alert"
                    className={cn('rounded px-2 py-1 font-mono text-xs', ALERT_STYLE[a.level])}
                  >
                    [{a.level}] {a.message}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </footer>
        </>
      )}
    </div>
  );
}

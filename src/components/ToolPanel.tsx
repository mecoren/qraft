import { createElement, type JSX } from 'react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useToolStateStore } from '@/store/toolStateStore';
import { getToolComponent } from '@/tools/registry';
import type { Alert, AlertLevel } from '@/types/tool';

export interface ToolPanelProps {
  toolId: string;
  alerts?: Alert[];
}

const ALERT_STYLE: Record<AlertLevel, string> = {
  info: 'bg-blue-500/10 text-blue-500',
  warning: 'bg-yellow-500/10 text-yellow-500',
  error: 'bg-destructive/10 text-destructive',
};

export function ToolPanel({ toolId, alerts = [] }: ToolPanelProps): JSX.Element {
  const metadata = useToolStateStore((s) => s.availableTools.find((t) => t.id === toolId) ?? null);
  // 小写命名 + createElement,明确表示从注册表查找组件类型并实例化,而非在渲染期创建新组件
  // 避免 React Compiler ESLint 规则 react-hooks/static-components 误报
  const toolComponent = getToolComponent(toolId);

  if (!metadata) {
    return (
      <div role="status" className="flex items-center justify-center h-full text-muted-foreground">
        未找到工具
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部工具栏 */}
      <header className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <h2 className="text-sm font-semibold flex-1">{metadata.name}</h2>
      </header>

      {/* 工具 UI:按 toolId 从注册表取真实组件渲染 */}
      <div className="flex-1 min-h-0 p-4 overflow-auto">
        {toolComponent
          ? createElement(toolComponent, { toolId, metadata })
          : (
            <div className="text-xs text-muted-foreground">
              该工具后端已注册,但前端暂无对应 UI 组件
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
            className="flex flex-col gap-1 p-2 max-h-32 overflow-auto"
          >
            {alerts.map((a, i) => (
              <div
                key={i}
                role="alert"
                className={cn('text-xs px-2 py-1 rounded font-mono', ALERT_STYLE[a.level])}
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

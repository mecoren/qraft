/**
 * 管理扩展页
 *
 * 展示当前内置工具(作为内置扩展)的分组清单与数量统计,
 * 并说明第三方扩展机制的状态。第三方扩展加载属于后续规划,
 * 页面如实标注,不伪装可用功能。
 */

import { useMemo, type JSX } from 'react';
import { Puzzle } from 'lucide-react';
import { CATALOG_CATEGORIES, TOOL_ONLY_CATALOG, groupCatalogByCategory } from '@/lib/tool-catalog';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ExtensionsPage(): JSX.Element {
  const grouped = useMemo(() => groupCatalogByCategory(TOOL_ONLY_CATALOG), []);

  return (
    <div className="h-full bg-background-layer">
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <header className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-card">
              <Puzzle aria-hidden className="size-5" strokeWidth={ICON_STROKE_WIDTH} />
            </span>
            <div>
              <h1 className="text-xl font-semibold leading-tight">管理扩展</h1>
              <p className="mt-0.5 text-body-sm text-muted-foreground">
                在 Qraft 中添加和管理第三方扩展
              </p>
            </div>
          </header>

          <section
            className="mt-6 rounded-lg border border-border bg-card p-4 shadow-card"
            data-search-anchor="extensions:builtin"
          >
            <h2 className="text-sm font-semibold">内置扩展</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              共 {TOOL_ONLY_CATALOG.length} 个工具,按分类分组如下。
            </p>
            <ul className="mt-3 flex flex-col divide-y divide-border">
              {CATALOG_CATEGORIES.map((cat) => {
                const tools = grouped.get(cat.id) ?? [];
                if (tools.length === 0) return null;
                const Icon = cat.icon;
                return (
                  <li key={cat.id} className="flex items-center gap-3 py-2.5">
                    <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-body-sm">{cat.label}</span>
                    <span className="text-xs text-muted-foreground">{tools.length} 个工具</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section
            className="mt-4 rounded-lg border border-dashed border-border p-4"
            data-search-anchor="extensions:third-party"
          >
            <h2 className="text-sm font-semibold">第三方扩展</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              第三方扩展机制(从磁盘加载自定义工具包)正在规划中。当前版本仅提供内置工具,
              全部离线运行,不访问网络。
            </p>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

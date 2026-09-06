/**
 * PathBreadcrumb —— 路径面包屑(编辑器工具栏标题)
 *
 * 将本地文件绝对路径按平台分隔符(/ 与 \\)拆分为多段,
 * 用 shadcn Breadcrumb 组件渲染,末段为当前页(不可点击),
 * 前段为面包屑项(hover 高亮)。
 *
 * 路径拆分明细:
 * - Windows 路径如 C:\Users\wait\Downloads\PTS…重置轨道.md 拆为
 *   ["C:", "Users", "wait", "Downloads", "PTS…重置轨道.md"]
 * - POSIX 路径如 /home/user/foo.md 拆为 ["home", "user", "foo.md"]
 * - 空字符串(untitled 文件,未保存)返回 null,不渲染
 *
 * 设计取舍:
 * - 每段单独 <li> + title=完整路径片段(超长时被原生 tooltip 展示)
 * - 段间分隔符用默认 ChevronRight,与 VSCode 资源管理器面包屑视觉接近
 * - 不做点击跳转(本应用无文件系统路由器);末段保持不可点击
 *   与面包屑的「当前项」语义一致
 * - 单行渲染(flex-nowrap 覆盖 BreadcrumbList 默认 flex-wrap):宿主工具栏
 *   高度固定 26px,换行内容会溢出遮盖 Tab 栏;窄屏下由各段 min-w-0 +
 *   truncate 收缩省略,保证始终单行
 */
import { Fragment, type JSX } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export interface PathBreadcrumbProps {
  /** 完整绝对路径;空值(untitled)时不渲染 */
  path: string;
  /** 测试定位用 */
  'data-testid'?: string;
}

/** 按平台分隔符拆分路径,空段过滤 */
function splitPath(path: string): string[] {
  return path
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function PathBreadcrumb({
  path,
  'data-testid': dataTestId,
}: PathBreadcrumbProps): JSX.Element | null {
  const segments = splitPath(path);
  if (segments.length === 0) return null;

  return (
    <Breadcrumb data-testid={dataTestId}>
      {/* 工具栏 breadcrumb 使用 text-xs(font-size 与编辑器 Tab 栏、CodeEditor
       * 工具栏标题保持一致),与 CodeEditor 的 title span(text-xs font-medium)字号字重
       * 一致,保证编辑器内所有标题类文字视觉一致 */}
      {/* flex-nowrap 覆盖 BreadcrumbList 默认的 flex-wrap:工具栏高度固定 26px,
       * 换行会溢出工具栏画到上方 Tab 栏(小屏长路径必现);改单行后超宽由
       * 各段 min-w-0 + truncate 收缩省略 */}
      <BreadcrumbList className="text-xs flex-nowrap">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            // Item + Separator 都作为 <ol> 的直接子节点(同层 <li>),
            // shadcn 标准结构;不可再用 <BreadcrumbItem> 包 Separator
            // (会形成 <li> 嵌套 <li> 的 HTML 错误)
            <Fragment key={`${index}-${segment}`}>
              <BreadcrumbItem className="min-w-0">
                {isLast ? (
                  <BreadcrumbPage title={segment} className="min-w-0 truncate font-medium text-foreground">
                    {segment}
                  </BreadcrumbPage>
                ) : (
                  <span
                    title={segment}
                    className="min-w-0 truncate font-medium text-muted-foreground transition-colors hover:text-foreground"
                    data-testid={`${dataTestId}-segment-${index}`}
                  >
                    {segment}
                  </span>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator className="shrink-0" />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

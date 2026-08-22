/**
 * 文件图标组件 —— 按 文件路径 渲染 Material Icon Theme 图标
 *
 * 用于编辑器 Tab、左栏「打开的编辑器」等位置,替代统一的
 * lucide FileText 图标,让不同类型文件呈现各自的图标(仿 VSCode)。
 */
import { cn } from '@/lib/utils';
import { getFileIconName, getFileIconSrc } from './fileIcons';

export function FileIcon({
  path,
  className,
}: {
  /** 文件路径;未保存到磁盘的新建 Tab 为 null,渲染兜底图标 */
  path: string | null | undefined;
  /** 覆盖默认尺寸(size-3.5),与相邻文字/图标对齐 */
  className?: string;
}) {
  return (
    <img
      src={getFileIconSrc(getFileIconName(path))}
      alt=""
      // 装饰性图标:文件名本身已可访问,避免读屏重复播报
      aria-hidden="true"
      draggable={false}
      className={cn('size-3.5 shrink-0 object-contain', className)}
    />
  );
}

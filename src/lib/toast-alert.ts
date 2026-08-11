/**
 * 全局提示 alert —— 基于 sonner 统一封装。
 *
 * 视觉风格与 shadcn Alert 对齐(图标 + 标题 + 描述双行)。
 * 旧 `toast.success('msg')` 这类调用无需迁移,继续可用;
 * 新代码或需要更清晰信息的场景推荐使用本封装,传入 title + description。
 */
import { toast } from 'sonner';

export type AlertVariant = 'default' | 'info' | 'success' | 'warning' | 'destructive';

export interface ShowAlertOptions {
  /** 标题(粗体一行) */
  title: string;
  /** 描述(灰色一行);可省略 */
  description?: string;
  /** 视觉变体,默认 info;错误请用 destructive */
  variant?: AlertVariant;
  /** 自动关闭毫秒数,默认 4000 */
  duration?: number;
}

/** 显示一条全局提示,风格对齐 shadcn Alert */
export function showAlert(opts: ShowAlertOptions): string | number {
  const { title, description, variant = 'info', duration = 4000 } = opts;
  const payload = description ? { description } : undefined;
  switch (variant) {
    case 'destructive':
      return toast.error(title, { description: payload?.description, duration });
    case 'success':
      return toast.success(title, { description: payload?.description, duration });
    case 'warning':
      return toast.warning(title, { description: payload?.description, duration });
    case 'default':
    case 'info':
    default:
      return toast(title, { description: payload?.description, duration });
  }
}
/**
 * 全局提示 alert —— 基于 sonner 统一封装。
 *
 * 视觉风格与 shadcn Alert 对齐(图标 + 标题 + 描述双行)。
 * 旧 `toast.success('msg')` 这类调用无需迁移,继续可用;
 * 新代码或需要更清晰信息的场景推荐使用本封装,传入 title + description。
 */
import { toast } from 'sonner';
import { writeClipboardText } from '@/lib/clipboard';

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

/**
 * 复制文本到剪贴板并给出统一反馈。
 *
 * 背景:历史上复制反馈存在三种范式(CopyAction 弹 toast / 裸 writeText 静默 /
 * 各自 toast.success 文案不一),用户无法建立一致的认知模型。此 helper 收敛为
 * 唯一实现:成功展示「已复制到剪贴板」+ 内容预览(>80 字符截断),失败明确报错。
 * CopyAction 与各工具页的复制按钮均应经由它实现。
 */
export async function copyTextWithFeedback(text: string): Promise<boolean> {
  if (!text) return false;
  const ok = await writeClipboardText(text);
  if (ok) {
    showAlert({
      variant: 'success',
      title: '已复制到剪贴板',
      description: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    });
  } else {
    showAlert({ variant: 'destructive', title: '复制失败' });
  }
  return ok;
}

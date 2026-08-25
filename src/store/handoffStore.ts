/**
 * 跨工具传值信令 store(「发送到…」功能的通道)。
 *
 * keepalive 架构下目标工具可能早已挂载、props 永不更新,故不走路由参数;
 * 发送方写入 pending,接收方在自己成为激活工具时消费。
 * 参照 searchStore 的 requestJump/consume 单次消费语义。
 */
import { create } from 'zustand';

interface HandoffState {
  /** 待投递载荷;null 表示无 */
  pending: { toolId: string; text: string } | null;
}

export const useHandoffStore = create<HandoffState>()(() => ({
  pending: null,
}));

/** 把文本投递给目标工具(覆盖未消费的旧载荷) */
export function requestHandoff(toolId: string, text: string): void {
  useHandoffStore.setState({ pending: { toolId, text } });
}

/** 查看(不清除)发往 toolId 的载荷 */
export function peekHandoff(toolId: string): string | null {
  const p = useHandoffStore.getState().pending;
  return p && p.toolId === toolId ? p.text : null;
}

/** 取走发往 toolId 的载荷(单次消费语义) */
export function consumeHandoff(toolId: string): string | null {
  const p = useHandoffStore.getState().pending;
  if (!p || p.toolId !== toolId) return null;
  useHandoffStore.setState({ pending: null });
  return p.text;
}

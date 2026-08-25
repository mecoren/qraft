/**
 * 接收「发送到…」的跨工具文本:当本工具是激活工具且 handoff 有匹配载荷时,
 * 用 apply 注入工具输入并消费载荷(latest-ref 保证 apply 总是新闭包)。
 */
import { useEffect, useRef } from 'react';
import { consumeHandoff } from '@/store/handoffStore';
import { useToolStateStore } from '@/store/toolStateStore';

export function useToolHandoff(toolId: string, apply: (text: string) => void): void {
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });

  const currentToolId = useToolStateStore((s) => s.currentToolId);

  useEffect(() => {
    if (currentToolId !== toolId) return;
    const text = consumeHandoff(toolId);
    if (text !== null) applyRef.current(text);
  }, [currentToolId, toolId]);
}

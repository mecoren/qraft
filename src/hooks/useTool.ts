import { useCallback, useEffect, useRef, useState } from 'react';
import { useToolStateStore } from '@/store/toolStateStore';
import type { ToolMetadata, ToolInput, ToolOutput, ToolError, Alert } from '@/types/tool';

export interface UseToolResult {
  metadata: ToolMetadata | null;
  isRunning: boolean;
  result: ToolOutput | null;
  error: ToolError | null;
  alerts: Alert[];
  execute: (input: ToolInput) => Promise<void>;
  executeStream: (filePath: string) => Promise<void>;
  reset: () => void;
}

/**
 * 工具执行 Hook:绑定单个工具的生命周期。
 * 组件卸载时若有未完成流式任务,自动调用 tool_cancel 取消。
 */
export function useTool(toolId: string): UseToolResult {
  // 使用 Map 索引而非 availableTools.find,返回的是构建后稳定的对象引用,
  // 避免 store 任意更新都触发 find 返回新数组元素引用导致的无效重渲染。
  const metadata = useToolStateStore((s) => s.toolMetadataById.get(toolId) ?? null);
  const running = useToolStateStore((s) => s.running);
  const executeTool = useToolStateStore((s) => s.executeTool);
  const executeStreamAction = useToolStateStore((s) => s.executeStream);
  const cancelTask = useToolStateStore((s) => s.cancelTask);

  const [result, setResult] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  /** 当前流式任务 ID,卸载时取消 */
  const taskIdRef = useRef<string | null>(null);

  const execute = useCallback(
    async (input: ToolInput) => {
      setError(null);
      setAlerts([]);
      const r = await executeTool({ toolId, input });
      if (r.ok) {
        setResult(r.value);
        setAlerts(r.value.alerts ?? []);
      } else {
        setResult(null);
        setError(r.error);
      }
    },
    [toolId, executeTool],
  );

  const executeStream = useCallback(
    async (filePath: string) => {
      setError(null);
      setAlerts([]);
      const r = await executeStreamAction(toolId, filePath);
      if (r.ok) {
        taskIdRef.current = r.value;
      } else {
        setError(r.error);
      }
    },
    [toolId, executeStreamAction],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setAlerts([]);
  }, []);

  // 卸载时取消未完成任务,避免 Rust 侧空跑
  useEffect(() => {
    return () => {
      if (taskIdRef.current) {
        void cancelTask(taskIdRef.current);
        taskIdRef.current = null;
      }
    };
  }, [cancelTask]);

  return {
    metadata,
    isRunning: running,
    result,
    error,
    alerts,
    execute,
    executeStream,
    reset,
  };
}

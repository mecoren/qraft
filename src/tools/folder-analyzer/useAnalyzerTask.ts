/**
 * folder_analyzer 流式任务的本地状态机(idle/running/done/failed)。
 * 不接入全局 toolStateStore:任务生命周期完全属于当前工具面板。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import {
  cancelAnalyzerTask,
  runFileInspect,
  startAnalyzerTask,
  subscribeTaskEvents,
  type StartArgs,
} from './analyzerApi';

export interface AnalyzerTaskState {
  status: 'idle' | 'running' | 'done' | 'failed';
  processed: number;
  message: string;
  result: unknown;
  error: string | null;
}

const INITIAL: AnalyzerTaskState = {
  status: 'idle',
  processed: 0,
  message: '',
  result: null,
  error: null,
};

export function useAnalyzerTask(): {
  state: AnalyzerTaskState;
  run: (args: StartArgs) => Promise<void>;
  cancel: () => Promise<void>;
} {
  const [state, setState] = useState<AnalyzerTaskState>(INITIAL);
  const taskIdRef = useRef<string | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => disposeRef.current?.(), []);

  const run = useCallback(async (args: StartArgs) => {
    disposeRef.current?.();
    setState({ ...INITIAL, status: 'running' });
    // 单文件解析:同步 tool_execute 一次往返即完成,不走流式任务
    if (args.mode === 'file') {
      const r = await runFileInspect(args.filePath);
      if (!r.ok) {
        setState({ ...INITIAL, status: 'failed', error: `${r.error.code}: ${r.error.message}` });
      } else {
        setState({ ...INITIAL, status: 'done', result: r.value });
      }
      return;
    }
    const r = await startAnalyzerTask(args);
    if (!r.ok) {
      setState({ ...INITIAL, status: 'failed', error: `${r.error.code}: ${r.error.message}` });
      return;
    }
    taskIdRef.current = r.value;
    disposeRef.current = await subscribeTaskEvents(r.value, {
      onProgress: (p) =>
        setState((s) =>
          s.status === 'running' ? { ...s, processed: p.processed, message: p.message } : s,
        ),
      onDone: (output) =>
        setState((s) => {
          if (s.status !== 'running') return s;
          const extra = (output as { extra?: unknown } | null)?.extra ?? null;
          return { ...INITIAL, status: 'done', result: extra };
        }),
      onFailed: (error) =>
        setState((s) => {
          if (s.status !== 'running') return s;
          const info = error as { message?: string; detail?: string } | undefined;
          return {
            ...INITIAL,
            status: 'failed',
            error: info?.message ?? info?.detail ?? t('tools.folder_analyzer.error_task_failed'),
          };
        }),
    });
  }, []);

  const cancel = useCallback(async () => {
    const id = taskIdRef.current;
    if (!id) return;
    await cancelAnalyzerTask(id);
  }, []);

  return { state, run, cancel };
}

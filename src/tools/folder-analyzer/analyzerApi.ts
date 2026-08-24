/**
 * folder_analyzer 的 IPC 服务层:选择器 / 拖放授权 / 流式任务启停与事件订阅。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand, safeInvoke, type Result } from '@/lib/ipc';
import type { ErrorInfo } from '@/types/ipc';
import type { AnalyzerMode } from './types';

const TOOL_ID = 'folder_analyzer';

export interface DroppedEntry {
  path: string;
  kind: 'dir' | 'file';
}

/** fs_open_folder_dialog 返回 { path } 对象(Rust OpenFolderResult);取消返回 null */
export async function pickFolder(): Promise<string | null> {
  const r = await invokeCommand<{ path: string } | null>('fs_open_folder_dialog', {});
  return r?.path ?? null;
}

/** fs_open_dialog 返回对象含 path 字段;取消返回 null */
export async function pickFilePath(): Promise<string | null> {
  const r = await invokeCommand<{ path: string } | null>('fs_open_dialog', {});
  return r?.path ?? null;
}

export async function authorizeDropped(paths: string[]): Promise<DroppedEntry[]> {
  const kinds = await invokeCommand<Array<{ path: string; kind: string }>>(
    'fs_authorize_dropped_paths',
    { paths },
  );
  return kinds.filter((k): k is DroppedEntry => k.kind === 'dir' || k.kind === 'file');
}

/** 拖放路径 → 授权 → 返回首条有效条目;多条目只取第一条(UI 单目标) */
export async function routeDropped(paths: string[]): Promise<DroppedEntry | null> {
  const entries = await authorizeDropped(paths);
  return entries[0] ?? null;
}

export interface StartArgs {
  filePath: string;
  mode: AnalyzerMode;
  options?: Record<string, unknown>;
  searchText?: string;
}

export function startAnalyzerTask(args: StartArgs): Promise<Result<string, ErrorInfo>> {
  return safeInvoke<string>('tool_execute_stream', {
    toolId: TOOL_ID,
    filePath: args.filePath,
    text: args.searchText,
    params: { mode: args.mode, ...(args.options ?? {}) },
  });
}

/**
 * 单文件解析走同步 tool_execute:
 * 流式端点(tool_execute_stream)仅支持 scan/search,
 * file 模式发过去会被 Rust 端以 InvalidInput 拒绝。
 */
export async function runFileInspect(filePath: string): Promise<Result<unknown, ErrorInfo>> {
  const r = await safeInvoke<{ extra?: unknown } | null>('tool_execute', {
    toolId: TOOL_ID,
    input: { file_path: filePath, params: { mode: 'file' } },
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value?.extra ?? null };
}

export async function cancelAnalyzerTask(taskId: string): Promise<void> {
  await safeInvoke<boolean>('tool_cancel', { taskId });
}

export interface TaskHandlers {
  onProgress?(p: { processed: number; total: number; message: string }): void;
  onDone?(output: unknown): void;
  onFailed?(error: unknown): void;
}

interface TaggedPayload {
  payload: Record<string, unknown>;
}

function unwrap(e: unknown): Record<string, unknown> {
  return (e as TaggedPayload).payload ?? {};
}

export async function subscribeTaskEvents(
  taskId: string,
  handlers: TaskHandlers,
): Promise<() => void> {
  const offs: UnlistenFn[] = [];
  offs.push(
    await listen<TaggedPayload>('tool_progress', (e) => {
      const p = unwrap(e);
      if (p.taskId !== taskId) return;
      handlers.onProgress?.({
        processed: Number(p.processed ?? 0),
        total: Number(p.total ?? 0),
        message: String(p.message ?? ''),
      });
    }),
  );
  offs.push(
    await listen<TaggedPayload>('tool_completed', (e) => {
      const p = unwrap(e);
      if (p.taskId !== taskId) return;
      handlers.onDone?.(p.output);
    }),
  );
  offs.push(
    await listen<TaggedPayload>('tool_failed', (e) => {
      const p = unwrap(e);
      if (p.taskId !== taskId) return;
      handlers.onFailed?.(p.error);
    }),
  );
  return () => offs.forEach((off) => off());
}

import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import type {
  ToolMetadata,
  ToolInput,
  ToolOutput,
  ToolError,
} from '@/types/tool';
import type {
  ToolProgressPayload,
  ToolChunkPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from '@/types/ipc';
import type { ErrorInfo } from '@/types/ipc';

/** 流式任务运行时状态 */
export interface StreamingTaskState {
  taskId: string;
  toolId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  processed: number;
  total: number;
  chunks: string;
  output?: ToolOutput;
  error?: ToolError;
}

interface ExecuteArgs {
  toolId: string;
  input: ToolInput;
}

interface ToolState {
  availableTools: ToolMetadata[];
  currentToolId: string | null;
  running: boolean;
  streamingTasks: Map<string, StreamingTaskState>;

  loadTools: () => Promise<void>;
  selectTool: (id: string | null) => void;
  executeTool: (args: ExecuteArgs) => Promise<{ ok: true; value: ToolOutput } | { ok: false; error: ErrorInfo }>;
  executeStream: (toolId: string, filePath: string) => Promise<{ ok: true; value: string } | { ok: false; error: ErrorInfo }>;
  cancelTask: (taskId: string) => Promise<void>;
  applyToolProgress: (p: ToolProgressPayload) => void;
  applyToolChunk: (p: ToolChunkPayload) => void;
  applyToolCompleted: (p: ToolCompletedPayload) => void;
  applyToolFailed: (p: ToolFailedPayload) => void;
}

export const useToolStateStore = create<ToolState>((set) => ({
  availableTools: [],
  currentToolId: null,
  running: false,
  streamingTasks: new Map(),

  loadTools: async () => {
    const r = await safeInvoke<ToolMetadata[]>('tool_list');
    if (r.ok) {
      set({ availableTools: r.value });
    }
    // 失败时不抛,UI 依赖 availableTools 长度即可判断
  },

  selectTool: (id) => set({ currentToolId: id }),

  executeTool: async ({ toolId, input }) => {
    set({ running: true });
    const r = await safeInvoke<ToolOutput>('tool_execute', { toolId, input });
    set({ running: false });
    return r;
  },

  executeStream: async (toolId, filePath) => {
    // 启动流式执行,Rust 返回任务 ID;后续通过事件接收进度与 chunk
    const r = await safeInvoke<string>('tool_execute_stream', { toolId, filePath });
    if (r.ok) {
      const task: StreamingTaskState = {
        taskId: r.value,
        toolId,
        status: 'running',
        processed: 0,
        total: 0,
        chunks: '',
      };
      set((s) => {
        const next = new Map(s.streamingTasks);
        next.set(r.value, task);
        return { streamingTasks: next };
      });
    }
    return r;
  },

  cancelTask: async (taskId) => {
    await safeInvoke<boolean>('tool_cancel', { taskId });
    set((s) => {
      const next = new Map(s.streamingTasks);
      const t = next.get(taskId);
      if (t) next.set(taskId, { ...t, status: 'cancelled' });
      return { streamingTasks: next };
    });
  },

  applyToolProgress: (p) => {
    set((s) => {
      const next = new Map(s.streamingTasks);
      const existing = next.get(p.taskId);
      if (existing) {
        next.set(p.taskId, {
          ...existing,
          processed: p.processed,
          total: p.total,
          status: 'running',
        });
      } else {
        // 进度事件先于 createStream 返回到达,创建占位
        next.set(p.taskId, {
          taskId: p.taskId,
          toolId: '',
          status: 'running',
          processed: p.processed,
          total: p.total,
          chunks: '',
        });
      }
      return { streamingTasks: next };
    });
  },

  applyToolChunk: (p) => {
    set((s) => {
      const next = new Map(s.streamingTasks);
      const existing = next.get(p.taskId);
      if (existing) {
        next.set(p.taskId, {
          ...existing,
          chunks: existing.chunks + p.text,
          status: 'running',
        });
      }
      return { streamingTasks: next };
    });
  },

  applyToolCompleted: (p) => {
    set((s) => {
      const next = new Map(s.streamingTasks);
      const existing = next.get(p.taskId);
      if (existing) {
        next.set(p.taskId, { ...existing, status: 'completed', output: p.output });
      }
      return { streamingTasks: next };
    });
  },

  applyToolFailed: (p) => {
    set((s) => {
      const next = new Map(s.streamingTasks);
      const existing = next.get(p.taskId);
      if (existing) {
        next.set(p.taskId, { ...existing, status: 'failed', error: p.error });
      }
      return { streamingTasks: next };
    });
  },
}));

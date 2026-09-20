/**
 * 哈希 / 校验和生成器 —— 新代统一布局
 *
 * 结构(与 Base64Codec / JsonFormatter 一致):
 * - 顶部「配置」卡片:算法选择(MD5 ~ BLAKE3)+ 文本/文件模式分段切换
 * - 下方 ResizablePanelGroup 双栏工作区:
 *   - 文本模式:左 = 输入编辑器;右 = 哈希值输出
 *   - 文件模式:左 = 文件拖放/选择区(流式进度 + 取消);右 = 哈希值输出
 *
 * 文件哈希走流式任务(tool_execute_stream):64KB 块增量计算,GB 级文件
 * 内存占用恒定;进度经 tool_progress 事件回传,取消经 tool_cancel。
 * 错误处理遵循新代约定:工具内联 alert 展示于结果区。
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { FileDown, Play, ShieldCheck, Square } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { formatError } from '@/lib/format-error';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { invokeCommand, safeInvoke } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { SendToMenu } from '@/components/send-to-menu';
import { formatBytes } from '@/lib/file-utils';
import { isTauriRuntime } from '@/lib/popout-window';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512' | 'blake3';
type HashMode = 'text' | 'file';

interface HashParams {
  algorithm: HashAlgorithm;
}

/** fs_pick_file_path 返回载荷(Rust PickedFileMeta 的 camelCase 形态) */
interface PickedFileMeta {
  path: string;
  size: number;
}

/** 文件哈希流式任务的本地状态机(不接全局 toolStateStore:生命周期属于本面板) */
interface FileHashState {
  status: 'idle' | 'running' | 'done' | 'failed';
  percent: number;
  processed: number;
  total: number;
  result: ToolOutput | null;
  error: string | null;
}

const FILE_INITIAL: FileHashState = {
  status: 'idle',
  percent: 0,
  processed: 0,
  total: 0,
  result: null,
  error: null,
};

const ALGORITHM_OPTIONS: ReadonlyArray<{ value: HashAlgorithm; label: string }> = [
  { value: 'md5', label: 'MD5' },
  { value: 'sha1', label: 'SHA-1' },
  { value: 'sha256', label: 'SHA-256' },
  { value: 'sha512', label: 'SHA-512' },
  { value: 'blake3', label: 'BLAKE3' },
];

export function HashCalculator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>('sha256');
  const [mode, setMode] = useState<HashMode>('text');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // —— 文件模式 ——
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [fileState, setFileState] = useState<FileHashState>(FILE_INITIAL);
  const [dragOver, setDragOver] = useState(false);
  const taskIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const clearFileState = useCallback(() => {
    setFileState(FILE_INITIAL);
  }, []);

  // 组件卸载:取消未完成流式任务并解除事件订阅(避免 Rust 侧空跑)
  useEffect(
    () => () => {
      unlistenRef.current?.();
      if (taskIdRef.current) {
        void safeInvoke('tool_cancel', { taskId: taskIdRef.current });
      }
    },
    [],
  );

  async function handleCompute() {
    setLoading(true);
    setError(null);
    try {
      const params: HashParams = { algorithm };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params },
      });
      setOutput(result);
    } catch (e) {
      setOutput(null);
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }

  /**
   * 启动文件哈希流式任务:订阅进度/完成/失败事件(Rust 侧已完成授权校验,
   * 64KB 块增量哈希,事件经 tool_progress / tool_completed / tool_failed 推送)。
   */
  const runFileHash = useCallback(
    async (path: string, algo: HashAlgorithm) => {
      unlistenRef.current?.();
      taskIdRef.current = null;
      setFileState({ ...FILE_INITIAL, status: 'running' });

      const r = await safeInvoke<string>('tool_execute_stream', {
        toolId,
        filePath: path,
        text: undefined,
        params: { algorithm: algo },
      });
      if (!r.ok) {
        setFileState({
          ...FILE_INITIAL,
          status: 'failed',
          error: `${r.error.code}: ${r.error.message}`,
        });
        return;
      }
      const taskId = r.value;
      taskIdRef.current = taskId;

      const offs: UnlistenFn[] = [];
      const handle = (off: UnlistenFn) => {
        offs.push(off);
        unlistenRef.current = () => offs.forEach((f) => f());
      };
      // listen 回调收 { payload } 信封(@tauri-apps/api/event 契约)
      handle(
        await listen<{ taskId: string; percent: number; processed: number; total: number }>(
          'tool_progress',
          (e) => {
            const p = e.payload;
            if (p.taskId !== taskId) return;
            setFileState((s) =>
              s.status === 'running'
                ? { ...s, percent: p.percent, processed: p.processed, total: p.total }
                : s,
            );
          },
        ),
      );
      handle(
        await listen<{ taskId: string; output: ToolOutput }>('tool_completed', (e) => {
          if (e.payload.taskId !== taskId) return;
          setFileState((s) =>
            s.status === 'running' ? { ...s, status: 'done', result: e.payload.output } : s,
          );
        }),
      );
      handle(
        await listen<{ taskId: string; error: { message?: string; code?: string } }>(
          'tool_failed',
          (e) => {
            if (e.payload.taskId !== taskId) return;
            const err = e.payload.error;
            setFileState((s) =>
              s.status === 'running'
                ? {
                    ...s,
                    status: 'failed',
                    error: err?.message ?? `${err?.code ?? 'ERR_INTERNAL'}`,
                  }
                : s,
            );
          },
        ),
      );
    },
    [toolId],
  );

  /** 中止进行中的文件哈希;已完成的任务在 Rust 侧已注销,取消报错按静默处理 */
  const cancelFileHash = useCallback(async () => {
    const id = taskIdRef.current;
    if (!id) return;
    try {
      await invokeCommand<boolean>('tool_cancel', { taskId: id });
    } catch {
      // 任务已结束(完成/失败时 Rust 已注销):无副作用,忽略
    }
  }, []);

  /** 选择文件对话框(fs_pick_file_path:只授权并返回路径,不读内容) */
  const handlePickFile = useCallback(async () => {
    const meta = await invokeCommand<PickedFileMeta | null>('fs_pick_file_path', {});
    if (!meta) return;
    setFilePath(meta.path);
    setFileSize(meta.size);
    clearFileState();
    void runFileHash(meta.path, algorithm);
  }, [algorithm, clearFileState, runFileHash]);

  // 换算法即按新口径重算(文件已加载时);文本模式按「计算」按钮显式触发
  const handleAlgorithmChange = useCallback(
    (v: string) => {
      const next = v as HashAlgorithm;
      setAlgorithm(next);
      if (mode === 'file' && filePath && fileState.status !== 'running') {
        void runFileHash(filePath, next);
      }
    },
    [mode, filePath, fileState.status, runFileHash],
  );

  // webview 级拖放:Tauri 拦截 HTML5 drop,须用真实路径授权后再哈希。
  // 纯浏览器环境(无 __TAURI_INTERNALS__)跳过订阅:getCurrentWebview 在
  // 无 Tauri 运行时下即抛错,会把工具面板打进顶层 ErrorBoundary。
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let dispose: (() => void) | null = null;
    let alive = true;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop' && mode === 'file') {
          const dropped = event.payload.paths[0];
          if (dropped) {
            void (async () => {
              const kinds = await invokeCommand<Array<{ path: string; kind: string }>>(
                'fs_authorize_dropped_paths',
                { paths: [dropped] },
              );
              const entry = kinds?.find((k) => k.kind === 'file');
              if (!alive || !entry) return;
              setFilePath(entry.path);
              clearFileState();
              void runFileHash(entry.path, algorithm);
            })();
          }
        }
      })
      .then((unlisten) => {
        if (alive) dispose = unlisten;
        else unlisten();
      });
    return () => {
      alive = false;
      dispose?.();
    };
  }, [mode, algorithm, clearFileState, runFileHash]);

  const fileBusy = fileState.status === 'running';

  // 全局快捷键契约:与主按钮同一套 loading/空输入防护;清空同时复位输出与错误
  useToolShortcutActions(toolId, {
    execute:
      loading || fileBusy || (mode === 'text' && !text) || (mode === 'file' && !filePath)
        ? undefined
        : () => (mode === 'text' ? void handleCompute() : void runFileHash(filePath!, algorithm)),
    clearInput: () => {
      setText('');
      setOutput(null);
      setError(null);
      setFilePath(null);
      setFileSize(0);
      clearFileState();
    },
    copyOutput: (() => {
      const value = mode === 'text' ? output?.text : (fileState.result?.text ?? undefined);
      return value ? () => void copyTextWithFeedback(value) : undefined;
    })(),
  });

  // 「发送到…」接收端(文本模式)
  useToolHandoff(toolId, (incoming) => {
    setText(incoming);
    setMode('text');
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="hash-calculator"
    >
      <ConfigSection
        headerHint={t('tools.hash_calculator.section_hint')}
        searchAnchor="hash_calculator:config"
      >
        <ConfigRow
          icon={ShieldCheck}
          caption={t('tools.hash_calculator.algorithm')}
          captionHint={t('tools.hash_calculator.algorithm_hint')}
        >
          <Select value={algorithm} onValueChange={handleAlgorithmChange}>
            <SelectTrigger
              className="h-7 w-32 text-xs"
              aria-label={t('tools.hash_calculator.algorithm')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGORITHM_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow
          icon={ShieldCheck}
          caption={t('tools.hash_calculator.label_mode')}
          captionHint={t('tools.hash_calculator.mode_hint')}
        >
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as HashMode)}
            data-testid="hash-mode-tabs"
          >
            {/* h-7 + text-xs 压到配置行紧凑尺寸(shadcn 默认 h-10 / text-sm 会撑高整行);
                w-fit 让列表宽度随内容收缩,不留固定宽度造成的左右空白 */}
            <TabsList className="h-7 w-fit">
              <TabsTrigger
                value="text"
                data-testid="hash-mode-text"
                className="px-2 py-0.5 text-xs"
              >
                {t('tools.hash_calculator.mode_text')}
              </TabsTrigger>
              <TabsTrigger
                value="file"
                data-testid="hash-mode-file"
                className="px-2 py-0.5 text-xs"
              >
                {t('tools.hash_calculator.mode_file')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* 左区:文本输入(「计算」动作在工具栏)或文件选择/拖放区 */}
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          {mode === 'text' ? (
            <CodeEditor
              title={t('tools.hash_calculator.input_title')}
              placeholder={t('tools.hash_calculator.input_placeholder')}
              value={text}
              onChange={setText}
              language="plaintext"
              className="h-full rounded-none border-0 border-r"
              data-testid="input"
              searchAnchor="hash_calculator:input"
              actions={
                <HeaderAction onClick={() => void handleCompute()} disabled={loading || !text}>
                  <Play aria-hidden className="size-3.5" />
                  {loading
                    ? t('tools.hash_calculator.computing')
                    : t('tools.hash_calculator.compute')}
                </HeaderAction>
              }
            />
          ) : (
            <div
              className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-r"
              data-search-anchor="hash_calculator:input"
              data-testid="hash-file-panel"
            >
              {/* 工具栏与 CodeEditor 工具栏同规格(26px),「选择文件」放动作区 */}
              <div className="flex h-[26px] min-w-0 shrink-0 items-center justify-between gap-x-2 border-b border-input px-2">
                <h2 className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                  {t('tools.hash_calculator.file_title')}
                </h2>
                <div className="flex h-[26px] shrink-0 items-center">
                  <button
                    type="button"
                    data-testid="hash-open"
                    title={t('tools.hash_calculator.choose_file')}
                    aria-label={t('tools.hash_calculator.choose_file')}
                    onClick={() => void handlePickFile()}
                    className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('tools.hash_calculator.choose_file')}
                  </button>
                </div>
              </div>
              {/* 拖放/进度区:普通 overflow-auto 容器(避免 Radix ScrollArea 打断高度链) */}
              <div
                data-testid="hash-dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  // Tauri 运行时下 HTML5 drop 拿不到真实路径(事件被拦截),
                  // 实际授权哈希由 webview 级 onDragDropEvent 完成;此处仅
                  // 浏览器环境兜底提示
                }}
                className={`min-h-0 flex-1 overflow-auto transition-colors ${dragOver ? 'bg-primary/5' : ''}`}
              >
                <div className="flex h-full min-h-full items-center justify-center p-4">
                  {filePath ? (
                    <div
                      className="flex w-full max-w-md flex-col items-center gap-3"
                      data-testid="hash-file-info"
                    >
                      <FileDown aria-hidden className="size-8 text-primary" />
                      <p className="w-full break-all text-center text-xs text-muted-foreground">
                        {filePath}
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatBytes(fileState.total || fileSize)}
                      </p>
                      {fileBusy && (
                        <div className="flex w-full items-center gap-3">
                          <Progress
                            value={fileState.percent}
                            className="h-1.5 flex-1"
                            aria-label={t('tools.hash_calculator.progress_aria')}
                          />
                          <span
                            className="shrink-0 text-xs tabular-nums text-muted-foreground"
                            data-testid="hash-progress"
                          >
                            {fileState.percent}%
                          </span>
                          <button
                            type="button"
                            data-testid="hash-cancel"
                            onClick={() => void cancelFileHash()}
                            className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Square aria-hidden className="size-3" />
                            {t('tools.hash_calculator.cancel')}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileDown aria-hidden className="size-8" />
                      <p className="text-xs">{t('tools.hash_calculator.dropzone_hint')}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右区:哈希值(内联错误 / 输出编辑器 + 复制) */}
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <div className="relative h-full">
            {mode === 'text' && error ? (
              <div className="flex h-full flex-col overflow-hidden rounded-none border-0">
                <div className="border-b border-input px-2 py-0.5">
                  <span className="pl-1 text-xs font-medium">
                    {t('tools.hash_calculator.output_title')}
                  </span>
                </div>
                <div
                  role="alert"
                  className="m-3 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </div>
              </div>
            ) : fileState.status === 'failed' ? (
              <div className="flex h-full flex-col overflow-hidden rounded-none border-0 border-l">
                <div className="border-b border-input px-2 py-0.5">
                  <span className="pl-1 text-xs font-medium">
                    {t('tools.hash_calculator.output_title')}
                  </span>
                </div>
                <div
                  role="alert"
                  className="m-3 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
                  data-testid="hash-file-error"
                >
                  {fileState.error}
                </div>
              </div>
            ) : (
              <CodeEditor
                readOnly
                title={t('tools.hash_calculator.output_title')}
                language="plaintext"
                value={mode === 'text' ? (output?.text ?? '') : (fileState.result?.text ?? '')}
                placeholder={t('tools.hash_calculator.output_placeholder')}
                className="h-full rounded-none border-0 border-l"
                data-testid="output"
                searchAnchor="hash_calculator:output"
                actions={
                  <>
                    {mode === 'text' && output?.meta && (
                      <span className="text-xs text-muted-foreground">
                        {t('tools.hash_calculator.bytes_unit', {
                          count: output.meta.input_bytes,
                          ms: output.meta.duration_ms,
                        })}
                      </span>
                    )}
                    {mode === 'file' && fileState.status === 'done' && (
                      <span className="text-xs text-muted-foreground">
                        {t('tools.hash_calculator.bytes_unit', {
                          count: fileState.result?.meta?.input_bytes ?? fileState.total,
                          ms: 0,
                        })}
                      </span>
                    )}
                    {mode === 'text' && output?.text && (
                      <>
                        <CopyAction text={output.text} testId="copy-hash" />
                        <SendToMenu
                          text={output.text}
                          currentToolId={toolId}
                          testId="output-send"
                        />
                      </>
                    )}
                    {mode === 'file' && fileState.result?.text && (
                      <CopyAction text={fileState.result.text} testId="copy-hash" />
                    )}
                  </>
                }
              />
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

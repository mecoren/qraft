/**
 * Base64 转换器(统一工具)
 *
 * 整合 base64.guru/converter 的 Encoders 与 Decoders 全部功能:
 * - Encoders:Text / URL / CSS / HTML / Hex(文本类,走 Rust 后端)+ File / Image /
 *   Audio / Video / PDF(文件类,前端 FileReader)
 * - Decoders:Text / ASCII / Hex / Basic Auth(文本类,走 Rust 后端)+ File / Image /
 *   Audio / Video / PDF(二进制类,Rust 校验嗅探 MIME + 前端 Blob 预览)
 *
 * 布局参考 TextProcessor / JsonFormatter:
 * - 顶部「配置」卡片:方向 Tabs + 模式 Select + 按模式动态出现的微开关
 * - 下方 ResizablePanelGroup 双栏工作区
 * - 文本类模式:输入防抖自动执行(400ms),错误写入输出框,meta 统计 + 复制
 * - 文件类 encode:拖放 / 选择文件 → data URL / 纯 base64 输出
 * - 文件类 decode:输入 base64 → 图片 / 音频 / 视频 / PDF / 下载卡片预览
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Binary,
  FileDown,
  FolderOpen,
  Play,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { invokeCommand, CommandError } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { formatBytes, readFileAsDataUrl, stripDataUrlPrefix } from '@/lib/file-utils';
import {
  getMode,
  getModes,
  supportsDataUrl,
  supportsHexCase,
  supportsUrlSafe,
  type Base64Mode,
  type Direction,
} from './base64-utils';

/** 将 base64 字符串解码为二进制字节数组(用于构造 Blob 预览) */
function base64ToUint8Array(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin =
    typeof atob === 'function' ? atob(clean) : Buffer.from(clean, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
import type { OutputMeta, ToolOutput } from '@/types/tool';
import type { ToolProps } from './registry';

/** Rust ToolError 的 Display 前缀,展示时剥离避免冗余(与 JsonFormatter 一致) */
const RUST_ERROR_PREFIXES = [
  'parse failed: ',
  'invalid input: ',
  'internal error: ',
  'input too large: ',
  'tool not found: ',
  'timeout after ',
  'out of memory: ',
];

/** 把任意异常格式化为输出框可显示的错误文本 */
function formatError(e: unknown, prefix?: string): string {
  let body: string;
  if (e instanceof CommandError) {
    let message = e.message;
    for (const p of RUST_ERROR_PREFIXES) {
      if (message.startsWith(p)) {
        message = message.slice(p.length);
        break;
      }
    }
    body = e.code ? `${e.code}: ${message}` : message;
  } else if (e instanceof Error) {
    body = e.message;
  } else {
    body = String(e);
  }
  return prefix ? `${prefix}${body}` : body;
}

/** MIME → 文件扩展名(解码二进制另存为时使用) */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

interface FileInfo {
  name: string;
  size: number;
  mime: string;
}

interface BinaryResult {
  base64: string;
  mime: string;
  bytes: number;
}

/** 标题栏内动作按钮,与 CodeEditor 工具栏风格一致(参考 JsonFormatter ActionButton) */
function HeaderAction({
  onClick,
  disabled,
  testId,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** 文件类编码:拖放区 / 选择按钮(参考 ImageConverter) */
function FileDropzone({
  mode,
  fileInfo,
  onFile,
}: {
  mode: Base64Mode;
  fileInfo: FileInfo | null;
  onFile: (file: File) => void;
}): JSX.Element {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      className="flex h-full min-h-[200px] flex-col gap-2"
      data-search-anchor="base64_codec:file"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-body-sm font-semibold">文件</h2>
        <Button
          variant="ghost"
          size="sm"
          data-testid="b64-open"
          onClick={() => fileRef.current?.click()}
        >
          <FolderOpen aria-hidden className="size-3.5" /> 选择文件
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={mode.accept}
        className="hidden"
        data-testid="b64-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      <ScrollArea
        data-testid="b64-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`min-h-0 flex-1 rounded-lg border shadow-card transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-card'
        }`}
      >
        <div className="flex h-full min-h-full items-center justify-center p-4">
          {fileInfo ? (
            <div className="flex flex-col items-center gap-2">
              <FileDown aria-hidden className="size-8 text-primary" />
              <p className="text-xs text-muted-foreground" data-testid="b64-file-info">
                {fileInfo.name} · {formatBytes(fileInfo.size)} · {fileInfo.mime}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <FolderOpen aria-hidden className="size-8" />
              <p className="text-xs">{mode.hint}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** 按模式渲染预览主体 */
function PreviewBody({
  modeId,
  url,
  result,
}: {
  modeId: string;
  url: string;
  result: BinaryResult;
}): JSX.Element {
  if (modeId === 'image') {
    return (
      <img
        src={url || undefined}
        alt="Base64 解码预览"
        data-testid="b64-preview"
        className="max-h-full max-w-full object-contain"
      />
    );
  }
  if (modeId === 'audio') {
    return <audio controls src={url || undefined} data-testid="b64-preview" className="w-full" />;
  }
  if (modeId === 'video') {
    return (
      <video
        controls
        src={url || undefined}
        data-testid="b64-preview"
        className="max-h-full max-w-full"
      />
    );
  }
  if (modeId === 'pdf') {
    return (
      <iframe
        title="PDF 预览"
        src={url || undefined}
        data-testid="b64-preview"
        className="h-full w-full rounded-md border border-input"
      />
    );
  }
  const ext = MIME_EXT[result.mime] ?? 'bin';
  return (
    <div
      data-testid="b64-preview"
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-background p-6"
    >
      <FileDown aria-hidden className="size-10 text-primary" />
      <p className="text-sm font-medium">decoded.{ext}</p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary">
          {result.mime}
        </span>
        <span>{formatBytes(result.bytes)}</span>
      </div>
    </div>
  );
}

/** 文件类解码:预览区(图片 / 音频 / 视频 / PDF / 下载卡片)+ 另存为 */
function BinaryPreview({
  mode,
  result,
  error,
  onSave,
}: {
  mode: Base64Mode;
  result: BinaryResult | null;
  error: string | null;
  onSave: () => void;
}): JSX.Element {
  // 使用 Blob URL 而非 data: URL:大文件时 data URL 比二进制体积大 ~33%
  // 且常驻内存;Blob URL 零额外拷贝,并在组件卸载/结果变更时释放,降低内存占用。
  const [objectUrl, setObjectUrl] = useState('');
  useEffect(() => {
    // setState 统一放在 setTimeout 回调中,避免 effect 同步体内 setState 触发的级联渲染 lint 错误
    if (!result) {
      const h = setTimeout(() => setObjectUrl(''), 0);
      return () => clearTimeout(h);
    }
    // 将 base64 解码为二进制再构造 Blob(真正的二进制预览,而 base64 文本无法直接预览)
    const bin = base64ToUint8Array(result.base64);
    const url = URL.createObjectURL(new Blob([bin.buffer as ArrayBuffer], { type: result.mime }));
    const h = setTimeout(() => setObjectUrl(url), 0);
    return () => {
      clearTimeout(h);
      URL.revokeObjectURL(url);
    };
  }, [result]);
  return (
    <div className="flex h-full min-h-[200px] flex-col overflow-hidden rounded-md border border-input bg-card">
      <div className="flex items-center justify-between border-b border-input px-2 py-0.5">
        <span className="pl-1 text-xs font-medium text-foreground">预览</span>
        <HeaderAction testId="b64-save" onClick={onSave} disabled={!result}>
          <Save aria-hidden className="size-3.5" /> 另存为
        </HeaderAction>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex h-full min-h-[200px] items-center justify-center p-3">
          {error ? (
            <p role="alert" data-testid="b64-error" className="text-xs text-destructive">
              {error}
            </p>
          ) : !result ? (
            <p className="text-xs text-muted-foreground">{mode.hint}</p>
          ) : (
            <PreviewBody modeId={mode.id} url={objectUrl} result={result} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function Base64Codec({ toolId }: ToolProps): JSX.Element {
  const [direction, setDirection] = useState<Direction>('decode');
  const [modeId, setModeId] = useState('text');
  const mode: Base64Mode = getMode(direction, modeId) ?? getModes(direction)[0]!;
  const [text, setText] = useState('');
  const [output, setOutput] = useState('');
  const [meta, setMeta] = useState<OutputMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [urlSafe, setUrlSafe] = useState(false);
  const [hexCase, setHexCase] = useState<'lower' | 'upper'>('lower');
  const [includeDataUrl, setIncludeDataUrl] = useState(true);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [binary, setBinary] = useState<BinaryResult | null>(null);
  const [binaryError, setBinaryError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 递增请求序号:方向/模式切换或手动执行时使旧的异步请求结果失效,避免竞态写入 */
  const requestSeqRef = useRef(0);

  const isTextMode = mode.kind === 'text';
  const isFileEncode = direction === 'encode' && mode.kind === 'file';
  const isFileDecode = direction === 'decode' && mode.kind === 'file';

  /** 切换方向 / 模式时清空输出与预览(保留输入文本),并使进行中的请求失效 */
  const resetWorkspace = useCallback(() => {
    requestSeqRef.current += 1;
    setOutput('');
    setMeta(null);
    setBinary(null);
    setBinaryError(null);
    setFileInfo(null);
  }, []);

  const handleDirectionChange = useCallback(
    (d: Direction) => {
      setDirection(d);
      setModeId('text');
      resetWorkspace();
    },
    [resetWorkspace],
  );

  const handleModeChange = useCallback(
    (id: string) => {
      setModeId(id);
      resetWorkspace();
    },
    [resetWorkspace],
  );

  /** 文本类模式执行(编码 / 解码),错误写入输出框 */
  const runTextExecute = useCallback(
    async (auto = false) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (!text.trim()) return;
      const seq = requestSeqRef.current;
      if (!auto) setLoading(true);
      try {
        const params: Record<string, unknown> = {
          action: direction,
          mode: mode.rustMode,
          url_safe: urlSafe,
        };
        if (direction === 'decode' && modeId === 'hex') params.hex_case = hexCase;
        const result = await invokeCommand<ToolOutput>('tool_execute', {
          toolId,
          input: { text, params },
        });
        // 请求期间方向/模式被切换则丢弃过期结果
        if (seq !== requestSeqRef.current) return;
        setOutput(result.text ?? '');
        setMeta(result.meta ?? null);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        setOutput(formatError(e, '执行失败: '));
        setMeta(null);
      } finally {
        if (seq === requestSeqRef.current && !auto) setLoading(false);
      }
    },
    [toolId, text, direction, modeId, mode, urlSafe, hexCase],
  );

  /** 文件类解码:调用 Rust 校验 base64 并嗅探 MIME,返回 extra 供前端预览 */
  const runBinaryExecute = useCallback(
    async (auto = false) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (!text.trim()) return;
      const seq = requestSeqRef.current;
      if (!auto) setLoading(true);
      try {
        const result = await invokeCommand<ToolOutput>('tool_execute', {
          toolId,
          input: {
            text,
            params: { action: 'decode', mode: 'binary', url_safe: urlSafe },
          },
        });
        if (seq !== requestSeqRef.current) return;
        const extra = result.extra as Partial<BinaryResult> | null | undefined;
        if (extra?.base64 && extra?.mime) {
          setBinary({
            base64: extra.base64,
            mime: extra.mime,
            bytes: extra.bytes ?? 0,
          });
          setBinaryError(null);
        } else {
          setBinary(null);
          setBinaryError('后端未返回有效的二进制信息');
        }
        setMeta(result.meta ?? null);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        setBinary(null);
        setBinaryError(formatError(e, '解码失败: '));
        setMeta(null);
      } finally {
        if (seq === requestSeqRef.current && !auto) setLoading(false);
      }
    },
    [toolId, text, urlSafe],
  );

  // 全局快捷键契约:text 模式执行编码/解码,file 解码执行二进制解析,
  // file 编码模式(需要文件选择器交互)不注册 execute。清空输入同时复位输出与预览。
  useToolShortcutActions(toolId, {
    execute: isTextMode
      ? () => void runTextExecute(false)
      : isFileDecode
        ? () => void runBinaryExecute(false)
        : undefined,
    clearInput: () => {
      setText('');
      resetWorkspace();
    },
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  // 文本类:输入 / 配置变化后防抖自动执行(参考 JsonFormatter)
  useEffect(() => {
    if (!isTextMode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      // 空输入:清空输出(定时器回调内 setState,避免 effect 同步 setState 触发级联渲染)
      debounceRef.current = setTimeout(() => {
        setOutput('');
        setMeta(null);
      }, 0);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runTextExecute(true);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // modeId 变化(切换模式)时重跑,保证输入有值时自动转换
  }, [isTextMode, text, modeId, runTextExecute]);

  // 文件类解码:base64 输入防抖自动执行
  useEffect(() => {
    if (!isFileDecode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      debounceRef.current = setTimeout(() => {
        setBinary(null);
        setBinaryError(null);
      }, 0);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runBinaryExecute(true);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // modeId 变化(切换模式)时重跑,保证输入有值时自动转换
  }, [isFileDecode, text, modeId, runBinaryExecute]);

  /** 文件类编码:读取文件为 data URL(或剥离前缀输出纯 base64) */
  const loadFile = useCallback(
    async (file: File) => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setFileInfo({
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        });
        setOutput(includeDataUrl ? dataUrl : stripDataUrlPrefix(dataUrl).base64);
        toast.success(`已编码 ${file.name}`);
      } catch (e) {
        toast.error(`读取失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [includeDataUrl],
  );

  /** 文件类解码:另存为——调用 Rust 端弹保存对话框并写入字节 */
  const saveBinary = useCallback(async () => {
    if (!binary) return;
    try {
      const ext = MIME_EXT[binary.mime] ?? 'bin';
      const path = await invokeCommand<string | null>('fs_save_bytes', {
        fileName: `decoded.${ext}`,
        base64: binary.base64,
        mime: binary.mime,
      });
      if (path) toast.success(`已保存: ${path}`);
      // 用户取消对话框时 path 为 null,静默处理
    } catch (e) {
      toast.error(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [binary]);

  const executeDisabled = loading || !text;

  return (
    <div className="flex h-full flex-col gap-3" data-testid="base64-codec">
      <ConfigSection title="" searchAnchor="base64_codec:config">
        <ConfigRow icon={Binary} label="方向" hint="选择编码或解码方向">
          <Tabs value={direction} onValueChange={(v) => handleDirectionChange(v as Direction)}>
            {/* 固定宽度 w-36,与下方模式 SelectTrigger 视觉对齐 */}
            <TabsList className="w-36">
              <TabsTrigger value="encode" data-testid="dir-encode">
                <ArrowUpFromLine aria-hidden className="size-3.5" /> 编码
              </TabsTrigger>
              <TabsTrigger value="decode" data-testid="dir-decode">
                <ArrowDownToLine aria-hidden className="size-3.5" /> 解码
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </ConfigRow>
        <ConfigRow icon={Binary} label="模式" hint={mode.hint}>
          {supportsUrlSafe(direction, mode.id) && (
            <>
              <Label htmlFor="b64-url-safe" className="text-xs">
                URL 安全
              </Label>
              <Switch
                id="b64-url-safe"
                aria-label="URL 安全"
                checked={urlSafe}
                onCheckedChange={setUrlSafe}
              />
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          {supportsHexCase(direction, mode.id) && (
            <>
              <Label htmlFor="b64-hex-case" className="text-xs">
                大写
              </Label>
              <Switch
                id="b64-hex-case"
                aria-label="Hex 大写"
                checked={hexCase === 'upper'}
                onCheckedChange={(c) => setHexCase(c ? 'upper' : 'lower')}
              />
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          {supportsDataUrl(direction, mode.id) && (
            <>
              <Label htmlFor="b64-data-url" className="text-xs">
                Data URL
              </Label>
              <Switch
                id="b64-data-url"
                aria-label="Data URL 前缀"
                checked={includeDataUrl}
                onCheckedChange={setIncludeDataUrl}
              />
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          <Select value={mode.id} onValueChange={handleModeChange}>
            <SelectTrigger data-testid="b64-mode" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {getModes(direction).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* 左区:输入 */}
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          {isTextMode || isFileDecode ? (
            <CodeEditor
              title={isFileDecode ? 'Base64 输入' : '输入'}
              language="plaintext"
              value={text}
              onChange={setText}
              className="h-full"
              data-testid="input"
              searchAnchor="base64_codec:input"
              actions={
                isTextMode ? (
                  <HeaderAction
                    testId="btn-execute"
                    onClick={() => void runTextExecute(false)}
                    disabled={executeDisabled}
                  >
                    <Play aria-hidden className="size-3.5" />
                    {loading ? '执行中' : '执行'}
                  </HeaderAction>
                ) : undefined
              }
            />
          ) : (
            <FileDropzone mode={mode} fileInfo={fileInfo} onFile={(f) => void loadFile(f)} />
          )}
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右区:输出 */}
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          {isTextMode || isFileEncode ? (
            <CodeEditor
              readOnly
              title={isFileEncode ? 'Base64 输出' : '输出'}
              language="plaintext"
              value={output}
              className="h-full"
              data-testid="output"
              searchAnchor="base64_codec:output"
              actions={
                <>
                  {meta && (
                    <span className="text-xs text-muted-foreground">
                      {meta.input_bytes} → {meta.output_bytes} 字节 · {meta.duration_ms}ms
                    </span>
                  )}
                  <CopyAction text={output} testId="output-copy" />
                </>
              }
            />
          ) : (
            <BinaryPreview mode={mode} result={binary} error={binaryError} onSave={saveBinary} />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

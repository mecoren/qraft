/**
 * Base64 转换器(统一工具)
 *
 * 整合 base64.guru/converter 的 Encoders 与 Decoders 全部功能:
 * - Encoders:Text / URL / CSS / HTML / Hex(文本类,走 Rust 后端)+ File / Image /
 *   Audio / Video / PDF(文件类,前端 FileReader)
 * - Decoders:Text / ASCII / Hex / Basic Auth(文本类,走 Rust 后端)+ File / Image /
 *   Audio / Video / PDF(二进制类,Rust 校验嗅探 MIME + 前端 Blob 预览)
 *
 * 布局参考 TextProcessor / JsonFormatter(外层统一 shell 卡片):
 * - 顶部扁平「配置」区:方向 Tabs + 模式 Select + 按模式动态出现的微开关
 * - 下方 ResizablePanelGroup 双栏工作区
 * - 文本类模式:输入防抖自动执行(400ms),错误写入输出框,meta 统计 + 复制
 * - 文件类 encode:拖放 / 选择文件 → data URL / 纯 base64 输出
 * - 文件类 decode:输入 base64 → 图片 / 音频 / 视频 / PDF / 下载卡片预览
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Binary,
  FileDown,
  FolderOpen,
  LocateFixed,
  Play,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatError } from '@/lib/format-error';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Label } from '@/components/ui/label';
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
import { CommandError, invokeCommand } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { SendToMenu } from '@/components/send-to-menu';
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

/**
 * 从后端错误消息中提取原始输入偏移标记(Rust 侧 format_decode_error 附上的
 * `[offset=N]`,N 为原始输入字节偏移);无标记返回 null(长度/padding 类错误)。
 */
function extractErrorOffset(message: string): number | null {
  const m = message.match(/\[offset=(\d+)\]/);
  return m ? Number(m[1]) : null;
}

/** 偏移(0-based 字节)→ 行列(1-based);与 json-diagnostics 同构的换算 */
function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < safeOffset; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/** 文本执行错误的结构化定位:有 offset 标记时 chip 可画波浪线跳转 */
interface DecodeError {
  message: string;
  offset: number | null;
}

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
import type { editor } from 'monaco-editor';
import type { ToolProps } from './registry';

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
      className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
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
  const { t } = useTranslation();
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
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-r"
      data-search-anchor="base64_codec:file"
    >
      {/* 工具栏与 CodeEditor 工具栏同规格(固定 26px 高),与对面编辑器标题栏恒等高 */}
      <div className="flex h-[26px] min-w-0 shrink-0 items-center justify-between gap-x-2 border-b border-input px-2">
        <h2 className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
          {t('tools.base64_codec.file_section_title')}
        </h2>
        <button
          type="button"
          data-testid="b64-open"
          title={t('tools.base64_codec.choose_file')}
          aria-label={t('tools.base64_codec.choose_file')}
          onClick={() => fileRef.current?.click()}
          className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderOpen aria-hidden className="size-3.5" /> {t('tools.base64_codec.choose_file')}
        </button>
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
      {/* 拖放区作为合并卡片内的满高面板:自身不再画圆角边框(由外层卡片提供框体) */}
      {/* 拖放区作为合并卡片内的满高面板:普通 overflow-auto 容器(理由同 BinaryPreview,
          避免 Radix ScrollArea table 包装层打断高度链导致提示无法垂直居中) */}
      <div
        data-testid="b64-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`min-h-0 flex-1 overflow-auto transition-colors ${dragOver ? 'bg-primary/5' : ''}`}
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
              <p className="text-xs">{t(mode.hintKey)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 按嗅探 MIME 渲染预览主体(而非用户所选模式:选「图片」但粘贴了 PDF 的 base64
 *  时,后端嗅探出的 application/pdf 才是事实,按它分发避免裂图/塌缩) */
function PreviewBody({ url, result }: { url: string; result: BinaryResult }): JSX.Element {
  const { t } = useTranslation();
  const { mime } = result;
  if (mime.startsWith('image/')) {
    return (
      <img
        src={url || undefined}
        alt={t('tools.base64_codec.preview_image_alt')}
        data-testid="b64-preview"
        className="max-h-full max-w-full object-contain"
      />
    );
  }
  if (mime.startsWith('audio/')) {
    return <audio controls src={url || undefined} data-testid="b64-preview" className="w-full" />;
  }
  if (mime.startsWith('video/')) {
    return (
      <video
        controls
        src={url || undefined}
        data-testid="b64-preview"
        className="max-h-full max-w-full"
      />
    );
  }
  if (mime === 'application/pdf') {
    return (
      <iframe
        title={t('tools.base64_codec.pdf_preview_title')}
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
      className="flex flex-col items-center gap-3 rounded-md border border-border bg-background p-6"
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

/** 文件类解码:预览区(按嗅探 MIME 分发:图片 / 音频 / 视频 / PDF / 下载卡片)+ 另存为 */
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
  const { t } = useTranslation();
  // mode 仅用于空态 hint;预览形态由嗅探 MIME 决定,与所选模式解耦
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
    // 合并卡片内右面板:只保留朝向中缝的左边框,外框由外层卡片提供(参考 JsonFormatter 输出侧)
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-l bg-card">
      {/* 标题栏与 CodeEditor 工具栏同规格(固定 26px 高),与左侧编辑器标题栏恒等高 */}
      <div className="flex h-[26px] min-w-0 shrink-0 items-center justify-between gap-x-2 border-b border-input px-2">
        <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
          {t('tools.base64_codec.preview_title')}
        </span>
        <HeaderAction testId="b64-save" onClick={onSave} disabled={!result}>
          <Save aria-hidden className="size-3.5" /> {t('tools.base64_codec.save_as')}
        </HeaderAction>
      </div>
      {/* Radix ScrollArea 的 Viewport 会给内容包一层 display:table 的 div(高度不定),
          打断 h-full / max-h-full 的百分比高度链:图片/视频按原始尺寸渲染被裁、
          PDF iframe 塌缩、提示无法垂直居中。改用普通 overflow-auto 容器
          (同 QrcodeTool 生成页签的预览模式)。 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex h-full min-h-[200px] items-center justify-center p-3">
          {error ? (
            <p role="alert" data-testid="b64-error" className="text-xs text-destructive">
              {error}
            </p>
          ) : !result ? (
            <p className="text-xs text-muted-foreground">{t(mode.hintKey)}</p>
          ) : (
            <PreviewBody url={objectUrl} result={result} />
          )}
        </div>
      </div>
    </div>
  );
}

export function Base64Codec({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
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
  /** 严格模式:关闭宽松解码(剔空白/补 padding/字母表嗅探),保持 RFC 4648 校验 */
  const [strict, setStrict] = useState(false);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [binary, setBinary] = useState<BinaryResult | null>(null);
  const [binaryError, setBinaryError] = useState<string | null>(null);
  /** 最近一次文本执行错误的结构化定位;仅解码方向且消息带 offset 标记时非空 */
  const [decodeError, setDecodeError] = useState<DecodeError | null>(null);
  /** 后端 warning alerts(如宽松回退 Latin-1 提示);成功时清空 */
  const [warnings, setWarnings] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 递增请求序号:方向/模式切换或手动执行时使旧的异步请求结果失效,避免竞态写入 */
  const requestSeqRef = useRef(0);
  /** 输入 Monaco 编辑器实例与 monaco 命名空间:错误定位 chip 点击时
   * setModelMarkers 画波浪线并跳转;由 CodeEditor onMount 注入。
   * jsdom shim 渲染为 textarea,onMount 不触发,调用处已判空。 */
  const inputEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  /** 组件根 DOM:错误定位在无 Monaco 实例的环境下(shim)经根查输入 textarea */
  const rootRef = useRef<HTMLDivElement>(null);

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
    setDecodeError(null);
    setWarnings([]);
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

  /** 文本类模式执行(编码 / 解码),错误写入输出框;解码错误带 offset 标记时
   *  记录结构化定位供 chip 跳转,成功时清空 chip 与宽松回退 warnings */
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
        params.strict = strict;
        const result = await invokeCommand<ToolOutput>('tool_execute', {
          toolId,
          input: { text, params },
        });
        // 请求期间方向/模式被切换则丢弃过期结果
        if (seq !== requestSeqRef.current) return;
        setOutput(result.text ?? '');
        setMeta(result.meta ?? null);
        setDecodeError(null);
        setWarnings((result.alerts ?? []).map((a) => a.message));
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        const message = formatError(e, t('tools.base64_codec.error_execute_prefix'));
        setOutput(message);
        setMeta(null);
        setWarnings([]);
        // 错误定位:仅解码方向做偏移提取(编码错误无输入偏移语义)
        if (direction === 'decode') {
          const offset = e instanceof CommandError ? extractErrorOffset(e.message) : null;
          setDecodeError({ message, offset });
        } else {
          setDecodeError(null);
        }
      } finally {
        if (seq === requestSeqRef.current && !auto) setLoading(false);
      }
    },
    [toolId, text, direction, modeId, mode, urlSafe, hexCase, strict, t],
  );

  /** 清除输入侧错误波浪线(输入变化时旧定位已失效) */
  useEffect(() => {
    const ed = inputEditorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;
    if (!decodeError?.offset) {
      monaco.editor.setModelMarkers(model, 'base64-codec', []);
      return;
    }
    const disposable = ed.onMouseDown(() => {
      monaco.editor.setModelMarkers(model, 'base64-codec', []);
    });
    return () => disposable.dispose();
  }, [decodeError]);

  /**
   * 点击错误定位 chip:把 `[offset=N]` 换算为输入编辑器行列,画 Monaco 波浪线
   * 并跳转。jsdom 下 Monaco 是 textarea shim(editor 实例不可用):把跳转目标
   * 记到 shim 的 DOM 属性上,真实浏览器走 Monaco API,两条路径互不干扰。
   */
  const gotoErrorLocation = useCallback(
    (offset: number) => {
      const { line, column } = offsetToLineColumn(text, offset);
      const ed = inputEditorRef.current;
      const monaco = monacoRef.current;
      if (!ed || !monaco) {
        // 测试环境 shim:从组件根查 input 容器内的 textarea,记录跳转意图
        const root = rootRef.current;
        const shim = root?.querySelector('[data-testid="input"] textarea') as
          (HTMLTextAreaElement & { __lastGoto?: { line: number; column: number } }) | null;
        if (shim) shim.__lastGoto = { line, column };
        return;
      }
      const model = ed.getModel();
      if (!model) return;
      const startCol = Math.min(column, model.getLineMaxColumn(line));
      monaco.editor.setModelMarkers(model, 'base64-codec', [
        {
          message: decodeError?.message ?? '',
          severity: monaco.MarkerSeverity.Error,
          startLineNumber: line,
          startColumn: startCol,
          endLineNumber: line,
          endColumn: Math.max(startCol + 1, model.getLineMaxColumn(line) + 1),
        },
      ]);
      ed.setPosition({ lineNumber: line, column: startCol });
      ed.revealLineInCenter(line);
      ed.focus();
    },
    [text, decodeError],
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
            params: { action: 'decode', mode: 'binary', url_safe: urlSafe, strict },
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
          setBinaryError(t('tools.base64_codec.binary_invalid_response'));
        }
        setMeta(result.meta ?? null);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        setBinary(null);
        setBinaryError(formatError(e, t('tools.base64_codec.error_decode_prefix')));
        setMeta(null);
      } finally {
        if (seq === requestSeqRef.current && !auto) setLoading(false);
      }
    },
    [toolId, text, urlSafe, strict, t],
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

  // 「发送到…」接收端
  useToolHandoff(toolId, (incoming) => setText(incoming));

  // 文本类:输入 / 配置变化后防抖自动执行(参考 JsonFormatter)
  useEffect(() => {
    if (!isTextMode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      // 空输入:清空输出与错误定位(定时器回调内 setState,避免 effect 同步 setState 触发级联渲染)
      debounceRef.current = setTimeout(() => {
        setOutput('');
        setMeta(null);
        setDecodeError(null);
        setWarnings([]);
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
        setDecodeError(null);
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
        toast.success(t('tools.base64_codec.encoded_file', { name: file.name }));
      } catch (e) {
        toast.error(
          t('tools.base64_codec.read_failed', {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
    [includeDataUrl, t],
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
      if (path) toast.success(t('tools.base64_codec.saved_to_path', { path }));
      // 用户取消对话框时 path 为 null,静默处理
    } catch (e) {
      toast.error(
        t('tools.base64_codec.save_failed', {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }, [binary, t]);

  const executeDisabled = loading || !text;

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与双栏工作区收进同一卡片
    <div
      ref={rootRef}
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="base64-codec"
    >
      <ConfigSection title="" searchAnchor="base64_codec:config">
        <ConfigRow
          icon={Binary}
          label={t('tools.base64_codec.label_direction')}
          hint={t('tools.base64_codec.direction_hint')}
        >
          <Tabs value={direction} onValueChange={(v) => handleDirectionChange(v as Direction)}>
            {/* 固定宽度 w-36,与下方模式 SelectTrigger 视觉对齐 */}
            <TabsList className="w-36">
              <TabsTrigger value="encode" data-testid="dir-encode">
                <ArrowUpFromLine aria-hidden className="size-3.5" />{' '}
                {t('tools.base64_codec.tab_encode')}
              </TabsTrigger>
              <TabsTrigger value="decode" data-testid="dir-decode">
                <ArrowDownToLine aria-hidden className="size-3.5" />{' '}
                {t('tools.base64_codec.tab_decode')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </ConfigRow>
        <ConfigRow icon={Binary} label={t('tools.base64_codec.label_mode')} hint={t(mode.hintKey)}>
          {supportsUrlSafe(direction, mode.id) && (
            <>
              <Label htmlFor="b64-url-safe" className="text-xs">
                {t('tools.base64_codec.url_safe_label')}
              </Label>
              <Switch
                id="b64-url-safe"
                aria-label={t('tools.base64_codec.url_safe_label')}
                checked={urlSafe}
                onCheckedChange={setUrlSafe}
              />
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          {supportsHexCase(direction, mode.id) && (
            <>
              <Label htmlFor="b64-hex-case" className="text-xs">
                {t('tools.base64_codec.hex_case_upper_label')}
              </Label>
              <Switch
                id="b64-hex-case"
                aria-label={t('tools.base64_codec.hex_case_upper_aria')}
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
                aria-label={t('tools.base64_codec.data_url_prefix_aria')}
                checked={includeDataUrl}
                onCheckedChange={setIncludeDataUrl}
              />
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          {direction === 'decode' && mode.kind === 'text' && (
            <>
              <Label
                htmlFor="b64-strict"
                className="text-xs"
                title={t('tools.base64_codec.strict_hint')}
              >
                {t('tools.base64_codec.strict_label')}
              </Label>
              <Switch
                id="b64-strict"
                aria-label={t('tools.base64_codec.strict_aria')}
                title={t('tools.base64_codec.strict_hint')}
                checked={strict}
                onCheckedChange={setStrict}
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
                  {m.labelKey ? t(m.labelKey) : m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      {/* 双栏工作区直接置于 shell 卡片内(外框由根元素提供):
          两侧编辑器只保留朝向中缝的边框,避免双线/双圆角 */}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* 左区:输入 */}
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          {isTextMode || isFileDecode ? (
            <CodeEditor
              title={
                isFileDecode
                  ? t('tools.base64_codec.input_title_base64')
                  : t('tools.base64_codec.input_title')
              }
              language="plaintext"
              value={text}
              onChange={setText}
              // 只保留右侧边框(朝向中间分隔缝),外三边由外层卡片提供,理由同 JsonFormatter
              className="h-full rounded-none border-0 border-r"
              data-testid="input"
              searchAnchor="base64_codec:input"
              // 错误定位:接入 Monaco 实例与 monaco 命名空间,供 setModelMarkers
              // 波浪线 + 跳转;jsdom shim 下 onMount 不触发,调用处已判空
              onMount={(editorInstance, monaco) => {
                inputEditorRef.current = editorInstance;
                monacoRef.current = monaco as typeof import('monaco-editor');
              }}
              actions={
                isTextMode ? (
                  <>
                    <HeaderAction
                      testId="btn-execute"
                      onClick={() => void runTextExecute(false)}
                      disabled={executeDisabled}
                    >
                      <Play aria-hidden className="size-3.5" />
                      {loading
                        ? t('tools.base64_codec.executing')
                        : t('tools.base64_codec.execute')}
                    </HeaderAction>
                    {/* —— 解码错误定位:点击画波浪线并跳转出错位置 —— */}
                    {decodeError?.offset != null && (
                      <button
                        type="button"
                        data-testid="error-location"
                        onClick={() => gotoErrorLocation(decodeError.offset!)}
                        title={t('tools.base64_codec.error_goto_title')}
                        // 与 HeaderAction 同款样式(muted 前景 + hover 反色),
                        // 仅文字用 destructive 强调色区分报错语义(同 JsonFormatter chip)
                        className="flex h-[26px] min-w-0 max-w-44 items-center gap-1 rounded px-1 text-xs text-destructive transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <LocateFixed aria-hidden className="size-3.5 shrink-0" />
                        <span className="shrink-0 tabular-nums">
                          {(() => {
                            const { line, column } = offsetToLineColumn(text, decodeError.offset!);
                            return `L${line}:C${column}`;
                          })()}
                        </span>
                      </button>
                    )}
                  </>
                ) : undefined
              }
            />
          ) : (
            <FileDropzone mode={mode} fileInfo={fileInfo} onFile={(f) => void loadFile(f)} />
          )}
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右区:输出 */}
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          {isTextMode || isFileEncode ? (
            <CodeEditor
              readOnly
              title={
                isFileEncode
                  ? t('tools.base64_codec.output_title_base64')
                  : t('tools.base64_codec.output_title')
              }
              language="plaintext"
              value={output}
              // 对称:只保留左侧边框(朝向中间分隔缝),理由同输入侧
              className="h-full rounded-none border-0 border-l"
              data-testid="output"
              searchAnchor="base64_codec:output"
              actions={
                <>
                  {warnings.map((w) => (
                    <span
                      key={w}
                      data-testid="output-warning"
                      className="max-w-40 truncate text-xs text-amber-600 dark:text-amber-400"
                      title={w}
                    >
                      ⚠ {w}
                    </span>
                  ))}
                  {meta && (
                    <span className="text-xs text-muted-foreground">
                      {t('tools.base64_codec.bytes_unit', {
                        input: meta.input_bytes,
                        output: meta.output_bytes,
                        ms: meta.duration_ms,
                      })}
                    </span>
                  )}
                  <CopyAction text={output} testId="output-copy" />
                  {output ? (
                    <SendToMenu text={output} currentToolId={toolId} testId="output-send" />
                  ) : null}
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

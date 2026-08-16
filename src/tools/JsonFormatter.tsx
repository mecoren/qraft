import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CodeEditor, type EditorLanguage } from '@/components/ui/code-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CopyAction } from '@/components/copy-action';
import { invokeCommand, CommandError } from '@/lib/ipc';
import { ArrowDownAZ, ArrowUpAZ, Code2, Minimize2, Wand2 } from 'lucide-react';
import type { ToolProps } from './registry';
import type { OutputMeta, ToolOutput } from '@/types/tool';
import { generateTsInterface, parseSmart, sortJsonKeys } from './json-utils';

type QuickAction = 'minify' | 'sortAsc' | 'sortDesc' | 'entity';

/** 标题栏内的操作按钮,与编辑器工具栏(粘贴/打开/清除)风格完全一致 */
function ActionButton({
  onClick,
  disabled,
  children,
  testId,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  testId?: string;
}) {
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

/** Rust ToolError 的 Display 前缀,与 code 语义重复,展示时剥离避免冗余 */
const RUST_ERROR_PREFIXES = [
  'parse failed: ',
  'invalid input: ',
  'internal error: ',
  'input too large: ',
  'tool not found: ',
  'timeout after ',
  'out of memory: ',
];

/** 把任意异常格式化为右侧输出框可显示的错误文本 */
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

export function JsonFormatter({ toolId }: ToolProps) {
  const [text, setText] = useState('');
  const [indent, setIndent] = useState(2);
  const [output, setOutput] = useState('');
  const [outputLanguage, setOutputLanguage] = useState<EditorLanguage>('json');
  const [meta, setMeta] = useState<OutputMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const isXmlInput = useMemo(() => text.trim().startsWith('<'), [text]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 前端格式化阈值:低于该字节数直接在前端用 JSON.stringify 格式化(秒级响应,省 IPC 往返);
   * 超过阈值才走后端 Rust(保留其对超大输入的资源隔离与 10MB 拦截)。
   */
  const FRONTEND_FORMAT_LIMIT = 200 * 1024; // 200KB

  /** 前端快速格式化:解析(含 XML 自动转 JSON)后按缩进美化输出 */
  function formatOnFrontend(textToFormat: string): string {
    const value = parseSmart(textToFormat);
    return JSON.stringify(value, null, indent);
  }

  /**
   * 执行格式化(主按钮与自动防抖共用)。
   * 中小数据走前端纯函数,超过阈值走后端 Rust 格式化(auto=true 时不显示加载态)。
   */
  const runFormat = useCallback(
    async (auto = false) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (!text.trim()) return;
      if (!auto) setLoading(true);
      try {
        // 中小数据直接在前端格式化,避免无谓的 IPC 往返
        if (text.length <= FRONTEND_FORMAT_LIMIT) {
          setOutput(formatOnFrontend(text));
          setMeta(null);
          setOutputLanguage('json');
        } else {
          const result = await invokeCommand<ToolOutput>('tool_execute', {
            toolId,
            input: { text, params: { indent } },
          });
          setOutput(result.text ?? '');
          setMeta(result.meta ?? null);
          setOutputLanguage('json');
        }
      } catch (e) {
        // 报错直接写入右侧输出框
        setOutput(formatError(e, '格式化失败: '));
        setMeta(null);
        setOutputLanguage('plaintext');
      } finally {
        if (!auto) setLoading(false);
      }
    },
    [toolId, text, indent],
  );

  // 输入或缩进变化后自动格式化到右侧输出(防抖,避免每次按键都调用)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!text.trim()) {
        // 空输入:在异步回调内清空,避免在 effect 同步体内 setState 触发的级联渲染
        setOutput('');
        setMeta(null);
      } else {
        void runFormat(true);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, indent, runFormat]);

  /** 纯前端快速操作:压缩 / 键升序 / 键降序 / 生成实体类(支持 XML 输入自动转 JSON) */
  function handleQuickAction(action: QuickAction) {
    if (!text.trim()) return;
    try {
      const value = parseSmart(text);
      switch (action) {
        case 'minify':
          setOutput(JSON.stringify(value));
          setOutputLanguage('json');
          break;
        case 'sortAsc':
          setOutput(JSON.stringify(sortJsonKeys(value, false), null, 2));
          setOutputLanguage('json');
          break;
        case 'sortDesc':
          setOutput(JSON.stringify(sortJsonKeys(value, true), null, 2));
          setOutputLanguage('json');
          break;
        case 'entity':
          setOutput(generateTsInterface(value));
          setOutputLanguage('typescript');
          break;
      }
      setMeta(null);
    } catch (e) {
      setOutput(formatError(e, '解析失败: '));
      setOutputLanguage('plaintext');
      setMeta(null);
    }
  }

  const disabled = loading || !text;

  return (
    <div className="grid h-full grid-cols-2 gap-4">
      <CodeEditor
        title="输入(JSON / XML)"
        language={isXmlInput ? 'xml' : 'json'}
        value={text}
        onChange={setText}
        className="min-h-0"
        data-testid="input"
        actions={
          <>
            <Select value={String(indent)} onValueChange={(v) => setIndent(Number(v))}>
              <SelectTrigger id="indent-select" className="h-7 w-16 px-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="8">8</SelectItem>
              </SelectContent>
            </Select>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <ActionButton testId="btn-format" onClick={() => void runFormat()} disabled={disabled}>
              <Wand2 aria-hidden className="size-3.5" />
              {loading ? '格式化中' : '格式化'}
            </ActionButton>
            <ActionButton testId="btn-minify" onClick={() => handleQuickAction('minify')} disabled={disabled}>
              <Minimize2 aria-hidden className="size-3.5" />
              压缩
            </ActionButton>
            <ActionButton testId="btn-sort-asc" onClick={() => handleQuickAction('sortAsc')} disabled={disabled}>
              <ArrowUpAZ aria-hidden className="size-3.5" />
              键升序
            </ActionButton>
            <ActionButton testId="btn-sort-desc" onClick={() => handleQuickAction('sortDesc')} disabled={disabled}>
              <ArrowDownAZ aria-hidden className="size-3.5" />
              键降序
            </ActionButton>
            <ActionButton testId="btn-entity" onClick={() => handleQuickAction('entity')} disabled={disabled}>
              <Code2 aria-hidden className="size-3.5" />
              生成实体类
            </ActionButton>
            {isXmlInput && (
              <span className="text-xs text-muted-foreground">已识别 XML,将自动转换为 JSON</span>
            )}
          </>
        }
      />

      <CodeEditor
        readOnly
        title="输出"
        language={outputLanguage}
        value={output}
        className="min-h-0"
        data-testid="output"
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
    </div>
  );
}
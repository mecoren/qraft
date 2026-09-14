/**
 * TOML 格式化器 —— Rust 侧 Taplo 引擎(taplo crate)Document 级往返,
 * 保留注释/数组换行形态/表头结构。
 *
 * 与 YamlFormatter(纯前端 yaml 包)不同:Taplo 引擎无轻量 JS 移植
 * (@taplo/lib 为 35MB WASM 单文件,对前端 chunk 不可接受),故走 Rust 后端
 * `tool_execute`,吃 executor 超时/取消/panic 三重隔离。
 *
 * 支持:缩进(2/4 空格)、键值对齐、键排序、错误行列定位(点击跳转输入侧)。
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { editor as monacoEditor } from 'monaco-editor';
import { ArrowDownAZ, IndentIncrease, AlignHorizontalDistributeCenter } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { invokeCommand, CommandError } from '@/lib/ipc';
import { formatError } from '@/lib/format-error';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { SendToMenu } from '@/components/send-to-menu';
import type { ToolOutput } from '@/types/tool';
import type { ToolProps } from './registry';

/** 缩进模式:2/4 空格(Taplo 无 tab 选项,indentString 传空格串) */
type TomlIndentMode = '2' | '4';

/** 执行错误的结构化定位:Rust 侧消息带 [offset=N] 标记时可画波浪线跳转 */
interface TomlFormatError {
  message: string;
  offset: number | null;
}

/** 从后端错误消息提取 `[offset=N]` 字节偏移标记;无标记返回 null */
function extractErrorOffset(message: string): number | null {
  const m = message.match(/\[offset=(\d+)\]/);
  return m ? Number(m[1]) : null;
}

/** 偏移(字节)→ 行列(1-based);Rust 侧按 UTF-8 字节计偏移,此处同步按字节计换算 */
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

export function TomlFormatter({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [mode, setMode] = useState<TomlIndentMode>('2');
  const [alignEntries, setAlignEntries] = useState(false);
  const [reorderKeys, setReorderKeys] = useState(false);
  const [error, setError] = useState<TomlFormatError | null>(null);
  const [meta, setMeta] = useState<NonNullable<ToolOutput['meta']> | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 递增请求序号:配置切换或连续输入时使旧的异步请求结果失效,防竞态写入 */
  const requestSeqRef = useRef(0);
  /** 输入 Monaco 编辑器实例与 monaco 命名空间:错误定位画波浪线并跳转 */
  const inputEditorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

  /** 清空输出与错误定位(输入变化或重跑前) */
  const resetOutput = useCallback(() => {
    requestSeqRef.current += 1;
    setOutput('');
    setMeta(null);
    setError(null);
  }, []);

  /** 调 Rust 后端格式化;错误写入输出框并解析 offset 定位。seq 防旧请求竞态写入 */
  const runFormat = useCallback(
    async (seq: number) => {
      try {
        const result = await invokeCommand<ToolOutput>('tool_execute', {
          toolId,
          input: {
            text: input,
            params: {
              indent: Number(mode),
              align_entries: alignEntries,
              reorder_keys: reorderKeys,
            },
          },
        });
        if (seq !== requestSeqRef.current) return;
        setOutput(result.text ?? '');
        setMeta(result.meta ?? null);
        setError(null);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        const message = formatError(e, t('tools.toml_formatter.format_failed'));
        setOutput(message);
        setMeta(null);
        setError({
          message,
          offset: e instanceof CommandError ? extractErrorOffset(e.message) : null,
        });
      }
    },
    [toolId, input, mode, alignEntries, reorderKeys, t],
  );

  // 输入 / 缩进 / 对齐 / 排序变化后防抖自动格式化(参考 JsonFormatter 400ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input.trim()) {
      // 空输入:清空输出与错误(回调内 setState,避免 effect 同步 setState 级联渲染)
      debounceRef.current = setTimeout(() => {
        setOutput('');
        setMeta(null);
        setError(null);
      }, 0);
      return;
    }
    const seq = requestSeqRef.current;
    debounceRef.current = setTimeout(() => {
      void runFormat(seq);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, mode, alignEntries, reorderKeys, runFormat]);

  /**
   * 点击错误定位 chip:把 `[offset=N]` 换算为输入编辑器行列,画 Monaco 波浪线
   * 并跳转。jsdom 下 Monaco 是 textarea shim(editor 实例不可用):仅跳过定位,
   * 真实浏览器走 Monaco API。
   */
  const gotoErrorLocation = useCallback(
    (offset: number) => {
      const { line, column } = offsetToLineColumn(input, offset);
      const ed = inputEditorRef.current;
      const monaco = monacoRef.current;
      if (!ed || !monaco) return;
      const model = ed.getModel();
      if (!model) return;
      const startCol = Math.min(column, model.getLineMaxColumn(line));
      monaco.editor.setModelMarkers(model, 'toml-formatter', [
        {
          message: error?.message ?? '',
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
    [input, error],
  );

  // 输入变化时清旧波浪线(旧定位已失效)
  useEffect(() => {
    const ed = inputEditorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;
    if (!error?.offset) {
      monaco.editor.setModelMarkers(model, 'toml-formatter', []);
      return;
    }
    const disposable = ed.onMouseDown(() => {
      monaco.editor.setModelMarkers(model, 'toml-formatter', []);
    });
    return () => disposable.dispose();
  }, [error]);

  useToolShortcutActions(toolId, {
    clearInput: () => setInput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  // 「发送到…」接收端:注入输入侧
  useToolHandoff(toolId, (incoming) => setInput(incoming));

  return (
    // 外层 shell 卡片(对齐 YamlFormatter/XmlFormatter 基准):配置区 + 横向双栏工作区
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="toml-formatter"
    >
      <ConfigSection title="" searchAnchor="toml_formatter:config">
        <ConfigRow icon={IndentIncrease} label={t('tools.toml_formatter.indent')}>
          <Select value={mode} onValueChange={(v) => setMode(v as TomlIndentMode)}>
            <SelectTrigger data-testid="toml-indent" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">{t('tools.toml_formatter.indent_2')}</SelectItem>
              <SelectItem value="4">{t('tools.toml_formatter.indent_4')}</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow
          icon={AlignHorizontalDistributeCenter}
          label={t('tools.toml_formatter.align_entries')}
          hint={t('tools.toml_formatter.align_entries_hint')}
        >
          <Switch
            data-testid="toml-align-entries"
            aria-label={t('tools.toml_formatter.align_entries')}
            checked={alignEntries}
            onCheckedChange={(v) => {
              resetOutput();
              setAlignEntries(v);
            }}
          />
        </ConfigRow>
        <ConfigRow
          icon={ArrowDownAZ}
          label={t('tools.toml_formatter.reorder_keys')}
          hint={t('tools.toml_formatter.reorder_keys_hint')}
        >
          <Switch
            data-testid="toml-reorder-keys"
            aria-label={t('tools.toml_formatter.reorder_keys')}
            checked={reorderKeys}
            onCheckedChange={(v) => {
              resetOutput();
              setReorderKeys(v);
            }}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.toml_formatter.input_title')}
            language="toml"
            value={input}
            onChange={setInput}
            data-testid="tomlfmt-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="toml_formatter:input"
            onMount={(ed, monaco) => {
              inputEditorRef.current = ed;
              monacoRef.current = monaco;
            }}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.toml_formatter.output_title')}
            language={error ? 'plaintext' : 'toml'}
            value={output}
            readOnly
            data-testid="tomlfmt-output"
            className="h-full rounded-none border-0 border-l"
            searchAnchor="toml_formatter:output"
            actions={
              <>
                {error?.offset !== null && error?.offset !== undefined && (
                  <button
                    type="button"
                    data-testid="tomlfmt-error-loc"
                    className="shrink-0 rounded px-1 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => error?.offset !== null && gotoErrorLocation(error.offset)}
                  >
                    {(() => {
                      const { line, column } = offsetToLineColumn(input, error.offset ?? 0);
                      return `L${line}:C${column}`;
                    })()}
                  </button>
                )}
                {meta && !error && (
                  <span
                    data-testid="tomlfmt-stats"
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                  >
                    {t('tools.toml_formatter.stats', {
                      ms: meta.duration_ms,
                      in: meta.input_bytes,
                      out: meta.output_bytes,
                    })}
                  </span>
                )}
                {output && !error && <CopyAction text={output} testId="tomlfmt-copy" />}
                {output && !error && (
                  <SendToMenu text={output} currentToolId={toolId} testId="tomlfmt-send" />
                )}
              </>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

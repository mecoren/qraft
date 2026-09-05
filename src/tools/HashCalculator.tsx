/**
 * 哈希 / 校验和生成器 —— 新代统一布局
 *
 * 结构(与 Base64Codec / JsonFormatter 一致):
 * - 顶部「配置」卡片:算法选择(MD5 ~ BLAKE3)
 * - 下方 ResizablePanelGroup 双栏工作区:
 *   左 = 输入编辑器(「计算」动作在工具栏);右 = 哈希值输出(复制在工具栏)
 *
 * 错误处理遵循新代约定:工具内联 alert 展示于结果区。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, ShieldCheck } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatError } from '@/lib/format-error';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { invokeCommand } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { SendToMenu } from '@/components/send-to-menu';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512' | 'blake3';

interface HashParams {
  algorithm: HashAlgorithm;
}

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
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  // 全局快捷键契约:与主按钮同一套 loading/空输入防护;清空同时复位输出与错误
  useToolShortcutActions(toolId, {
    execute: loading || !text ? undefined : () => void handleCompute(),
    clearInput: () => {
      setText('');
      setOutput(null);
      setError(null);
    },
    copyOutput: output?.text ? () => void copyTextWithFeedback(output.text) : undefined,
  });

  // 「发送到…」接收端
  useToolHandoff(toolId, (incoming) => setText(incoming));

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="hash-calculator"
    >
      <ConfigSection title="" searchAnchor="hash_calculator:config">
        <ConfigRow
          icon={ShieldCheck}
          label={t('tools.hash_calculator.algorithm')}
          hint={t('tools.hash_calculator.algorithm_hint')}
        >
          <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as HashAlgorithm)}>
            <SelectTrigger className="w-32" aria-label={t('tools.hash_calculator.algorithm')}>
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
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* 左区:输入文本(「计算」动作在工具栏) */}
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
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
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右区:哈希值(内联错误 / 输出编辑器 + 复制) */}
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <div className="relative h-full">
            {error ? (
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
            ) : (
              <CodeEditor
                readOnly
                title={t('tools.hash_calculator.output_title')}
                language="plaintext"
                value={output?.text ?? ''}
                placeholder={t('tools.hash_calculator.output_placeholder')}
                className="h-full rounded-none border-0 border-l"
                data-testid="output"
                searchAnchor="hash_calculator:output"
                actions={
                  <>
                    {output?.meta && (
                      <span className="text-xs text-muted-foreground">
                        {t('tools.hash_calculator.bytes_unit', {
                          count: output.meta.input_bytes,
                          ms: output.meta.duration_ms,
                        })}
                      </span>
                    )}
                    {output?.text && (
                      <>
                        <CopyAction text={output.text} testId="copy-hash" />
                        <SendToMenu
                          text={output.text}
                          currentToolId={toolId}
                          testId="output-send"
                        />
                      </>
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

/** 把任意异常格式化为可显示的错误文本(CommandError 附带错误码便于排障) */

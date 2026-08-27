/**
 * 颜色转换器 —— 新代统一布局
 *
 * 结构(与 Base64Codec / JsonFormatter 一致):
 * - 顶部「配置」卡片:颜色值输入 + 输入格式(HEX/RGB/HSL)+ 执行按钮
 * - 下方结果区:左侧色样预览与三种格式取值(逐项复制),右侧完整输出编辑器
 *
 * 错误处理遵循新代约定:工具内联 alert 展示。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { formatError } from '@/lib/format-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { invokeCommand } from '@/lib/ipc';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface ColorParams {
  from_format: 'hex' | 'rgb' | 'hsl';
}

interface ColorExtra {
  hex: string;
  rgb: string;
  hsl: string;
}

type ColorFormat = 'hex' | 'rgb' | 'hsl';

export function ColorConverter({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [fromFormat, setFromFormat] = useState<ColorFormat>('hex');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleConvert() {
    setLoading(true);
    setError(null);
    try {
      const params: ColorParams = { from_format: fromFormat };
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

  const extra = output?.extra as ColorExtra | undefined;

  return (
    <div className="flex h-full flex-col gap-3" data-testid="color-converter">
      <ConfigSection title="" searchAnchor="color_converter:config">
        <ConfigRow
          icon={Palette}
          label={t('tools.color_converter.color_value')}
          hint={t('tools.color_converter.color_value_hint')}
          searchAnchor="color_converter:input"
        >
          <Input
            id="color-input"
            placeholder={t('tools.color_converter.input_placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-72 font-mono text-sm"
            data-testid="input"
          />
        </ConfigRow>
        <ConfigRow
          icon={Palette}
          label={t('tools.color_converter.input_format')}
          hint={t('tools.color_converter.input_format_hint')}
        >
          <Select value={fromFormat} onValueChange={(v) => setFromFormat(v as ColorFormat)}>
            <SelectTrigger className="w-32" aria-label={t('tools.color_converter.input_format')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hex">HEX</SelectItem>
              <SelectItem value="rgb">RGB</SelectItem>
              <SelectItem value="hsl">HSL</SelectItem>
            </SelectContent>
          </Select>
          <span className="h-4 w-px bg-border" aria-hidden />
          <Button onClick={() => void handleConvert()} disabled={loading || !text} size="sm">
            {loading ? t('tools.color_converter.converting') : t('tools.color_converter.convert')}
          </Button>
        </ConfigRow>
      </ConfigSection>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* 结果区:左预览/取值 + 右输出编辑器;锚点保持 color_converter:result */}
      <div
        className="grid min-h-0 flex-1 grid-cols-2 gap-3"
        data-testid="output"
        data-search-anchor="color_converter:result"
      >
        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded-lg border p-3 shadow-card">
            <div className="text-xs font-semibold text-muted-foreground">
              {t('tools.color_converter.preview')}
            </div>
            <div
              className="mt-2 h-24 rounded-md border"
              style={{ backgroundColor: extra?.hex }}
              aria-label={
                extra
                  ? t('tools.color_converter.color_sample', { value: extra.hex })
                  : t('tools.color_converter.no_color_sample')
              }
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border p-3 text-sm shadow-card">
            <div className="grid grid-cols-[60px_1fr_auto] gap-x-3 gap-y-2">
              <span className="font-semibold">HEX</span>
              <code className="break-all font-mono">{extra?.hex ?? '—'}</code>
              <CopyButton value={extra?.hex} />
              <span className="font-semibold">RGB</span>
              <code className="break-all font-mono">{extra?.rgb ?? '—'}</code>
              <CopyButton value={extra?.rgb} />
              <span className="font-semibold">HSL</span>
              <code className="break-all font-mono">{extra?.hsl ?? '—'}</code>
              <CopyButton value={extra?.hsl} />
            </div>
          </div>
        </div>
        <CodeEditor
          readOnly
          title={t('tools.color_converter.result_title')}
          language="plaintext"
          value={output?.text ?? ''}
          placeholder={t('tools.color_converter.output_placeholder')}
          className="min-h-0"
          data-testid="output-editor"
          searchAnchor="color_converter:output"
          actions={
            output?.text ? <CopyAction text={output.text} testId="output-copy" /> : undefined
          }
        />
      </div>
    </div>
  );
}

/** 取值行复制按钮:值为空时渲染占位,保持网格对齐 */
function CopyButton({ value }: { value?: string }): JSX.Element {
  const { t } = useTranslation();
  if (!value) return <span />;
  return (
    <button
      type="button"
      className="text-xs text-primary hover:underline"
      onClick={() => void copyTextWithFeedback(value)}
    >
      {t('tools.color_converter.copy')}
    </button>
  );
}

/** 把任意异常格式化为可显示的错误文本(CommandError 附带错误码便于排障) */

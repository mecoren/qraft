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
          label="颜色值"
          hint="如 #ff5733 / rgb(255,87,51) / hsl(11,100%,60%)"
          searchAnchor="color_converter:input"
        >
          <Input
            id="color-input"
            placeholder="输入颜色值..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-72 font-mono text-sm"
            data-testid="input"
          />
        </ConfigRow>
        <ConfigRow icon={Palette} label="输入格式" hint="解析输入所用的颜色格式">
          <Select value={fromFormat} onValueChange={(v) => setFromFormat(v as ColorFormat)}>
            <SelectTrigger className="w-32" aria-label="输入格式">
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
            {loading ? '转换中...' : '转换'}
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
            <div className="text-xs font-semibold text-muted-foreground">预览</div>
            <div
              className="mt-2 h-24 rounded-md border"
              style={{ backgroundColor: extra?.hex }}
              aria-label={extra ? `颜色样本 ${extra.hex}` : '暂无颜色样本'}
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
          title="转换结果"
          language="plaintext"
          value={output?.text ?? ''}
          placeholder="输入颜色值后点击「转换」查看全部格式输出"
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
  if (!value) return <span />;
  return (
    <button
      type="button"
      className="text-xs text-primary hover:underline"
      onClick={() => void copyTextWithFeedback(value)}
    >
      复制
    </button>
  );
}

/** 把任意异常格式化为可显示的错误文本(CommandError 附带错误码便于排障) */


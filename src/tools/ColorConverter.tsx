/**
 * 颜色转换器 —— 新代统一布局
 *
 * 结构(与 Base64Codec / JsonFormatter 一致):
 * - 顶部「配置」区:颜色值输入(原生取色器一键填入)+ 输入格式
 *   (默认「自动」嗅探:HEX / RGB(A) / HSL(A) / HSV / CMYK / CSS 名称)
 * - 输入变化后防抖自动转换(300ms),无需点击按钮
 * - 下方结果区:左侧色样预览(透明棋盘格)+ 明暗梯度 + 六种格式取值
 *   (逐项复制),右侧完整输出编辑器
 *
 * 解析与转换在 Rust 后端完成(rgba/hex 互转含 alpha、148 个 CSS 命名色、
 * 最近色名匹配);错误处理遵循新代约定:工具内联 alert 展示。
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, Pipette } from 'lucide-react';
import { formatError } from '@/lib/format-error';
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
  from_format: 'auto' | 'hex' | 'rgb' | 'hsl' | 'hsv' | 'cmyk' | 'name';
}

interface ColorExtra {
  hex: string;
  rgb: string;
  hsl: string;
  hsv: string;
  cmyk: string;
  alpha: number;
  nearest_name: string;
  exact_name?: string;
}

type ColorFormat = NonNullable<ColorParams['from_format']>;

const FORMAT_OPTIONS: readonly { value: ColorFormat; label: string }[] = [
  { value: 'auto', label: 'auto' },
  { value: 'hex', label: 'HEX' },
  { value: 'rgb', label: 'RGB / RGBA' },
  { value: 'hsl', label: 'HSL / HSLA' },
  { value: 'hsv', label: 'HSV / HSB' },
  { value: 'cmyk', label: 'CMYK' },
  { value: 'name', label: 'CSS 名称' },
];

/** #rrggbb / #rrggbbaa → [r,g,b,a](0-255 与 0-1) */
function parseHexLocal(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3 || h.length === 4
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

/** 与目标色(白/黑)按 ratio 混合,返回 #rrggbb */
function mixWith([r, g, b]: [number, number, number], target: number, ratio: number): string {
  const ch = (c: number): number => Math.round(c + (target - c) * ratio);
  return `#${[ch(r), ch(g), ch(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** 明暗梯度:5 阶变暗 + 原色 + 5 阶变亮 */
function shadeScale(hex: string): string[] {
  const [r, g, b] = parseHexLocal(hex);
  const shades = [1, 2, 3, 4, 5].map((i) => mixWith([r, g, b], 0, i / 6));
  const tints = [1, 2, 3, 4, 5].map((i) => mixWith([r, g, b], 255, i / 6));
  return [...shades.reverse(), hex, ...tints];
}

const CHECKERBOARD: React.CSSProperties = {
  backgroundImage: 'repeating-conic-gradient(var(--muted) 0% 25%, transparent 0% 50%)',
  backgroundSize: '16px 16px',
};

export function ColorConverter({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [fromFormat, setFromFormat] = useState<ColorFormat>('auto');
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const requestSeq = useRef(0);

  const handleConvert = useCallback(
    async (input: string, format: ColorFormat) => {
      const seq = ++requestSeq.current;
      setConverting(true);
      setError(null);
      try {
        const params: ColorParams = { from_format: format };
        const result = await invokeCommand<ToolOutput>('tool_execute', {
          toolId,
          input: { text: input, params },
        });
        if (seq === requestSeq.current) setOutput(result);
      } catch (e) {
        if (seq === requestSeq.current) {
          setOutput(null);
          setError(formatError(e));
        }
      } finally {
        if (seq === requestSeq.current) setConverting(false);
      }
    },
    [toolId],
  );

  // 输入/格式变化防抖自动转换;空输入不发请求(旧结果在渲染层按输入派生屏蔽)
  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const timer = window.setTimeout(() => void handleConvert(trimmed, fromFormat), 300);
    return () => window.clearTimeout(timer);
  }, [text, fromFormat, handleConvert]);

  const hasInput = text.trim() !== '';
  const visibleOutput = hasInput ? output : null;
  const visibleError = hasInput ? error : null;
  const showConverting = hasInput && converting;
  const extra = visibleOutput?.extra as ColorExtra | undefined;
  const scale = extra ? shadeScale(extra.hex.slice(0, 7)) : [];
  const alphaNote = extra && extra.alpha < 1 ? ` (${Math.round(extra.alpha * 100)}%)` : '';

  const valueRows: { label: string; value?: string; testId: string }[] = [
    { label: 'HEX', value: extra?.hex, testId: 'color-hex' },
    { label: 'RGB', value: extra?.rgb, testId: 'color-rgb' },
    { label: 'HSL', value: extra?.hsl, testId: 'color-hsl' },
    { label: 'HSV', value: extra?.hsv, testId: 'color-hsv' },
    { label: 'CMYK', value: extra?.cmyk, testId: 'color-cmyk' },
    {
      label: t('tools.color_converter.nearest_name'),
      value: extra
        ? extra.exact_name
          ? `${extra.exact_name}${alphaNote}`
          : `${extra.nearest_name}${alphaNote}`
        : undefined,
      testId: 'color-name',
    },
  ];

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 结果区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="color-converter"
    >
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
            className="w-72 text-sm"
            data-testid="input"
          />
          {/* 原生取色器:选择后以 HEX 填入输入框 */}
          <label
            className="flex size-7 cursor-pointer items-center justify-center rounded border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={t('tools.color_converter.pick_color')}
          >
            <Pipette aria-hidden className="size-3.5" />
            <input
              type="color"
              data-testid="color-picker"
              aria-label={t('tools.color_converter.pick_color')}
              className="sr-only"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        </ConfigRow>
        <ConfigRow
          icon={Palette}
          label={t('tools.color_converter.input_format')}
          hint={t('tools.color_converter.input_format_hint')}
        >
          <Select value={fromFormat} onValueChange={(v) => setFromFormat(v as ColorFormat)}>
            <SelectTrigger className="w-40" aria-label={t('tools.color_converter.input_format')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.value === 'name' ? t('tools.color_converter.format_name') : f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showConverting && (
            <span className="text-xs text-muted-foreground" data-testid="color-converting">
              {t('tools.color_converter.converting')}
            </span>
          )}
        </ConfigRow>
      </ConfigSection>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {visibleError && (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {visibleError}
          </div>
        )}

        {/* 结果区:左预览/取值 + 右输出编辑器;锚点保持 color_converter:result */}
        <div
          className="grid min-h-0 flex-1 grid-cols-2 gap-3"
          data-testid="output"
          data-search-anchor="color_converter:result"
        >
          <div className="flex min-h-0 flex-col gap-3">
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs font-semibold text-muted-foreground">
                {t('tools.color_converter.preview')}
              </div>
              {/* 色样:透明部分露出棋盘格 */}
              <div
                className="mt-2 h-16 rounded-md border"
                style={{ ...CHECKERBOARD, backgroundColor: extra?.hex }}
                aria-label={
                  extra
                    ? t('tools.color_converter.color_sample', { value: extra.hex })
                    : t('tools.color_converter.no_color_sample')
                }
              />
              {/* 明暗梯度 */}
              {extra && (
                <div
                  className="mt-2 flex h-6 overflow-hidden rounded-md border"
                  data-testid="color-shades"
                >
                  {scale.map((c, i) => (
                    // eslint-disable-next-line react-x/no-array-index-key -- 纯展示色阶条,色值可重复故需 index 参与键
                    <div key={`${c}-${i}`} className="flex-1" style={{ backgroundColor: c }} />
                  ))}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card p-3 text-sm">
              <div className="grid grid-cols-[60px_1fr_auto] gap-x-3 gap-y-2">
                {valueRows.map((row) => (
                  <ColorRow key={row.label} {...row} />
                ))}
              </div>
            </div>
          </div>
          <CodeEditor
            readOnly
            title={t('tools.color_converter.result_title')}
            language="plaintext"
            value={visibleOutput?.text ?? ''}
            placeholder={t('tools.color_converter.output_placeholder')}
            className="min-h-0"
            data-testid="output-editor"
            searchAnchor="color_converter:output"
            actions={
              visibleOutput?.text ? (
                <CopyAction text={visibleOutput.text} testId="output-copy" />
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

/** 取值行:HEX/RGB/… 与复制按钮;值为空时渲染占位保持网格对齐 */
function ColorRow({
  label,
  value,
  testId,
}: {
  label: string;
  value?: string;
  testId: string;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <span className="font-semibold">{label}</span>
      <code data-testid={testId} className="break-all font-mono">
        {value ?? '—'}
      </code>
      {value ? (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => void copyTextWithFeedback(value)}
        >
          {t('tools.color_converter.copy')}
        </button>
      ) : (
        <span />
      )}
    </>
  );
}

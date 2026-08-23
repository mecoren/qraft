/**
 * PNG 压缩器 —— 参考 DevToys.PngCompressor 的双引擎设计
 *
 * - 无损模式:OxiPNG(重压缩,像素不变,适合需要保持画质的场景)
 * - 有损模式:调色板量化(Rust 端中位切分实现,思路同 pngquant),
 *   可选 Floyd-Steinberg 抖动,输出 Indexed PNG
 *
 * 输入输出均经 base64 走 Rust `png_compress` 命令;结果展示前后字节数与节省比例。
 */
import { useCallback, useRef, useState, type DragEvent, type JSX } from 'react';
import { Download, FileImage, FolderOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { base64ToBytes, downloadBlob, formatBytes, readFileAsDataUrl } from '@/lib/file-utils';
import { invokeCommand } from '@/lib/ipc';
import type { ToolProps } from './registry';

interface PngCompressResult {
  base64: string;
  inputBytes: number;
  outputBytes: number;
  colorsUsed: number | null;
  durationMs: number;
}

interface LoadedImage {
  name: string;
  size: number;
  dataUrl: string;
}

/** 无损优化等级选项(OxiPNG preset) */
const LOSSLESS_LEVELS = [
  { value: '1', label: '快速(等级 1)' },
  { value: '2', label: '标准(等级 2)' },
  { value: '4', label: '高质量(等级 4)' },
  { value: '6', label: '极限(等级 6)' },
] as const;

/** 有损调色板颜色数选项 */
const COLOR_OPTIONS = ['64', '128', '192', '255'] as const;

export function PngCompressor(_props: ToolProps): JSX.Element {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [lossless, setLossless] = useState(true);
  const [level, setLevel] = useState('2');
  const [colors, setColors] = useState('192');
  const [dither, setDither] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PngCompressResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(async (file: File) => {
    if (file.type && file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
      toast.error('仅支持 PNG 文件');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setImage({ name: file.name, size: file.size, dataUrl });
      setResult(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const compress = useCallback(async () => {
    if (!image) return;
    setBusy(true);
    setResult(null);
    try {
      // dataURL → 纯 base64
      const base64 = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1);
      const res = await invokeCommand<PngCompressResult>('png_compress', {
        base64,
        params: {
          lossless,
          level: lossless ? Number(level) : undefined,
          colors: lossless ? undefined : Number(colors),
          dither: lossless ? undefined : dither,
        },
      });
      setResult(res);
      toast.success(`压缩完成:${formatBytes(res.inputBytes)} → ${formatBytes(res.outputBytes)}`);
    } catch (e) {
      toast.error(`压缩失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [image, lossless, level, colors, dither]);

  const downloadResult = useCallback(() => {
    if (!result || !image) return;
    const bytes = base64ToBytes(result.base64);
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/png' });
    const outName = image.name.replace(/\.png$/i, '') + (lossless ? '.min.png' : '.q.png');
    downloadBlob(outName, blob);
  }, [result, image, lossless]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  /** 压缩节省百分比(负数表示变大) */
  const saving =
    result && result.inputBytes > 0
      ? Math.round((1 - result.outputBytes / result.inputBytes) * 100)
      : null;

  return (
    <div className="flex h-full flex-col gap-3" data-testid="png-compressor">
      <ConfigSection title="" searchAnchor="png_compressor:config">
        <ConfigRow
          icon={FileImage}
          label="压缩模式"
          hint="无损 OxiPNG / 有损调色板量化(pngquant 思路)"
        >
          <Select value={lossless ? '1' : '0'} onValueChange={(v) => setLossless(v === '1')}>
            <SelectTrigger data-testid="pc-mode" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">无损(OxiPNG)</SelectItem>
              <SelectItem value="0">有损(调色板量化)</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        {lossless ? (
          <ConfigRow icon={FileImage} label="优化等级" hint="等级越高体积越小、耗时越长">
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger data-testid="pc-level" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOSSLESS_LEVELS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ConfigRow>
        ) : (
          <>
            <ConfigRow icon={FileImage} label="颜色数" hint="调色板条目上限">
              <Select value={colors} onValueChange={setColors}>
                <SelectTrigger data-testid="pc-colors" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLOR_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c === '255' ? '255(最高)' : c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ConfigRow>
            <ConfigRow icon={FileImage} label="抖动" hint="Floyd-Steinberg 抖动,渐变更平滑">
              <Switch checked={dither} onCheckedChange={setDither} data-testid="pc-dither" />
            </ConfigRow>
          </>
        )}
      </ConfigSection>

      {/* 图片区 */}
      <div className="flex items-center justify-between" data-search-anchor="png_compressor:image">
        <h2 className="text-body-sm font-semibold">图片</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            data-testid="pc-open"
            onClick={() => fileRef.current?.click()}
          >
            <FolderOpen aria-hidden className="size-3.5" /> 选择 PNG
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="pc-clear"
            disabled={!image}
            onClick={() => {
              setImage(null);
              setResult(null);
            }}
          >
            <X aria-hidden className="size-3.5" /> 清除
          </Button>
          <Button
            size="sm"
            data-testid="pc-compress"
            disabled={!image || busy}
            onClick={() => void compress()}
          >
            <Download aria-hidden className="size-3.5" />
            {busy ? '压缩中…' : '压缩'}
          </Button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,.png"
        className="hidden"
        data-testid="pc-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadFile(file);
          e.target.value = '';
        }}
      />
      <ScrollArea
        data-testid="pc-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`min-h-0 flex-1 rounded-lg border ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-card'
        } shadow-card transition-colors`}
      >
        <div className="flex h-full min-h-full flex-col items-center justify-center gap-2 p-4">
          {image ? (
            <>
              <img
                src={image.dataUrl}
                alt={image.name}
                data-testid="pc-preview"
                className="max-h-[60%] max-w-full object-contain"
              />
              <p className="text-xs text-muted-foreground" data-testid="pc-info">
                {image.name} · 原始 {formatBytes(image.size)}
              </p>
              {result && (
                <div
                  className="flex flex-col items-center gap-1 rounded-md border bg-background px-4 py-2 text-xs"
                  data-testid="pc-result"
                >
                  <span>
                    {formatBytes(result.inputBytes)} →{' '}
                    <span
                      className={saving !== null && saving > 0 ? 'font-semibold text-primary' : ''}
                    >
                      {formatBytes(result.outputBytes)}
                    </span>
                    {saving !== null && (
                      <span className="ml-1 text-muted-foreground">
                        ({saving > 0 ? `节省 ${saving}%` : `增大 ${-saving}%`})
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    耗时 {result.durationMs}ms
                    {result.colorsUsed !== null && ` · ${result.colorsUsed} 色`}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={downloadResult}
                    data-testid="pc-download"
                  >
                    <Download aria-hidden className="size-3.5" />
                    保存压缩结果
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <FileImage aria-hidden className="size-8" />
              <p className="text-xs">拖放 PNG 到此处,或点击「选择 PNG」</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

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
import { useTranslation } from 'react-i18next';
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

/** 无损优化等级选项(OxiPNG preset);label 为 i18n 键,渲染时经 t() 翻译 */
const LOSSLESS_LEVELS = [
  { value: '1', label: 'tools.png_compressor.level_1' },
  { value: '2', label: 'tools.png_compressor.level_2' },
  { value: '4', label: 'tools.png_compressor.level_4' },
  { value: '6', label: 'tools.png_compressor.level_6' },
] as const;

/** 有损调色板颜色数选项 */
const COLOR_OPTIONS = ['64', '128', '192', '255'] as const;

export function PngCompressor(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [lossless, setLossless] = useState(true);
  const [level, setLevel] = useState('2');
  const [colors, setColors] = useState('192');
  const [dither, setDither] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PngCompressResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(
    async (file: File) => {
      if (file.type && file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
        toast.error(t('tools.png_compressor.only_png_files'));
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setImage({ name: file.name, size: file.size, dataUrl });
        setResult(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [t],
  );

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
      toast.success(
        t('tools.png_compressor.compress_success', {
          input: formatBytes(res.inputBytes),
          output: formatBytes(res.outputBytes),
        }),
      );
    } catch (e) {
      toast.error(
        t('tools.png_compressor.compress_failed', {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [image, lossless, level, colors, dither, t]);

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
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与内容区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="png-compressor"
    >
      <ConfigSection title="" searchAnchor="png_compressor:config">
        <ConfigRow
          icon={FileImage}
          label={t('tools.png_compressor.label_mode')}
          hint={t('tools.png_compressor.hint_mode')}
        >
          <Select value={lossless ? '1' : '0'} onValueChange={(v) => setLossless(v === '1')}>
            <SelectTrigger data-testid="pc-mode" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t('tools.png_compressor.mode_lossless')}</SelectItem>
              <SelectItem value="0">{t('tools.png_compressor.mode_lossy')}</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        {lossless ? (
          <ConfigRow
            icon={FileImage}
            label={t('tools.png_compressor.label_level')}
            hint={t('tools.png_compressor.hint_level')}
          >
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger data-testid="pc-level" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOSSLESS_LEVELS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {t(l.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ConfigRow>
        ) : (
          <>
            <ConfigRow
              icon={FileImage}
              label={t('tools.png_compressor.label_colors')}
              hint={t('tools.png_compressor.hint_colors')}
            >
              <Select value={colors} onValueChange={setColors}>
                <SelectTrigger data-testid="pc-colors" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLOR_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c === '255' ? t('tools.png_compressor.colors_max') : c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ConfigRow>
            <ConfigRow
              icon={FileImage}
              label={t('tools.png_compressor.label_dither')}
              hint={t('tools.png_compressor.hint_dither')}
            >
              <Switch checked={dither} onCheckedChange={setDither} data-testid="pc-dither" />
            </ConfigRow>
          </>
        )}
      </ConfigSection>

      {/* 内容区:图片工具栏 + 拖放区收进带内边距的滚动区(内卡降级为 rounded-md) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {/* 图片区 */}
        <div
          className="flex items-center justify-between"
          data-search-anchor="png_compressor:image"
        >
          <h2 className="text-body-sm font-semibold">{t('tools.png_compressor.section_image')}</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid="pc-open"
              onClick={() => fileRef.current?.click()}
            >
              <FolderOpen aria-hidden className="size-3.5" /> {t('tools.png_compressor.choose_png')}
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
              <X aria-hidden className="size-3.5" /> {t('tools.png_compressor.clear')}
            </Button>
            <Button
              size="sm"
              data-testid="pc-compress"
              disabled={!image || busy}
              onClick={() => void compress()}
            >
              <Download aria-hidden className="size-3.5" />
              {busy ? t('tools.png_compressor.compressing') : t('tools.png_compressor.compress')}
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
          className={`min-h-0 flex-1 rounded-md border ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border bg-card'
          } transition-colors`}
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
                  {t('tools.png_compressor.original_size', {
                    name: image.name,
                    size: formatBytes(image.size),
                  })}
                </p>
                {result && (
                  <div
                    className="flex flex-col items-center gap-1 rounded-md border bg-background px-4 py-2 text-xs"
                    data-testid="pc-result"
                  >
                    <span>
                      {formatBytes(result.inputBytes)} →{' '}
                      <span
                        className={
                          saving !== null && saving > 0 ? 'font-semibold text-primary' : ''
                        }
                      >
                        {formatBytes(result.outputBytes)}
                      </span>
                      {saving !== null && (
                        <span className="ml-1 text-muted-foreground">
                          (
                          {saving > 0
                            ? t('tools.png_compressor.saving_percent', { percent: saving })
                            : t('tools.png_compressor.increase_percent', { percent: -saving })}
                          )
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {t('tools.png_compressor.duration_ms', { ms: result.durationMs })}
                      {result.colorsUsed !== null &&
                        ` · ${result.colorsUsed} ${t('tools.png_compressor.color_unit')}`}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={downloadResult}
                      data-testid="pc-download"
                    >
                      <Download aria-hidden className="size-3.5" />
                      {t('tools.png_compressor.save_result')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <FileImage aria-hidden className="size-8" />
                <p className="text-xs">{t('tools.png_compressor.dropzone_hint')}</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

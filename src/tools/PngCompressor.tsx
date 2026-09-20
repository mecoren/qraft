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
import { Download, FileImage, FolderOpen, Layers, Play, X } from 'lucide-react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { base64ToBytes, downloadBlob, formatBytes, readFileAsDataUrl } from '@/lib/file-utils';
import { invokeCommand } from '@/lib/ipc';
import { batchSummary, makeBatchItems, runBatch, type BatchItem } from './image-batch';
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
  /** 批量队列(≥2 文件进入批量模式;PNG 校验同单文件) */
  const [batch, setBatch] = useState<BatchItem<null>[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const batchMode = batch.length > 0;

  /** PNG 校验(单/批量共用):MIME 或扩展名任一命中即接受 */
  const isPng = useCallback((file: File): boolean => {
    return !file.type || file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
  }, []);

  const loadFile = useCallback(
    async (file: File) => {
      if (!isPng(file)) {
        toast.error(t('tools.png_compressor.only_png_files'));
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setImage({ name: file.name, size: file.size, dataUrl });
        setResult(null);
        setBatch([]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [isPng, t],
  );

  /** 入口分流:多文件入批量队列,单文件走既有对比预览 */
  const intake = useCallback(
    (files: readonly File[]) => {
      const pngs = files.filter(isPng);
      if (pngs.length === 0) {
        toast.error(t('tools.png_compressor.only_png_files'));
        return;
      }
      if (pngs.length === 1) void loadFile(pngs[0]!);
      else {
        setBatch(makeBatchItems<null>(pngs));
        setImage(null);
        setResult(null);
      }
    },
    [isPng, loadFile, t],
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

  /** 批量单项:读文件 → png_compress(与单文件同参数)→ 产物下载 */
  const runBatchItem = useCallback(
    async (item: BatchItem<null>) => {
      const dataUrl = await readFileAsDataUrl(item.file);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const res = await invokeCommand<PngCompressResult>('png_compress', {
        base64,
        params: {
          lossless,
          level: lossless ? Number(level) : undefined,
          colors: lossless ? undefined : Number(colors),
          dither: lossless ? undefined : dither,
        },
      });
      const outName = item.file.name.replace(/\.png$/i, '') + (lossless ? '.min.png' : '.q.png');
      const download = () => {
        const bytes = base64ToBytes(res.base64);
        downloadBlob(
          outName,
          new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/png' }),
        );
      };
      return { outputBytes: res.outputBytes, download, result: null };
    },
    [colors, dither, level, lossless],
  );

  const onRunBatch = useCallback(async () => {
    if (batchRunning || batch.length === 0) return;
    setBatchRunning(true);
    try {
      const out = await runBatch(batch, {
        run: runBatchItem,
        onUpdate: setBatch,
        shouldStop: () => false,
      });
      const s = batchSummary(out);
      if (s.error > 0) {
        toast.warning(t('tools.png_compressor.batch_partial', { done: s.done, error: s.error }));
      } else {
        toast.success(t('tools.png_compressor.batch_done', { count: s.done }));
      }
    } finally {
      setBatchRunning(false);
    }
  }, [batch, batchRunning, runBatchItem, t]);

  const onDownloadAll = useCallback(() => {
    for (const item of batch) {
      if (item.status === 'done' && item.download) item.download();
    }
  }, [batch]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = [...(e.dataTransfer.files ?? [])];
      if (files.length > 0) intake(files);
    },
    [intake],
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
      <ConfigSection
        headerHint={t('tools.png_compressor.section_hint')}
        searchAnchor="png_compressor:config"
      >
        <ConfigRow
          icon={FileImage}
          caption={t('tools.png_compressor.caption_mode')}
          captionHint={t('tools.png_compressor.hint_mode')}
        >
          {/* 二选一模式用分段控件而非下拉,与 Base64Codec 基准同形态 */}
          <Tabs
            value={lossless ? 'lossless' : 'lossy'}
            onValueChange={(v) => setLossless(v === 'lossless')}
          >
            <TabsList className="h-7 w-fit">
              <TabsTrigger
                value="lossless"
                data-testid="pc-mode-lossless"
                className="px-2 py-0.5 text-xs"
              >
                {t('tools.png_compressor.mode_lossless')}
              </TabsTrigger>
              <TabsTrigger
                value="lossy"
                data-testid="pc-mode-lossy"
                className="px-2 py-0.5 text-xs"
              >
                {t('tools.png_compressor.mode_lossy')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </ConfigRow>
        {lossless ? (
          <ConfigRow
            icon={FileImage}
            caption={t('tools.png_compressor.caption_level')}
            captionHint={t('tools.png_compressor.hint_level')}
          >
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger data-testid="pc-level" className="h-7 w-40 text-xs">
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
              caption={t('tools.png_compressor.label_colors')}
              captionHint={t('tools.png_compressor.hint_colors')}
            >
              <Select value={colors} onValueChange={setColors}>
                <SelectTrigger data-testid="pc-colors" className="h-7 w-40 text-xs">
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
              caption={t('tools.png_compressor.label_dither')}
              captionHint={t('tools.png_compressor.hint_dither')}
            >
              <Switch
                checked={dither}
                onCheckedChange={setDither}
                aria-label={t('tools.png_compressor.label_dither')}
                data-testid="pc-dither"
              />
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
            {batchMode ? (
              <>
                <Button
                  size="sm"
                  data-testid="pc-batch-run"
                  disabled={batchRunning || batch.every((i) => i.status !== 'pending')}
                  onClick={() => void onRunBatch()}
                >
                  <Play aria-hidden className="size-3.5" />
                  {batchRunning
                    ? t('tools.png_compressor.batch_running')
                    : t('tools.png_compressor.batch_run')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="pc-batch-download-all"
                  disabled={!batch.some((i) => i.status === 'done')}
                  onClick={onDownloadAll}
                >
                  <Download aria-hidden className="size-3.5" />
                  {t('tools.png_compressor.batch_download_all')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="pc-batch-clear"
                  onClick={() => setBatch([])}
                >
                  <X aria-hidden className="size-3.5" /> {t('tools.png_compressor.clear')}
                </Button>
              </>
            ) : (
              <>
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
                  {busy
                    ? t('tools.png_compressor.compressing')
                    : t('tools.png_compressor.compress')}
                </Button>
              </>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,.png"
          multiple
          className="hidden"
          data-testid="pc-file"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length > 0) intake(files);
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
            {batchMode ? (
              <>
                <div className="flex w-full max-w-2xl items-center gap-2 text-xs text-muted-foreground">
                  <Layers aria-hidden className="size-3.5" />
                  <span data-testid="pc-batch-summary">
                    {t('tools.png_compressor.batch_summary', {
                      count: batch.length,
                      done: batchSummary(batch).done,
                    })}
                    {batchSummary(batch).totalSaved > 0 &&
                      ` · ${t('tools.png_compressor.batch_saved', {
                        size: formatBytes(batchSummary(batch).totalSaved),
                      })}`}
                  </span>
                </div>
                <ul
                  className="w-full max-w-2xl space-y-1 overflow-auto"
                  data-testid="pc-batch-list"
                >
                  {batch.map((item) => (
                    <li
                      key={item.id}
                      data-testid="pc-batch-item"
                      className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                        {item.file.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {formatBytes(item.inputBytes)}
                      </span>
                      {item.status === 'done' && item.outputBytes !== null && (
                        <span className="shrink-0 font-medium text-primary tabular-nums">
                          {formatBytes(item.outputBytes)}
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span
                          className="max-w-40 shrink-0 truncate text-destructive"
                          title={item.error ?? ''}
                          data-testid="pc-batch-item-error"
                        >
                          {t('tools.png_compressor.batch_item_failed')}
                        </span>
                      )}
                      {item.status === 'done' && item.download && (
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={item.download}
                          title={t('tools.png_compressor.batch_download_one')}
                        >
                          <Download aria-hidden className="size-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : image ? (
              <>
                {/* 原始 / 压缩后并排对比 */}
                <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
                  <div className="flex flex-col items-center gap-1" data-testid="pc-original-pane">
                    <img
                      src={image.dataUrl}
                      alt={image.name}
                      data-testid="pc-preview"
                      className="max-h-56 max-w-full object-contain"
                    />
                    <p className="text-xs text-muted-foreground" data-testid="pc-info">
                      {t('tools.png_compressor.pane_original', {
                        size: formatBytes(image.size),
                      })}
                    </p>
                  </div>
                  <div
                    className="flex flex-col items-center gap-1"
                    data-testid="pc-compressed-pane"
                  >
                    {result ? (
                      <>
                        <img
                          src={`data:image/png;base64,${result.base64}`}
                          alt="compressed"
                          data-testid="pc-compressed-preview"
                          className="max-h-56 max-w-full object-contain"
                        />
                        <p className="text-xs" data-testid="pc-result">
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
                                : t('tools.png_compressor.increase_percent', {
                                    percent: -saving,
                                  })}
                              )
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('tools.png_compressor.duration_ms', { ms: result.durationMs })}
                          {result.colorsUsed !== null &&
                            ` · ${result.colorsUsed} ${t('tools.png_compressor.color_unit')}`}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={downloadResult}
                          data-testid="pc-download"
                        >
                          <Download aria-hidden className="size-3.5" />
                          {t('tools.png_compressor.save_result')}
                        </Button>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t('tools.png_compressor.pane_pending')}
                      </p>
                    )}
                  </div>
                </div>
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

/**
 * 图片格式转换器 —— canvas 重编码 + 缩放 + 背景合成
 *
 * - 输入:任意浏览器可解码图片(PNG / JPEG / WebP / BMP / GIF / SVG 首帧)
 * - 转换:目标格式(PNG / JPEG / WebP)+ 质量滑杆(JPEG/WebP)+ 自定义缩放(百分比
 *   或精确宽高,锁定纵横比)+ JPEG/WebP 背景色合成(消除透明变黑)
 * - 输出:实时预览 + 体积/尺寸信息 + 一键下载
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileImage, FolderOpen, Maximize2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { downloadBlob, formatBytes, readFileAsDataUrl } from '@/lib/file-utils';
import type { ToolProps } from './registry';

type TargetFormat = 'image/png' | 'image/jpeg' | 'image/webp';

const FORMAT_LABEL: Record<TargetFormat, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};

const EXT: Record<TargetFormat, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

interface LoadedImage {
  name: string;
  size: number;
  type: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** 常用背景色预设(十六进制不含 #) */
const BG_PRESETS = ['ffffff', '000000', '0f172a'] as const;

export function ImageConverter(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [format, setFormat] = useState<TargetFormat>('image/png');
  const [quality, setQuality] = useState(92);
  const [bgColor, setBgColor] = useState('ffffff');
  const [useBg, setUseBg] = useState(true);
  const [scalePercent, setScalePercent] = useState(100);
  const [exactWidth, setExactWidth] = useState('');
  const [dragOver, setDragOver] = useState(false);
  /** 实时转换产物:预览 + 体积 */
  const [preview, setPreview] = useState<{ dataUrl: string; bytes: number; w: number; h: number } | null>(
    null,
  );
  const [converting, setConverting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error(t('tools.image_converter.only_image_files'));
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(t('tools.image_converter.error_decode')));
          img.src = dataUrl;
        });
        setImage({
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        setExactWidth('');
        setScalePercent(100);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [t],
  );

  /** 计算输出尺寸:精确宽优先(锁定纵横比),否则百分比缩放 */
  const targetSize = useMemo(() => {
    if (!image) return null;
    if (exactWidth && Number(exactWidth) > 0) {
      const w = Math.round(Number(exactWidth));
      return { w, h: Math.max(1, Math.round((w / image.width) * image.height)) };
    }
    return {
      w: Math.max(1, Math.round((image.width * scalePercent) / 100)),
      h: Math.max(1, Math.round((image.height * scalePercent) / 100)),
    };
  }, [image, exactWidth, scalePercent]);

  /** canvas 转换:格式/质量/缩放/背景 → dataUrl + 体积 */
  const convert = useCallback(async (): Promise<string | null> => {
    if (!image || !targetSize) return null;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(t('tools.image_converter.error_image_load')));
      img.src = image.dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = targetSize.w;
    canvas.height = targetSize.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      toast.error(t('tools.image_converter.error_canvas'));
      return null;
    }
    // 高质量下采样
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // JPEG 无透明通道:需要透明时先铺背景(默认开),否则直接黑底
    const needsBg = format === 'image/jpeg' || (format === 'image/webp' && useBg);
    if (needsBg) {
      ctx.fillStyle = `#${/^[\da-f]{6}$/i.test(bgColor) ? bgColor : 'ffffff'}`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL(format, quality / 100);
    return dataUrl;
  }, [image, targetSize, format, quality, bgColor, useBg, t]);

  // 参数变化即重转(防抖 250ms);结果 dataUrl 直接可预览。
  // 所有 setState 走异步路径,避免 effect 内同步 setState 触发级联渲染
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (!image) {
        setPreview(null);
        return;
      }
      setConverting(true);
      void convert().then((dataUrl) => {
        if (cancelled) return;
        setConverting(false);
        if (!dataUrl) {
          setPreview(null);
          return;
        }
        // dataUrl base64 长度 → 字节数(近似)
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const bytes = Math.round((base64.length * 3) / 4);
        setPreview({
          dataUrl,
          bytes,
          w: targetSize?.w ?? image.width,
          h: targetSize?.h ?? image.height,
        });
      });
    }, image ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [image, convert, targetSize]);

  const download = useCallback(async () => {
    if (!preview || !image) return;
    const res = await fetch(preview.dataUrl);
    const blob = await res.blob();
    const base = image.name.replace(/\.[^.]+$/, '') || 'image';
    const suffix =
      targetSize &&
      (targetSize.w !== image.width || targetSize.h !== image.height)
        ? `-${targetSize.w}x${targetSize.h}`
        : '';
    downloadBlob(`${base}${suffix}.${EXT[format]}`, blob);
    toast.success(
      t('tools.image_converter.exported_with_size', {
        format: FORMAT_LABEL[format],
        size: formatBytes(preview.bytes),
      }),
    );
  }, [preview, image, format, targetSize, t]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与内容区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="image-converter"
    >
      <ConfigSection title="" searchAnchor="image_converter:config">
        <ConfigRow icon={FileImage} label={t('tools.image_converter.label_target_format')}>
          <Select value={format} onValueChange={(v) => setFormat(v as TargetFormat)}>
            <SelectTrigger data-testid="ic-format" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FORMAT_LABEL) as TargetFormat[]).map((f) => (
                <SelectItem key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        {format !== 'image/png' ? (
          <ConfigRow
            icon={FileImage}
            label={t('tools.image_converter.label_quality')}
            hint={t('tools.image_converter.hint_quality')}
          >
            <div className="flex items-center gap-3">
              <span data-testid="ic-quality-value" className="w-8 text-right text-xs tabular-nums">
                {quality}
              </span>
              <input
                type="range"
                min={10}
                max={100}
                step={1}
                value={quality}
                data-testid="ic-quality"
                aria-label={t('tools.image_converter.label_quality')}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="h-1.5 w-32 cursor-pointer accent-primary"
              />
            </div>
          </ConfigRow>
        ) : null}
        <ConfigRow
          icon={Maximize2}
          label={t('tools.image_converter.label_scale')}
          hint={t('tools.image_converter.hint_scale')}
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={10}
              max={200}
              step={5}
              value={scalePercent}
              data-testid="ic-scale"
              aria-label={t('tools.image_converter.label_scale')}
              onChange={(e) => {
                setScalePercent(Number(e.target.value));
                setExactWidth('');
              }}
              className="h-1.5 w-32 cursor-pointer accent-primary"
            />
            <span data-testid="ic-scale-value" className="w-10 text-right text-xs tabular-nums">
              {scalePercent}%
            </span>
          </div>
        </ConfigRow>
        <ConfigRow
          icon={Maximize2}
          label={t('tools.image_converter.label_exact_width')}
          hint={t('tools.image_converter.hint_exact_width')}
        >
          <Input
            type="number"
            min={1}
            className="w-28"
            data-testid="ic-width"
            aria-label={t('tools.image_converter.label_exact_width')}
            value={exactWidth}
            placeholder={image ? String(image.width) : 'auto'}
            onChange={(e) => setExactWidth(e.target.value)}
          />
          {targetSize && (
            <span data-testid="ic-out-size" className="text-xs text-muted-foreground tabular-nums">
              {targetSize.w}×{targetSize.h}
            </span>
          )}
        </ConfigRow>
        {format !== 'image/png' ? (
          <ConfigRow
            icon={FileImage}
            label={t('tools.image_converter.label_bg')}
            hint={t('tools.image_converter.hint_bg')}
          >
            <div className="flex items-center gap-2">
              <Switch
                data-testid="ic-bg-switch"
                checked={useBg}
                onCheckedChange={setUseBg}
                aria-label={t('tools.image_converter.label_bg')}
              />
              <input
                type="color"
                data-testid="ic-bg-color"
                aria-label={t('tools.image_converter.label_bg_color')}
                className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
                value={`#${bgColor}`}
                onChange={(e) => setBgColor(e.target.value.slice(1))}
                disabled={format === 'image/jpeg' || !useBg}
              />
              <Select value={bgColor} onValueChange={setBgColor}>
                <SelectTrigger data-testid="ic-bg-preset" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BG_PRESETS.map((c) => (
                    <SelectItem key={c} value={c}>
                      #{c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </ConfigRow>
        ) : null}
      </ConfigSection>

      {/* 内容区:图片工具栏 + 拖放区收进带内边距的滚动区(内卡降级为 rounded-md) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {/* 图片区 */}
        <div
          className="flex items-center justify-between"
          data-search-anchor="image_converter:image"
        >
          <h2 className="text-body-sm font-semibold">{t('tools.image_converter.section_image')}</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid="ic-open"
              onClick={() => fileRef.current?.click()}
            >
              <FolderOpen aria-hidden className="size-3.5" />{' '}
              {t('tools.image_converter.choose_image')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="ic-clear"
              disabled={!image}
              onClick={() => {
                setImage(null);
                setPreview(null);
              }}
            >
              <X aria-hidden className="size-3.5" /> {t('tools.image_converter.clear')}
            </Button>
            <Button
              size="sm"
              data-testid="ic-download"
              disabled={!preview}
              onClick={() => void download()}
            >
              <Download aria-hidden className="size-3.5" />{' '}
              {t('tools.image_converter.convert_export')}
            </Button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="ic-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = '';
          }}
        />
        <ScrollArea
          data-testid="ic-dropzone"
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
                  data-testid="ic-preview"
                  className="max-h-[55%] max-w-full object-contain"
                />
                {/* 转换后预览与信息 */}
                {preview && (
                  <div
                    className="flex flex-col items-center gap-1"
                    data-testid="ic-result"
                  >
                    <Label>{t('tools.image_converter.output_preview')}</Label>
                    <img
                      src={preview.dataUrl}
                      alt={t('tools.image_converter.output_preview')}
                      data-testid="ic-output-preview"
                      className="max-h-40 max-w-full rounded-md border border-border object-contain"
                    />
                    <p className="text-xs text-muted-foreground" data-testid="ic-output-info">
                      {converting
                        ? t('tools.image_converter.converting')
                        : `${FORMAT_LABEL[format]} · ${preview.w}×${preview.h} · ~${formatBytes(preview.bytes)}`}
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground" data-testid="ic-info">
                  {image.name} · {image.width}×{image.height} · {formatBytes(image.size)} ·{' '}
                  {image.type}
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <FileImage aria-hidden className="size-8" />
                <p className="text-xs">{t('tools.image_converter.dropzone_hint')}</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

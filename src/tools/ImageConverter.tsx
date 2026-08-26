/**
 * 图片格式转换器 —— canvas 重编码(PNG / JPEG / WebP / BMP 输入,输出 PNG / JPEG / WebP)
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

export function ImageConverter(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [format, setFormat] = useState<TargetFormat>('image/png');
  const [quality, setQuality] = useState('0.92');
  const [dragOver, setDragOver] = useState(false);
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
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [t],
  );

  const convert = useCallback(async () => {
    if (!image) return;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(t('tools.image_converter.error_image_load')));
      img.src = image.dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      toast.error(t('tools.image_converter.error_canvas'));
      return;
    }
    // JPEG 无透明通道:先铺白底
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, format, Number(quality)),
    );
    if (!blob) {
      toast.error(t('tools.image_converter.error_convert_unsupported'));
      return;
    }
    const base = image.name.replace(/\.[^.]+$/, '') || 'image';
    downloadBlob(`${base}.${EXT[format]}`, blob);
    toast.success(
      t('tools.image_converter.exported_with_size', {
        format: FORMAT_LABEL[format],
        size: formatBytes(blob.size),
      }),
    );
  }, [image, format, quality, t]);

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
    <div className="flex h-full flex-col gap-3" data-testid="image-converter">
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
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger data-testid="ic-quality" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t('tools.image_converter.quality_best')}</SelectItem>
                <SelectItem value="0.92">{t('tools.image_converter.quality_high')}</SelectItem>
                <SelectItem value="0.8">{t('tools.image_converter.quality_medium')}</SelectItem>
                <SelectItem value="0.6">{t('tools.image_converter.quality_low')}</SelectItem>
              </SelectContent>
            </Select>
          </ConfigRow>
        ) : null}
      </ConfigSection>

      {/* 图片区 */}
      <div className="flex items-center justify-between" data-search-anchor="image_converter:image">
        <h2 className="text-body-sm font-semibold">{t('tools.image_converter.section_image')}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            data-testid="ic-open"
            onClick={() => fileRef.current?.click()}
          >
            <FolderOpen aria-hidden className="size-3.5" /> {t('tools.image_converter.choose_image')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="ic-clear"
            disabled={!image}
            onClick={() => setImage(null)}
          >
            <X aria-hidden className="size-3.5" /> {t('tools.image_converter.clear')}
          </Button>
          <Button
            size="sm"
            data-testid="ic-convert"
            disabled={!image}
            onClick={() => void convert()}
          >
            <Download aria-hidden className="size-3.5" /> {t('tools.image_converter.convert_export')}
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
                data-testid="ic-preview"
                className="max-h-[70%] max-w-full object-contain"
              />
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
  );
}

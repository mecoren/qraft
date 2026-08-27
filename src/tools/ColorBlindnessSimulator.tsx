/**
 * 色盲模拟器 —— canvas 像素级颜色矩阵变换
 *
 * 模拟三种色觉缺陷:红色盲(Protanopia)/ 绿色盲(Deuteranopia)/ 蓝色盲(Tritanopia)
 * 采用 Brettel/Viénot 近似矩阵(线性 RGB 域)。
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, EyeOff, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { readFileAsDataUrl } from '@/lib/file-utils';
import type { ToolProps } from './registry';

type Deficiency = 'protanopia' | 'deuteranopia' | 'tritanopia';

/** 各色觉缺陷的 i18n 标签键,渲染时经 t() 翻译 */
const LABELS: Record<Deficiency, string> = {
  protanopia: 'tools.color_blindness_simulator.deficiency_protanopia',
  deuteranopia: 'tools.color_blindness_simulator.deficiency_deuteranopia',
  tritanopia: 'tools.color_blindness_simulator.deficiency_tritanopia',
};

/** Viénot 1999 近似矩阵(sRGB 线性域) */
const MATRICES: Record<Deficiency, number[]> = {
  protanopia: [0.11238, 0.88762, 0.0, 0.11238, 0.88762, 0.0, 0.00401, -0.00401, 1.0],
  deuteranopia: [0.29275, 0.70725, 0.0, 0.29275, 0.70725, 0.0, -0.02234, 0.02234, 1.0],
  tritanopia: [1.0, 0.14461, -0.14461, 0.0, 0.85924, 0.14076, 0.0, 0.85924, 0.14076],
};

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

export function applyDeficiency(imageData: ImageData, kind: Deficiency): ImageData {
  const m = MATRICES[kind];
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = srgbToLinear(d[i]);
    const g = srgbToLinear(d[i + 1]);
    const b = srgbToLinear(d[i + 2]);
    d[i] = linearToSrgb(m[0] * r + m[1] * g + m[2] * b);
    d[i + 1] = linearToSrgb(m[3] * r + m[4] * g + m[5] * b);
    d[i + 2] = linearToSrgb(m[6] * r + m[7] * g + m[8] * b);
  }
  return imageData;
}

export function ColorBlindnessSimulator(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [srcUrl, setSrcUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<Record<Deficiency, string> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error(t('tools.color_blindness_simulator.only_image_files'));
        return;
      }
      try {
        setSrcUrl(await readFileAsDataUrl(file));
      } catch (e) {
        toast.error(
          t('tools.color_blindness_simulator.read_failed', {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
    [t],
  );

  // 源图变化 → 生成三种模拟图
  useEffect(() => {
    let cancelled = false;
    if (!srcUrl) {
      // 空输入走微任务,避免在 effect 中同步 setState 触发级联渲染
      void Promise.resolve().then(() => {
        if (!cancelled) setResults(null);
      });
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      // 限制处理尺寸,避免大图卡顿
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const original = ctx.getImageData(0, 0, w, h);

      const out = {} as Record<Deficiency, string>;
      for (const kind of Object.keys(MATRICES) as Deficiency[]) {
        const copy = new ImageData(new Uint8ClampedArray(original.data), w, h);
        applyDeficiency(copy, kind);
        ctx.putImageData(copy, 0, 0);
        out[kind] = canvas.toDataURL('image/png');
      }
      if (!cancelled) setResults(out);
    };
    img.onerror = () => toast.error(t('tools.color_blindness_simulator.error_image_load'));
    img.src = srcUrl;
    return () => {
      cancelled = true;
    };
  }, [srcUrl, t]);

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
    <div className="flex h-full flex-col gap-3" data-testid="color-blindness-simulator">
      <div
        className="flex items-center justify-between"
        data-search-anchor="color_blindness_simulator:source"
      >
        <h2 className="text-body-sm font-semibold">
          {t('tools.color_blindness_simulator.source_title')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          data-testid="cb-open"
          onClick={() => fileRef.current?.click()}
        >
          <FolderOpen aria-hidden className="size-3.5" />{' '}
          {t('tools.color_blindness_simulator.choose_image')}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="cb-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadFile(file);
          e.target.value = '';
        }}
      />

      <div
        className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3"
        data-search-anchor="color_blindness_simulator:preview"
      >
        {/* 原图 / 拖放区 */}
        <div
          data-testid="cb-dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex min-h-0 flex-col rounded-lg border ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border bg-card'
          } p-3 shadow-card transition-colors`}
        >
          <span className="mb-2 text-xs text-muted-foreground">
            {t('tools.color_blindness_simulator.original')}
          </span>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            {srcUrl ? (
              <img
                src={srcUrl}
                alt={t('tools.color_blindness_simulator.original')}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <EyeOff aria-hidden className="size-8" />
                <p className="text-xs">{t('tools.color_blindness_simulator.dropzone_hint')}</p>
              </div>
            )}
          </div>
        </div>

        {(Object.keys(LABELS) as Deficiency[]).map((kind) => (
          <div
            key={kind}
            className="flex min-h-0 flex-col rounded-lg border border-border bg-card p-3 shadow-card"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t(LABELS[kind])}</span>
              {results ? (
                <a
                  href={results[kind]}
                  download={`${kind}.png`}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Download aria-hidden className="size-3" />{' '}
                  {t('tools.color_blindness_simulator.save')}
                </a>
              ) : null}
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              {results ? (
                <img
                  src={results[kind]}
                  alt={t(LABELS[kind])}
                  data-testid={`cb-${kind}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <p className="text-xs text-muted-foreground">-</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

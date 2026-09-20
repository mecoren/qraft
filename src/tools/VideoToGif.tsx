/**
 * 视频转 GIF —— 前端抽帧 + Rust 编码的混合架构
 *
 * - 抽帧(前端):`<video>` 按时间轴逐帧 seek + canvas `drawImage` 抓 RGBA
 *   (时间精确;WebView 原生解码,格式覆盖随系统 WebView)
 * - 编码(Rust):全部帧的 RGBA 数组经 `gif_encode` 命令过 IPC,
 *   GIF89a 全局调色板(中位切分 ≤256 色)+ LZW 压缩,NETSCAPE2.0 无限循环
 *
 * 参数:片段起止(默认 0~3s)、帧率(5/10/15/24)、输出宽度(等比缩放)。
 * 抽帧进度逐帧上报;产物经「下载」落盘。
 */
import { useCallback, useRef, useState, type DragEvent, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Clapperboard, Download, FolderOpen, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { base64ToBytes, downloadBlob, formatBytes, readFileAsDataUrl } from '@/lib/file-utils';
import { invokeCommand } from '@/lib/ipc';
import type { ToolProps } from './registry';

/** gif_encode 返回载荷(Rust GifEncodeResult 的 camelCase 形态) */
interface GifEncodeResult {
  base64: string;
  outputBytes: number;
  frames: number;
  colorsUsed: number;
  durationMs: number;
}

/** 抽帧进度(0~1)与阶段文案 */
interface ExtractProgress {
  phase: 'seek' | 'encode' | null;
  done: number;
  total: number;
}

const FPS_OPTIONS = [5, 10, 15, 24] as const;
const WIDTH_OPTIONS = [320, 480, 640, 854] as const;
/** 输出宽度超上限时的绝对上限(Rust MAX_DIM=1920,前端更保守) */
const WIDTH_MAX = 1920;

/** seek 到精确时间并等一帧渲染(video.currentTime 赋值后需事件确认) */
function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

export function VideoToGif(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  /** 已载入视频(元信息 + 播放元素引用) */
  const [videoMeta, setVideoMeta] = useState<{
    name: string;
    size: number;
    duration: number;
  } | null>(null);
  const [startSec, setStartSec] = useState('0');
  const [endSec, setEndSec] = useState('3');
  const [fps, setFps] = useState<number>(10);
  const [width, setWidth] = useState<number>(480);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExtractProgress>({ phase: null, done: 0, total: 0 });
  const [result, setResult] = useState<GifEncodeResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('video/')) {
        toast.error(t('tools.video_to_gif.only_video_files'));
        return;
      }
      // 元信息经隐藏 <video> 探测(duration 挂载后可读)
      const dataUrl = await readFileAsDataUrl(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = dataUrl;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error(t('tools.video_to_gif.error_decode')));
      });
      videoRef.current = video;
      setVideoMeta({ name: file.name, size: file.size, duration: video.duration });
      // 默认片段:0 ~ min(3s, duration)
      setStartSec('0');
      setEndSec(String(Math.min(3, Math.floor(video.duration) || 3)));
      setResult(null);
    },
    [t],
  );

  /** 抽帧 + 编码主流程 */
  const convert = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !videoMeta || busy) return;
    const start = Math.max(0, Number(startSec) || 0);
    const end = Math.min(videoMeta.duration, Number(endSec) || videoMeta.duration);
    if (end <= start) {
      toast.error(t('tools.video_to_gif.invalid_range'));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      // 输出尺寸:宽选项 × 原始纵横比;超高视频夹到 WIDTH_MAX
      const outW = Math.min(width, WIDTH_MAX);
      const scale = outW / video.videoWidth;
      const outH = Math.max(1, Math.round(video.videoHeight * scale));

      const frames: Array<{ data: number[] }> = [];
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error(t('tools.video_to_gif.error_canvas'));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const total = Math.max(1, Math.floor((end - start) * fps));
      const step = 1 / fps;
      setProgress({ phase: 'seek', done: 0, total });
      for (let i = 0; i < total; i++) {
        const time = start + i * step;
        if (time > end) break;
        await seekVideo(video, time);
        ctx.drawImage(video, 0, 0, outW, outH);
        const rgba = ctx.getImageData(0, 0, outW, outH).data;
        // RGBA 帧直接序列化(serde 端 Vec<u8>,无需 base64)
        frames.push({ data: Array.from(rgba) });
        setProgress({ phase: 'seek', done: i + 1, total });
      }

      setProgress({ phase: 'encode', done: total, total });
      const res = await invokeCommand<GifEncodeResult>('gif_encode', {
        input: {
          width: outW,
          height: outH,
          frames,
          params: { frameDelayMs: Math.round(1000 / fps) },
        },
      });
      setResult(res);
      toast.success(
        t('tools.video_to_gif.done', {
          frames: res.frames,
          size: formatBytes(res.outputBytes),
        }),
      );
    } catch (e) {
      toast.error(
        t('tools.video_to_gif.failed', { message: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setBusy(false);
      setProgress({ phase: null, done: 0, total: 0 });
    }
  }, [busy, endSec, fps, startSec, t, videoMeta, width]);

  /** 产物下载 */
  const download = useCallback(() => {
    if (!result || !videoMeta) return;
    const bytes = base64ToBytes(result.base64);
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/gif' });
    downloadBlob(`${videoMeta.name.replace(/\.[^.]+$/, '') || 'video'}.gif`, blob);
  }, [result, videoMeta]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  const busyOrLoaded = busy || progress.phase !== null;

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="video-to-gif"
    >
      <ConfigSection
        headerHint={t('tools.video_to_gif.section_hint')}
        searchAnchor="video_to_gif:config"
      >
        <ConfigRow icon={Clapperboard} caption={t('tools.video_to_gif.label_range')}>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              step="0.1"
              className="h-7 w-20 text-xs"
              data-testid="vtg-start"
              aria-label={t('tools.video_to_gif.label_start')}
              value={startSec}
              disabled={!videoMeta}
              onChange={(e) => setStartSec(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="number"
              min={0}
              step="0.1"
              className="h-7 w-20 text-xs"
              data-testid="vtg-end"
              aria-label={t('tools.video_to_gif.label_end')}
              value={endSec}
              disabled={!videoMeta}
              onChange={(e) => setEndSec(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              {videoMeta ? `/${Math.floor(videoMeta.duration)}s` : ''}
            </span>
          </div>
        </ConfigRow>
        <ConfigRow icon={Clapperboard} caption={t('tools.video_to_gif.label_fps')}>
          <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))}>
            <SelectTrigger data-testid="vtg-fps" className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FPS_OPTIONS.map((f) => (
                <SelectItem key={f} value={String(f)}>
                  {f} fps
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={Clapperboard} caption={t('tools.video_to_gif.caption_width')}>
          <Select value={String(width)} onValueChange={(v) => setWidth(Number(v))}>
            <SelectTrigger data-testid="vtg-width" className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WIDTH_OPTIONS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w}px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <div
          className="flex items-center justify-between"
          data-search-anchor="video_to_gif:workbench"
        >
          <h2 className="text-body-sm font-semibold">{t('tools.video_to_gif.section_video')}</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid="vtg-open"
              onClick={() => fileRef.current?.click()}
            >
              <FolderOpen aria-hidden className="size-3.5" /> {t('tools.video_to_gif.choose_video')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="vtg-clear"
              disabled={!videoMeta}
              onClick={() => {
                setVideoMeta(null);
                videoRef.current = null;
                setResult(null);
              }}
            >
              <X aria-hidden className="size-3.5" /> {t('tools.video_to_gif.clear')}
            </Button>
            <Button
              size="sm"
              data-testid="vtg-convert"
              disabled={!videoMeta || busyOrLoaded}
              onClick={() => void convert()}
            >
              <Play aria-hidden className="size-3.5" />
              {busy || progress.phase === 'seek'
                ? t('tools.video_to_gif.running')
                : t('tools.video_to_gif.convert')}
            </Button>
            {result && (
              <Button variant="outline" size="sm" data-testid="vtg-download" onClick={download}>
                <Download aria-hidden className="size-3.5" /> {t('tools.video_to_gif.download')}
              </Button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          data-testid="vtg-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = '';
          }}
        />
        <ScrollArea
          data-testid="vtg-dropzone"
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
            {result ? (
              <>
                <img
                  src={`data:image/gif;base64,${result.base64}`}
                  alt={t('tools.video_to_gif.result_alt')}
                  data-testid="vtg-result"
                  className="max-h-[70%] max-w-full object-contain"
                />
                <p className="text-xs text-muted-foreground" data-testid="vtg-result-info">
                  {t('tools.video_to_gif.result_info', {
                    frames: result.frames,
                    colors: result.colorsUsed,
                    size: formatBytes(result.outputBytes),
                    ms: result.durationMs,
                  })}
                </p>
              </>
            ) : videoMeta ? (
              <>
                <Clapperboard aria-hidden className="size-8 text-muted-foreground" />
                <p className="text-xs" data-testid="vtg-info">
                  {videoMeta.name} · {Math.floor(videoMeta.duration)}s ·{' '}
                  {formatBytes(videoMeta.size)}
                </p>
                {progress.phase === 'seek' && (
                  <p className="text-xs text-muted-foreground" data-testid="vtg-progress">
                    {t('tools.video_to_gif.progress_frames', {
                      done: progress.done,
                      total: progress.total,
                    })}
                  </p>
                )}
                {progress.phase === 'encode' && (
                  <p className="text-xs text-muted-foreground">
                    {t('tools.video_to_gif.progress_encode')}
                  </p>
                )}
                {busy && progress.phase === null && (
                  <p className="text-xs text-muted-foreground">{t('tools.video_to_gif.running')}</p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Clapperboard aria-hidden className="size-8" />
                <p className="text-xs">{t('tools.video_to_gif.dropzone_hint')}</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

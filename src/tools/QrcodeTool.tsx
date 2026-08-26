/**
 * 二维码编解码工具
 *
 * - 生成:文本 → 二维码(qrcode 库,canvas data URL 预览,可导出 PNG / SVG)
 * - 读取:图片文件 → 文本(jsQR)
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Download, FolderOpen, QrCode as QrIcon, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeEditor } from '@/components/ui/code-editor';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CopyAction } from '@/components/copy-action';
import { downloadBlob, downloadText, readFileAsDataUrl } from '@/lib/file-utils';
import { t } from '@/i18n';
import type { ToolProps } from './registry';

async function decodeQrFromDataUrl(dataUrl: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(t('tools.qrcode_tool.error_image_load')));
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('tools.qrcode_tool.error_canvas'));
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height);
  if (!code) throw new Error(t('tools.qrcode_tool.error_not_found'));
  return code.data;
}

export function QrcodeTool(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  // —— 生成 ——
  const [text, setText] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  // —— 读取 ——
  const [decoded, setDecoded] = useState('');
  const [scanPreview, setScanPreview] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 防抖 + 请求序号,避免每次按键都同步生成二维码(输入快时仅取最后一次结果)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const mySeq = ++seqRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // 空文本直接生成空串(走 catch 分支返回空),所有 setState 放在异步回调内,
      // 避免在 effect 同步体内 setState 触发的级联渲染 lint 错误。
      const target = text.trim() ? text : '';
      void QRCode.toDataURL(target, { width: 280, margin: 2 }).then(
        (url) => {
          if (seqRef.current === mySeq) setQrDataUrl(url);
        },
        () => {
          if (seqRef.current === mySeq) setQrDataUrl('');
        },
      );
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text]);

  const exportPng = useCallback(async () => {
    if (!text.trim()) return;
    const url = await QRCode.toDataURL(text, { width: 1024, margin: 2 });
    const bytes = atob(url.split(',')[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    downloadBlob('qrcode.png', new Blob([arr.buffer as ArrayBuffer], { type: 'image/png' }));
  }, [text]);

  const exportSvg = useCallback(async () => {
    if (!text.trim()) return;
    const svg = await QRCode.toString(text, { type: 'svg', margin: 2 });
    downloadText('qrcode.svg', svg, 'image/svg+xml');
  }, [text]);

  const scanFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error(t('tools.qrcode_tool.only_image_files'));
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setScanPreview(dataUrl);
        const result = await decodeQrFromDataUrl(dataUrl);
        setDecoded(result);
        toast.success(t('tools.qrcode_tool.scan_success'));
      } catch (e) {
        setDecoded('');
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [t],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void scanFile(file);
    },
    [scanFile],
  );

  return (
    <Tabs defaultValue="generate" className="flex h-full flex-col" data-testid="qrcode-tool">
      <TabsList data-search-anchor="qrcode_tool:tabs">
        <TabsTrigger value="generate" data-testid="qr-tab-generate">
          <QrIcon aria-hidden className="size-3.5" /> {t('tools.qrcode_tool.tab_generate')}
        </TabsTrigger>
        <TabsTrigger value="scan" data-testid="qr-tab-scan">
          <ScanLine aria-hidden className="size-3.5" /> {t('tools.qrcode_tool.tab_scan')}
        </TabsTrigger>
      </TabsList>

      {/* 生成 */}
      <TabsContent value="generate" className="mt-3 flex min-h-0 flex-1 gap-3">
        <CodeEditor
          title={t('tools.qrcode_tool.input_title')}
          language="plaintext"
          value={text}
          onChange={setText}
          placeholder={t('tools.qrcode_tool.input_placeholder')}
          data-testid="qr-text"
          className="min-h-0 flex-1"
          searchAnchor="qrcode_tool:input"
        />
        {/* 预览板宽度取 min(320px, 38%):宽窗口维持 320px 舒适尺寸,
            窄窗口(800px 最小宽 + 侧栏展开)按比例收缩,避免左侧编辑器被挤到不可用;
            min-w 保证二维码预览的可用下限,极端情况下允许横向滚动 */}
        <div
          className="flex w-[min(20rem,38%)] min-w-44 flex-col gap-2"
          data-search-anchor="qrcode_tool:image"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-body-sm font-semibold">{t('tools.qrcode_tool.preview_title')}</h2>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                data-testid="qr-export-png"
                disabled={!qrDataUrl}
                onClick={() => void exportPng()}
              >
                <Download aria-hidden className="size-3.5" /> PNG
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="qr-export-svg"
                disabled={!qrDataUrl}
                onClick={() => void exportSvg()}
              >
                <Download aria-hidden className="size-3.5" /> SVG
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-card p-4 shadow-card">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={t('tools.qrcode_tool.preview_alt')}
                data-testid="qr-preview"
                className="max-h-full max-w-full rounded bg-white p-1"
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t('tools.qrcode_tool.preview_empty')}</p>
            )}
          </div>
        </div>
      </TabsContent>

      {/* 读取 */}
      <TabsContent value="scan" className="mt-3 flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-body-sm font-semibold">{t('tools.qrcode_tool.scan_title')}</h2>
            <Button
              variant="ghost"
              size="sm"
              data-testid="qr-open"
              onClick={() => fileRef.current?.click()}
            >
              <FolderOpen aria-hidden className="size-3.5" /> {t('tools.qrcode_tool.choose_image')}
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="qr-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void scanFile(file);
              e.target.value = '';
            }}
          />
          <ScrollArea
            data-testid="qr-dropzone"
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
            <div className="flex h-full min-h-full items-center justify-center p-4">
              {scanPreview ? (
                <img
                  src={scanPreview}
                  alt={t('tools.qrcode_tool.scan_preview_alt')}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <p className="text-xs text-muted-foreground">{t('tools.qrcode_tool.dropzone_hint')}</p>
              )}
            </div>
          </ScrollArea>
        </div>
        <CodeEditor
          title={t('tools.qrcode_tool.result_title')}
          language="plaintext"
          value={decoded}
          readOnly
          data-testid="qr-decoded"
          className="min-h-0 flex-1"
          searchAnchor="qrcode_tool:output"
          actions={<CopyAction text={decoded} testId="qr-copy" />}
        />
      </TabsContent>
    </Tabs>
  );
}

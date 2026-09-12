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
import { ArrowLeftRight, Download, FolderOpen, QrCode as QrIcon, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CopyAction } from '@/components/copy-action';
import { SendToMenu } from '@/components/send-to-menu';
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

export function QrcodeTool({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  // —— 生成 ——
  const [text, setText] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  // 生成失败原因(超 QR 容量上限 ~2953 字节等):非空时预览区显示失败占位,
  // 与「尚未输入」的空态提示区分,不再静默吞掉 reject
  const [generateError, setGenerateError] = useState<string | null>(null);
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
      // 空文本不是错误:直接回到「未输入」空态,不发 toDataURL
      // (qrcode 库对空串 reject "No input text",那是空态不是失败)。
      // 所有 setState 放在异步回调内,避免 effect 同步体内 setState 的 lint 错误。
      if (!text.trim()) {
        if (seqRef.current === mySeq) {
          setQrDataUrl('');
          setGenerateError(null);
        }
        return;
      }
      void QRCode.toDataURL(text, { width: 280, margin: 2 }).then(
        (url) => {
          if (seqRef.current !== mySeq) return;
          setQrDataUrl(url);
          setGenerateError(null);
        },
        (e: unknown) => {
          if (seqRef.current !== mySeq) return;
          setQrDataUrl('');
          // reject 原因是 Error(qrcode 库容量溢出)或 string(toDataURL 底层):
          // 提炼为可读文案展示在预览区,与「未输入」空态区分
          const message = e instanceof Error ? e.message : String(e ?? '');
          setGenerateError(
            message
              ? `${t('tools.qrcode_tool.generate_failed')}: ${message}`
              : t('tools.qrcode_tool.generate_failed'),
          );
        },
      );
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, t]);

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
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与工作区收进同一卡片
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <Tabs
        defaultValue="generate"
        className="flex h-full min-h-0 flex-col"
        data-testid="qrcode-tool"
      >
        {/* 模式切换:与 Base64 转换器同款「配置行 + 分段切换」,替换原通栏文档式 Tab 条 */}
        <ConfigSection title="" searchAnchor="qrcode_tool:tabs">
          <ConfigRow
            icon={ArrowLeftRight}
            label={t('tools.qrcode_tool.label_mode')}
            hint={t('tools.qrcode_tool.mode_hint')}
          >
            <TabsList>
              <TabsTrigger value="generate" data-testid="qr-tab-generate">
                <QrIcon aria-hidden className="size-3.5" /> {t('tools.qrcode_tool.tab_generate')}
              </TabsTrigger>
              <TabsTrigger value="scan" data-testid="qr-tab-scan">
                <ScanLine aria-hidden className="size-3.5" /> {t('tools.qrcode_tool.tab_scan')}
              </TabsTrigger>
            </TabsList>
          </ConfigRow>
        </ConfigSection>

        {/* 生成:参考文本比较器(TextDiffView)的双编辑框布局 —— 并排可拖动宽度,
            左右标题栏同高(26px),二维码预览面板把「下载 PNG/SVG」收进标题栏动作区 */}
        <TabsContent value="generate" className="mt-0 flex min-h-0 flex-1 p-0">
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel defaultSize="50" minSize="25" className="min-h-0 min-w-0">
              <CodeEditor
                title={t('tools.qrcode_tool.input_title')}
                language="plaintext"
                value={text}
                onChange={setText}
                placeholder={t('tools.qrcode_tool.input_placeholder')}
                data-testid="qr-text"
                className="h-full rounded-none border-0 border-r"
                searchAnchor="qrcode_tool:input"
              />
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize="50" minSize="25" className="min-h-0 min-w-0">
              {/* 预览面板:与左侧编辑器同高同构的「编辑框」,边框对称(只留左侧朝向分隔缝) */}
              <div
                className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-l"
                data-search-anchor="qrcode_tool:image"
              >
                {/* 标题栏:与 CodeEditor 标题栏同高(26px)、同排版,PNG/SVG 下载放动作区 */}
                <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2">
                  <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                    {t('tools.qrcode_tool.preview_title')}
                  </span>
                  <span className="flex h-[26px] shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      data-testid="qr-export-png"
                      title={t('tools.qrcode_tool.export_png')}
                      aria-label={t('tools.qrcode_tool.export_png')}
                      disabled={!qrDataUrl}
                      onClick={() => void exportPng()}
                      className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Download aria-hidden className="size-3.5" /> PNG
                    </button>
                    <button
                      type="button"
                      data-testid="qr-export-svg"
                      title={t('tools.qrcode_tool.export_svg')}
                      aria-label={t('tools.qrcode_tool.export_svg')}
                      disabled={!qrDataUrl}
                      onClick={() => void exportSvg()}
                      className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Download aria-hidden className="size-3.5" /> SVG
                    </button>
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-b-md p-4">
                  {generateError ? (
                    <div
                      role="alert"
                      data-testid="qr-generate-error"
                      className="max-w-sm rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
                    >
                      {generateError}
                    </div>
                  ) : qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt={t('tools.qrcode_tool.preview_alt')}
                      data-testid="qr-preview"
                      className="max-h-full max-w-full rounded bg-white p-1"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('tools.qrcode_tool.preview_empty')}
                    </p>
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </TabsContent>

        {/* 读取:与「生成」页签同构 —— 可拖动双栏 + 标题栏同高(26px)的编辑框,
            左侧图片预览「编辑框」标题栏动作区放「选择图片」 */}
        <TabsContent value="scan" className="mt-0 flex min-h-0 flex-1 p-0">
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel defaultSize="50" minSize="25" className="min-h-0 min-w-0">
              {/* 图片预览「编辑框」:与右侧识别结果编辑器同高同构,边框对称(只留右缘朝向分隔缝) */}
              <div
                className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-r"
                data-search-anchor="qrcode_tool:image"
              >
                <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2">
                  <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                    {t('tools.qrcode_tool.scan_title')}
                  </span>
                  <span className="flex h-[26px] shrink-0 items-center">
                    <button
                      type="button"
                      data-testid="qr-open"
                      title={t('tools.qrcode_tool.choose_image')}
                      aria-label={t('tools.qrcode_tool.choose_image')}
                      onClick={() => fileRef.current?.click()}
                      className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FolderOpen aria-hidden className="size-3.5" />{' '}
                      {t('tools.qrcode_tool.choose_image')}
                    </button>
                  </span>
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
                  className={`min-h-0 flex-1 rounded-none border-0 ${
                    dragOver ? 'bg-primary/5' : ''
                  } transition-colors`}
                >
                  <div className="flex h-full min-h-full items-center justify-center p-4">
                    {scanPreview ? (
                      <img
                        src={scanPreview}
                        alt={t('tools.qrcode_tool.scan_preview_alt')}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t('tools.qrcode_tool.dropzone_hint')}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize="50" minSize="25" className="min-h-0 min-w-0">
              <CodeEditor
                title={t('tools.qrcode_tool.result_title')}
                language="plaintext"
                value={decoded}
                readOnly
                data-testid="qr-decoded"
                className="h-full rounded-none border-0 border-l"
                searchAnchor="qrcode_tool:output"
                actions={
                  <>
                    <CopyAction text={decoded} testId="qr-copy" />
                    {decoded && (
                      <SendToMenu text={decoded} currentToolId={toolId} testId="qr-send" />
                    )}
                  </>
                }
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </TabsContent>
      </Tabs>
    </div>
  );
}

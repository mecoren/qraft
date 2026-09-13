/**
 * 图片元数据查看器 —— 拖入/选择图片,左侧预览、右侧结构化解析结果
 *
 * 纯前端本地解析(零 IPC / 零网络):PNG chunk 表、JPEG EXIF 相机字段、
 * WebP/GIF/BMP 容器头全部由 image-metadata-utils 字节直读。
 * 布局照 CertificateDecoder 的左右分栏契约:左为非编辑器「预览框」
 * (26px 标题栏 + 满高滚动区),右为结果面板(文件/结构/EXIF/文本/chunk 分节)。
 */
import { useCallback, useRef, useState, type DragEvent, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileImage, FolderOpen, X } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import { formatBytes, readFileAsDataUrl, base64ToBytes } from '@/lib/file-utils';
import { parseImageMetadata, reportToText, type ImageMetadataReport } from './image-metadata-utils';
import type { ToolProps } from './registry';

/** 已加载文件状态:dataUrl 供预览,bytes 供解析 */
interface LoadedFile {
  name: string;
  size: number;
  dataUrl: string;
  bytes: Uint8Array;
  report: ImageMetadataReport;
}

/** 带值的键值行:与 CertificateDecoder 的 Field 同构(标签固定宽、值可换行) */
function FieldValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start gap-4 py-1" data-testid={`im-field-${label}`}>
      <span className="w-40 shrink-0 text-xs text-muted-foreground select-none">{label}</span>
      <span className="min-w-0 flex-1 break-words text-body-sm" data-field-value={label}>
        {value}
      </span>
    </div>
  );
}

/** 分节标题 */
function SectionTitle({ children }: { children: string }): JSX.Element {
  return <h3 className="mb-1 mt-4 text-body-sm font-semibold first:mt-0">{children}</h3>;
}

export function ImageMetadata(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(async (f: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(f);
      const bytes = base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
      const report = parseImageMetadata(bytes);
      setFile({ name: f.name, size: f.size, dataUrl, bytes, report });
    } catch (e) {
      setFile({
        name: f.name,
        size: f.size,
        dataUrl: '',
        bytes: new Uint8Array(),
        report: {
          ...parseImageMetadata(new Uint8Array()),
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) void loadFile(dropped);
    },
    [loadFile],
  );

  const r = file?.report ?? null;

  /** 复制用纯文本(标签全部走 i18n) */
  const copyText = r
    ? reportToText(
        { ...r, fileName: file?.name, fileSize: file?.size },
        {
          file: t('tools.image_metadata.section_file'),
          exif: t('tools.image_metadata.section_exif'),
          text: t('tools.image_metadata.section_text'),
          chunks: t('tools.image_metadata.section_chunks'),
          fields: {
            fileName: t('tools.image_metadata.label_file_name'),
            fileSize: t('tools.image_metadata.label_file_size'),
            format: t('tools.image_metadata.label_format'),
            dimensions: t('tools.image_metadata.label_dimensions'),
            bitDepth: t('tools.image_metadata.label_bit_depth'),
            color: t('tools.image_metadata.label_color'),
            dpi: t('tools.image_metadata.label_dpi'),
            interlaced: t('tools.image_metadata.label_interlaced'),
            transparency: t('tools.image_metadata.label_transparency'),
            frames: t('tools.image_metadata.label_frames'),
            background: t('tools.image_metadata.label_background'),
            error: t('tools.image_metadata.label_error'),
          },
        },
        (k, v) => `${k}: ${v}`,
      )
    : '';

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="image-metadata"
    >
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* 左:图片预览框(可拖放;与 CodeEditor 同构的编辑框结构) */}
        <ResizablePanel defaultSize="45" minSize="20" className="min-h-0 min-w-0">
          <div
            className="flex h-full flex-col border-r"
            data-search-anchor="image_metadata:preview"
          >
            <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2">
              <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                {t('tools.image_metadata.title_preview')}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  data-testid="im-open"
                  onClick={() => fileRef.current?.click()}
                >
                  <FolderOpen aria-hidden className="size-3.5" />
                  {t('tools.image_metadata.open_file')}
                </button>
                {file && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    data-testid="im-clear"
                    onClick={() => setFile(null)}
                  >
                    <X aria-hidden className="size-3.5" />
                    {t('tools.image_metadata.clear')}
                  </button>
                )}
              </span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp"
              className="hidden"
              data-testid="im-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = '';
              }}
            />
            <div
              className={`min-h-0 flex-1 overflow-auto ${
                dragOver ? 'bg-primary/5' : ''
              } transition-colors`}
              data-testid="im-dropzone"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              {file && file.dataUrl ? (
                <div className="flex h-full min-h-full items-center justify-center p-4">
                  <img
                    src={file.dataUrl}
                    alt={file.name}
                    data-testid="im-preview"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
                  <FileImage aria-hidden className="size-8" />
                  <p className="text-xs">{t('tools.image_metadata.dropzone_hint')}</p>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        {/* 右:解析结果 */}
        <ResizablePanel defaultSize="55" minSize="20" className="min-h-0 min-w-0">
          <div className="flex h-full flex-col border-l">
            <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2">
              <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                {t('tools.image_metadata.title_output')}
              </span>
              {copyText ? <CopyAction text={copyText} testId="im-copy" /> : null}
            </div>
            <div
              className="min-h-0 flex-1 overflow-auto"
              data-testid="im-output"
              data-search-anchor="image_metadata:output"
            >
              {r?.error ? (
                <div
                  role="alert"
                  className="m-3 rounded-md border border-destructive bg-destructive/10 p-3 text-sm whitespace-pre-wrap text-destructive"
                  data-testid="im-error"
                >
                  {r.error}
                </div>
              ) : r && file ? (
                <div className="flex flex-col gap-4 p-4">
                  <section data-testid="im-section-file">
                    <SectionTitle>{t('tools.image_metadata.section_file')}</SectionTitle>
                    <FieldValue
                      label={t('tools.image_metadata.label_file_name')}
                      value={file.name}
                    />
                    <FieldValue
                      label={t('tools.image_metadata.label_file_size')}
                      value={formatBytes(file.size)}
                    />
                    <FieldValue
                      label={t('tools.image_metadata.label_format')}
                      value={r.formatLabel}
                    />
                  </section>

                  <section data-testid="im-section-structure">
                    <SectionTitle>{t('tools.image_metadata.section_structure')}</SectionTitle>
                    {r.width !== null && r.height !== null && (
                      <FieldValue
                        label={t('tools.image_metadata.label_dimensions')}
                        value={`${r.width} × ${r.height}`}
                      />
                    )}
                    {r.bitDepth !== null && (
                      <FieldValue
                        label={t('tools.image_metadata.label_bit_depth')}
                        value={String(r.bitDepth)}
                      />
                    )}
                    {r.colorInfo && (
                      <FieldValue
                        label={t('tools.image_metadata.label_color')}
                        value={r.colorInfo}
                      />
                    )}
                    {r.dpi !== null && (
                      <FieldValue
                        label={t('tools.image_metadata.label_dpi')}
                        value={String(r.dpi)}
                      />
                    )}
                    {r.interlaced !== null && (
                      <FieldValue
                        label={t('tools.image_metadata.label_interlaced')}
                        value={
                          r.interlaced
                            ? t('tools.image_metadata.value_yes')
                            : t('tools.image_metadata.value_no')
                        }
                      />
                    )}
                    {r.transparency !== null && (
                      <FieldValue
                        label={t('tools.image_metadata.label_transparency')}
                        value={
                          r.transparency
                            ? t('tools.image_metadata.value_yes')
                            : t('tools.image_metadata.value_no')
                        }
                      />
                    )}
                    {r.frameCount !== null && (
                      <FieldValue
                        label={t('tools.image_metadata.label_frames')}
                        value={
                          r.animate
                            ? `${r.frameCount} (${t('tools.image_metadata.value_animated')})`
                            : String(r.frameCount)
                        }
                      />
                    )}
                    {r.backgroundColor && (
                      <FieldValue
                        label={t('tools.image_metadata.label_background')}
                        value={r.backgroundColor}
                      />
                    )}
                  </section>

                  {r.exif.length > 0 && (
                    <section data-testid="im-section-exif">
                      <SectionTitle>{t('tools.image_metadata.section_exif')}</SectionTitle>
                      {r.exif.map((e) => (
                        <FieldValue key={e.tag} label={e.name} value={e.value} />
                      ))}
                    </section>
                  )}

                  {r.textEntries.length > 0 && (
                    <section data-testid="im-section-text">
                      <SectionTitle>{t('tools.image_metadata.section_text')}</SectionTitle>
                      {r.textEntries.map((e) => (
                        <FieldValue
                          key={`${e.keyword}-${e.text}`}
                          label={e.keyword}
                          value={e.compressed ? `${e.text} (zlib)` : e.text}
                        />
                      ))}
                    </section>
                  )}

                  {r.pngChunks.length > 0 && (
                    <section data-testid="im-section-chunks">
                      <SectionTitle>{t('tools.image_metadata.section_chunks')}</SectionTitle>
                      <table className="w-full max-w-md text-body-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-1 pr-4 font-medium">
                              {t('tools.image_metadata.chunk_type')}
                            </th>
                            <th className="py-1 pr-4 font-medium">
                              {t('tools.image_metadata.chunk_size')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.pngChunks.map((c) => (
                            <tr key={`${c.type}-${c.bytes}`} className="border-b border-border/50">
                              <td className="py-1 pr-4 font-mono text-xs">{c.type}</td>
                              <td className="py-1 pr-4 tabular-nums">{formatBytes(c.bytes)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <AlertCircle aria-hidden className="size-4" />
                    {t('tools.image_metadata.empty_hint')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

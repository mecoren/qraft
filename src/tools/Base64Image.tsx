/**
 * Base64 图片编码 / 解码
 *
 * - 编码:选择/拖放图片文件 → data URL(base64)
 * - 解码:粘贴 base64 / data URL → 图片预览 + 保存
 * 预览一律使用 data URL(生产 CSP 仅允许 img-src 'self' data:)。
 */

import { useCallback, useRef, useState, type DragEvent, type JSX } from 'react';
import { FolderOpen, ImageIcon, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { CopyAction } from '@/components/copy-action';
import {
  base64ToBytes,
  downloadBlob,
  readFileAsDataUrl,
  stripDataUrlPrefix,
} from '@/lib/file-utils';
import type { ToolProps } from './registry';

const ACCEPTED = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';

/** 根据 base64 前几个字节嗅探图片 MIME(解码方向无 data URL 前缀时用) */
export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  return 'image/png';
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

export function Base64Image(_props: ToolProps): JSX.Element {
  const [base64Text, setBase64Text] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 由 base64 文本推导预览 data URL(解码方向)
  const preview = ((): { url: string; mime: string } | { error: string } | null => {
    const trimmed = base64Text.trim();
    if (!trimmed) return null;
    try {
      const { base64, mime } = stripDataUrlPrefix(trimmed);
      const bytes = base64ToBytes(base64);
      if (bytes.length === 0) return { error: '输入为空数据' };
      const finalMime = mime ?? sniffImageMime(bytes);
      return { url: `data:${finalMime};base64,${base64.replace(/\s+/g, '')}`, mime: finalMime };
    } catch {
      return { error: '不是有效的 Base64 数据' };
    }
  })();

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('仅支持图片文件');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setBase64Text(dataUrl);
      toast.success(`已编码 ${file.name}`);
    } catch (e) {
      toast.error(`读取失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  const saveImage = useCallback(() => {
    if (!preview || 'error' in preview) return;
    try {
      const { base64 } = stripDataUrlPrefix(base64Text.trim());
      const bytes = base64ToBytes(base64);
      const ext = MIME_EXT[preview.mime] ?? 'png';
      downloadBlob(
        `image.${ext}`,
        new Blob([bytes.buffer as ArrayBuffer], { type: preview.mime }),
      );
    } catch {
      toast.error('保存失败');
    }
  }, [preview, base64Text]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="base64-image">
      {/* Base64 文本区 */}
      <CodeEditor
        title="Base64 文本"
        language="plaintext"
        value={base64Text}
        onChange={setBase64Text}
        placeholder="粘贴 Base64 / data URL,或在下方选择图片文件进行编码"
        data-testid="b64img-text"
        className="min-h-0 flex-1"
        actions={<CopyAction text={base64Text} testId="b64img-copy" />}
      />

      {/* 图片区 */}
      <section aria-label="图片" className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-body-sm font-semibold">图片</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid="b64img-open"
              onClick={() => fileRef.current?.click()}
            >
              <FolderOpen aria-hidden className="size-3.5" /> 选择图片
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="b64img-save"
              disabled={!preview || 'error' in preview}
              onClick={saveImage}
            >
              <Save aria-hidden className="size-3.5" /> 另存为
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="b64img-clear"
              disabled={!base64Text}
              onClick={() => setBase64Text('')}
            >
              <X aria-hidden className="size-3.5" /> 清除
            </Button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          data-testid="b64img-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = '';
          }}
        />
        <div
          data-testid="b64img-dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border bg-card'
          } p-4 shadow-card transition-colors`}
        >
          {preview === null ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <ImageIcon aria-hidden className="size-8" />
              <p className="text-xs">拖放图片到此处,或点击「选择图片」</p>
            </div>
          ) : 'error' in preview ? (
            <p data-testid="b64img-error" className="text-xs text-destructive">
              {preview.error}
            </p>
          ) : (
            <img
              src={preview.url}
              alt="Base64 解码预览"
              data-testid="b64img-preview"
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>
      </section>
    </div>
  );
}

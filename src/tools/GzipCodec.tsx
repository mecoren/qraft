/**
 * GZip 压缩 / 解压缩
 *
 * 双输入通道:
 * - 文本模式:输入文本 → gzip → base64;反向 base64 → gunzip → 文本
 * - 文件模式:拖入任意文件 → 下载 .gz;拖入 .gz → 下载解压结果
 *
 * 基于原生 CompressionStream / DecompressionStream,无第三方依赖。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, FileUp, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { downloadBlob, formatBytes, readFileAsText } from '@/lib/file-utils';
import {
  base64ToBytesLoose,
  bytesToBase64,
  gunzipToText,
  gzipText,
  isGzipBase64,
} from './gzip-utils';
import type { ToolProps } from './registry';

export function GzipCodec({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [compressMode, setCompressMode] = useState(true);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ratio, setRatio] = useState<{ before: number; after: number } | null>(null);
  /** 文件模式产物:压缩/解压后的字节,可直接下载 */
  const [fileResult, setFileResult] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useToolShortcutActions(toolId, {
    clearInput: () => {
      setInput('');
      setFileResult(null);
    },
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  useEffect(() => {
    let cancelled = false;
    // 所有 setState 都走异步路径,避免在 effect 中同步 setState 触发级联渲染
    (async () => {
      if (!input) {
        if (cancelled) return;
        setError(null);
        setOutput('');
        setRatio(null);
        return;
      }
      try {
        if (compressMode) {
          const gz = await gzipText(input);
          if (cancelled) return;
          setError(null);
          setOutput(bytesToBase64(gz));
          setRatio({ before: new TextEncoder().encode(input).length, after: gz.length });
        } else {
          // 解压:输入若是完整 data URL 先剥前缀
          const raw =
            input.includes(',') && isGzipBase64(input.slice(input.indexOf(',') + 1))
              ? input.slice(input.indexOf(',') + 1)
              : input;
          const text = await gunzipToText(base64ToBytesLoose(raw));
          if (cancelled) return;
          setError(null);
          setOutput(text);
          setRatio(null);
        }
      } catch (e) {
        if (cancelled) return;
        setOutput('');
        setRatio(null);
        setError(
          compressMode
            ? t('tools.gzip_codec.error_compress', {
                message: e instanceof Error ? e.message : String(e),
              })
            : t('tools.gzip_codec.error_decompress_invalid'),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input, compressMode, t]);

  const ratioText = useMemo(() => {
    if (!ratio || ratio.before === 0) return null;
    const pct = ((1 - ratio.after / ratio.before) * 100).toFixed(1);
    return t('tools.gzip_codec.ratio_text', {
      before: formatBytes(ratio.before),
      after: formatBytes(ratio.after),
      pct,
    });
  }, [ratio, t]);

  /** 文件模式:压缩 → <name>.gz;解压 → 去掉 .gz 后缀 */
  const processFile = useCallback(
    async (file: File) => {
      try {
        if (compressMode) {
          const gz = await gzipText(await readFileAsText(file));
          const name = `${file.name}.gz`;
          setFileResult({ name, bytes: gz });
          toast.success(
            t('tools.gzip_codec.file_done', {
              name,
              before: formatBytes(file.size),
              after: formatBytes(gz.length),
            }),
          );
        } else {
          const buf = new Uint8Array(await file.arrayBuffer());
          if (!buf.length) {
            toast.error(t('tools.gzip_codec.error_empty_file'));
            return;
          }
          const out = await gunzipToText(buf);
          const name = file.name.replace(/\.gz$/i, '') || `${file.name}.out`;
          setFileResult({ name, bytes: new TextEncoder().encode(out) });
          toast.success(
            t('tools.gzip_codec.file_done', {
              name,
              before: formatBytes(file.size),
              after: formatBytes(out.length),
            }),
          );
        }
      } catch (e) {
        toast.error(
          t('tools.gzip_codec.error_file_process', {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
    [compressMode, t],
  );

  const downloadFileResult = useCallback(() => {
    if (!fileResult) return;
    const mime = compressMode ? 'application/gzip' : 'application/octet-stream';
    downloadBlob(
      fileResult.name,
      new Blob([fileResult.bytes.slice().buffer as ArrayBuffer], { type: mime }),
    );
  }, [fileResult, compressMode]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 纵向双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="gzip-codec"
    >
      <ConfigSection title="" searchAnchor="gzip_codec:config">
        <ConfigRow
          icon={ArrowLeftRight}
          label={t('tools.gzip_codec.label_convert')}
          hint={t('tools.gzip_codec.hint_mode')}
        >
          <span className="text-xs text-muted-foreground">
            {compressMode
              ? t('tools.gzip_codec.mode_compress')
              : t('tools.gzip_codec.mode_decompress')}
          </span>
          <Switch
            data-testid="gzip-mode-switch"
            aria-label={t('tools.gzip_codec.aria_mode_toggle')}
            checked={compressMode}
            onCheckedChange={setCompressMode}
          />
        </ConfigRow>
        {ratioText ? (
          <ConfigRow icon={Gauge} label={t('tools.gzip_codec.label_ratio')}>
            <span data-testid="gzip-ratio" className="text-xs text-muted-foreground">
              {ratioText}
            </span>
          </ConfigRow>
        ) : null}
        {/* 文件通道:拖拽或点击选择文件,压缩/解压结果一键下载 */}
        <ConfigRow
          icon={FileUp}
          label={t('tools.gzip_codec.label_file_mode')}
          hint={t('tools.gzip_codec.hint_file_mode')}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            data-testid="gzip-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void processFile(file);
              e.target.value = '';
            }}
          />
          <Button
            variant="outline"
            size="sm"
            data-testid="gzip-pick"
            onClick={() => fileRef.current?.click()}
          >
            {t('tools.gzip_codec.choose_file')}
          </Button>
          {fileResult ? (
            <Button size="sm" data-testid="gzip-download" onClick={downloadFileResult}>
              {t('tools.gzip_codec.download_result', { name: fileResult.name })}
            </Button>
          ) : null}
        </ConfigRow>
      </ConfigSection>

      <div
        className="min-h-0 flex-1"
        data-testid="gzip-file-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <ResizablePanelGroup orientation="vertical" className="h-full min-h-0">
          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
            <CodeEditor
              title={t('tools.gzip_codec.title_input')}
              language="plaintext"
              value={input}
              onChange={setInput}
              placeholder={
                compressMode
                  ? t('tools.gzip_codec.placeholder_compress_input')
                  : t('tools.gzip_codec.placeholder_decompress_input')
              }
              data-testid="gzip-input"
              className="h-full rounded-none border-0"
              searchAnchor="gzip_codec:input"
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
            <CodeEditor
              title={t('tools.gzip_codec.title_output')}
              language="plaintext"
              value={error ?? output}
              readOnly
              data-testid="gzip-output"
              className="h-full rounded-none border-0"
              searchAnchor="gzip_codec:output"
              actions={<CopyAction text={output} testId="gzip-copy" />}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

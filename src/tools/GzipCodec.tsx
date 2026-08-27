/**
 * GZip 压缩 / 解压缩
 *
 * 压缩:文本 → gzip → base64;解压:base64 → gunzip → 文本。
 * 基于原生 CompressionStream / DecompressionStream,无第三方依赖。
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Gauge } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { base64ToBytes, bytesToBase64, formatBytes } from '@/lib/file-utils';
import type { ToolProps } from './registry';

async function pipeThrough(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const source = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(stream);
  const buffer = await new Response(source).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function gzipText(text: string): Promise<Uint8Array> {
  return pipeThrough(new TextEncoder().encode(text), new CompressionStream('gzip'));
}

export async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const out = await pipeThrough(bytes, new DecompressionStream('gzip'));
  return new TextDecoder().decode(out);
}

export function GzipCodec(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [compressMode, setCompressMode] = useState(true);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ratio, setRatio] = useState<{ before: number; after: number } | null>(null);

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
          const text = await gunzipToText(base64ToBytes(input));
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

  return (
    <div className="flex h-full flex-col gap-3" data-testid="gzip-codec">
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
      </ConfigSection>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
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
            className="h-full"
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
            className="h-full"
            searchAnchor="gzip_codec:output"
            actions={<CopyAction text={output} testId="gzip-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

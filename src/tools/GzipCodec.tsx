/**
 * GZip 压缩 / 解压缩
 *
 * 压缩:文本 → gzip → base64;解压:base64 → gunzip → 文本。
 * 基于原生 CompressionStream / DecompressionStream,无第三方依赖。
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
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
            ? `压缩失败: ${e instanceof Error ? e.message : String(e)}`
            : '解压失败:输入不是有效的 gzip base64 数据',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input, compressMode]);

  const ratioText = useMemo(() => {
    if (!ratio || ratio.before === 0) return null;
    const pct = ((1 - ratio.after / ratio.before) * 100).toFixed(1);
    return `${formatBytes(ratio.before)} → ${formatBytes(ratio.after)}(节省 ${pct}%)`;
  }, [ratio]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="gzip-codec">
      <ConfigSection title="">
        <ConfigRow icon={ArrowLeftRight} label="GZip 转换" hint="选择压缩或解压缩">
          <span className="text-xs text-muted-foreground">{compressMode ? '压缩' : '解压缩'}</span>
          <Switch
            data-testid="gzip-mode-switch"
            aria-label="压缩/解压缩切换"
            checked={compressMode}
            onCheckedChange={setCompressMode}
          />
        </ConfigRow>
        {ratioText ? (
          <ConfigRow icon={Gauge} label="压缩率">
            <span data-testid="gzip-ratio" className="text-xs text-muted-foreground">
              {ratioText}
            </span>
          </ConfigRow>
        ) : null}
      </ConfigSection>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title="输入"
            language="plaintext"
            value={input}
            onChange={setInput}
            placeholder={compressMode ? '输入要压缩的文本' : '输入 gzip base64 数据'}
            data-testid="gzip-input"
            className="h-full"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title="输出"
            language="plaintext"
            value={error ?? output}
            readOnly
            data-testid="gzip-output"
            className="h-full"
            actions={<CopyAction text={output} testId="gzip-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

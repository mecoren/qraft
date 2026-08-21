/**
 * HTML 文本编码器/解码器
 *
 * 编码:& < > " ' → HTML 实体;解码:实体 → 字符(借助 DOMParser,覆盖命名/数字实体)
 */

import { useMemo, useState, type JSX } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function encodeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

export function decodeHtml(input: string): string {
  // DOMParser 正确处理命名实体(&nbsp; 等)与数字实体(&#x27; 等)
  const doc = new DOMParser().parseFromString(input, 'text/html');
  return doc.documentElement.textContent ?? '';
}

export function HtmlCodec(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [encodeMode, setEncodeMode] = useState(true);

  const output = useMemo(() => {
    if (!input) return '';
    try {
      return encodeMode ? encodeHtml(input) : decodeHtml(input);
    } catch (e) {
      return `解析失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [input, encodeMode]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="html-codec">
      <ConfigSection title="" searchAnchor="html_codec:config">
        <ConfigRow icon={ArrowLeftRight} label="转换" hint="选择要使用的转换模式">
          <span className="text-xs text-muted-foreground">{encodeMode ? '编码' : '解码'}</span>
          <Switch
            data-testid="html-mode-switch"
            aria-label="编码/解码切换"
            checked={encodeMode}
            onCheckedChange={setEncodeMode}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title="输入"
            language="html"
            value={input}
            onChange={setInput}
            data-testid="html-input"
            className="h-full"
            searchAnchor="html_codec:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title="输出"
            language="html"
            value={output}
            readOnly
            data-testid="html-output"
            className="h-full"
            searchAnchor="html_codec:output"
            actions={<CopyAction text={output} testId="html-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

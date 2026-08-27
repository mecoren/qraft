/**
 * HTML 文本编码器/解码器
 *
 * 编码:& < > " ' → HTML 实体;解码:实体 → 字符(借助 DOMParser,覆盖命名/数字实体)
 */

import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [encodeMode, setEncodeMode] = useState(true);

  const output = useMemo(() => {
    if (!input) return '';
    try {
      return encodeMode ? encodeHtml(input) : decodeHtml(input);
    } catch (e) {
      return t('tools.html_codec.error_parse', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [input, encodeMode, t]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="html-codec">
      <ConfigSection title="" searchAnchor="html_codec:config">
        <ConfigRow
          icon={ArrowLeftRight}
          label={t('tools.html_codec.label_convert')}
          hint={t('tools.html_codec.hint_mode')}
        >
          <span className="text-xs text-muted-foreground">
            {encodeMode ? t('tools.html_codec.mode_encode') : t('tools.html_codec.mode_decode')}
          </span>
          <Switch
            data-testid="html-mode-switch"
            aria-label={t('tools.html_codec.aria_mode_toggle')}
            checked={encodeMode}
            onCheckedChange={setEncodeMode}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title={t('tools.html_codec.title_input')}
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
            title={t('tools.html_codec.title_output')}
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

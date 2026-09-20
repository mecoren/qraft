/**
 * HTML 文本编码器/解码器
 *
 * 编码三模式:minimal(防注入最小集)/ nonAscii(输出纯 ASCII)/ all(全命名实体);
 * 解码:命名实体 + 十进制/十六进制数字实体。
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, FileCode } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { encodeHtml, decodeHtml, type HtmlEncodeMode } from './html-codec-utils';
import type { ToolProps } from './registry';

export function HtmlCodec({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [encodeMode, setEncodeMode] = useState(true);
  const [escapeLevel, setEscapeLevel] = useState<HtmlEncodeMode>('minimal');
  // 编码对长文本是 O(n) 正则替换:defer 输入优先,转换低优先级追赶
  const deferredInput = useDeferredValue(input);

  const output = useMemo(() => {
    if (!deferredInput) return '';
    return encodeMode ? encodeHtml(deferredInput, escapeLevel) : decodeHtml(deferredInput);
  }, [deferredInput, encodeMode, escapeLevel]);

  useToolShortcutActions(toolId, {
    clearInput: () => setInput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 纵向双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="html-codec"
    >
      <ConfigSection
        headerHint={t('tools.html_codec.section_hint')}
        searchAnchor="html_codec:config"
      >
        <ConfigRow
          icon={ArrowLeftRight}
          caption={t('tools.html_codec.label_convert')}
          captionHint={t('tools.html_codec.hint_mode')}
        >
          {/* 二选一方向用分段控件而非开关,与 Base64Codec 基准同形态 */}
          <Tabs
            value={encodeMode ? 'encode' : 'decode'}
            onValueChange={(v) => setEncodeMode(v === 'encode')}
          >
            <TabsList className="h-7 w-fit">
              <TabsTrigger
                value="encode"
                data-testid="dir-encode"
                className="gap-1 px-2 py-0.5 text-xs"
              >
                <ArrowUpFromLine aria-hidden className="size-3.5" />
                {t('tools.html_codec.mode_encode')}
              </TabsTrigger>
              <TabsTrigger
                value="decode"
                data-testid="dir-decode"
                className="gap-1 px-2 py-0.5 text-xs"
              >
                <ArrowDownToLine aria-hidden className="size-3.5" />
                {t('tools.html_codec.mode_decode')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </ConfigRow>
        {encodeMode ? (
          <ConfigRow
            icon={FileCode}
            caption={t('tools.html_codec.caption_escape_level')}
            captionHint={t('tools.html_codec.hint_escape_level')}
          >
            <Select value={escapeLevel} onValueChange={(v) => setEscapeLevel(v as HtmlEncodeMode)}>
              <SelectTrigger data-testid="html-escape-level" className="h-7 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minimal">{t('tools.html_codec.escape_minimal')}</SelectItem>
                <SelectItem value="nonAscii">{t('tools.html_codec.escape_non_ascii')}</SelectItem>
                <SelectItem value="all">{t('tools.html_codec.escape_all')}</SelectItem>
              </SelectContent>
            </Select>
          </ConfigRow>
        ) : null}
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.html_codec.title_input')}
            language="html"
            value={input}
            onChange={setInput}
            data-testid="html-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="html_codec:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.html_codec.title_output')}
            language="html"
            value={output}
            readOnly
            data-testid="html-output"
            className="h-full rounded-none border-0 border-l"
            searchAnchor="html_codec:output"
            actions={<CopyAction text={output} testId="html-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

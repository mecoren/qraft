/**
 * XML 格式化器 —— DOMParser 解析 + 递归序列化
 *
 * 支持:缩进(2/4空格/Tab/压缩)、属性换行开关、
 * 保留 XML 声明 / DOCTYPE / 处理指令 / 注释 / CDATA。
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { IndentIncrease, WrapText } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { SendToMenu } from '@/components/send-to-menu';
import { formatXml, type IndentMode } from './xml-format-utils';
import type { ToolProps } from './registry';

export function XmlFormatter({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<IndentMode>('2');
  const [attrNewLine, setAttrNewLine] = useState(false);
  // DOMParser + 序列化对大 XML 较重:defer 输入优先,格式化低优先级追赶
  const deferredInput = useDeferredValue(input);

  const output = useMemo(() => {
    if (!deferredInput.trim()) return '';
    try {
      return formatXml(deferredInput, mode, attrNewLine);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // 片段键(如 parse_error 回退)在组件层翻译,浏览器原始解析文本原样透传
      return t('tools.xml_formatter.format_failed', {
        message: raw.startsWith('tools.') ? t(raw) : raw,
      });
    }
  }, [deferredInput, mode, attrNewLine, t]);

  useToolShortcutActions(toolId, {
    clearInput: () => setInput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 横向双栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="xml-formatter"
    >
      <ConfigSection title="" searchAnchor="xml_formatter:config">
        <ConfigRow icon={IndentIncrease} label={t('tools.xml_formatter.indent')}>
          <Select value={mode} onValueChange={(v) => setMode(v as IndentMode)}>
            <SelectTrigger data-testid="xml-indent" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">{t('tools.xml_formatter.indent_2')}</SelectItem>
              <SelectItem value="4">{t('tools.xml_formatter.indent_4')}</SelectItem>
              <SelectItem value="tab">{t('tools.xml_formatter.indent_tab')}</SelectItem>
              <SelectItem value="minify">{t('tools.xml_formatter.indent_minify')}</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow
          icon={WrapText}
          label={t('tools.xml_formatter.attr_newline')}
          hint={t('tools.xml_formatter.attr_newline_hint')}
        >
          <Switch
            data-testid="xml-attr-newline"
            aria-label={t('tools.xml_formatter.attr_newline')}
            checked={attrNewLine}
            onCheckedChange={setAttrNewLine}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.xml_formatter.input_title')}
            language="xml"
            value={input}
            onChange={setInput}
            data-testid="xmlfmt-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="xml_formatter:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.xml_formatter.output_title')}
            language="xml"
            value={output}
            readOnly
            data-testid="xmlfmt-output"
            className="h-full rounded-none border-0 border-l"
            searchAnchor="xml_formatter:output"
            actions={
              <>
                {output && <CopyAction text={output} testId="xmlfmt-copy" />}
                {output && <SendToMenu text={output} currentToolId={toolId} testId="xmlfmt-send" />}
              </>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * XML 格式化器 —— DOMParser 解析 + 递归序列化
 *
 * 支持:缩进(2/4空格/Tab/压缩)、属性换行开关。
 */

import { useMemo, useState, type JSX } from 'react';
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
import type { ToolProps } from './registry';

type IndentMode = '2' | '4' | 'tab' | 'minify';

function indentUnit(mode: IndentMode): string {
  if (mode === 'tab') return '\t';
  if (mode === 'minify') return '';
  return ' '.repeat(Number(mode));
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function escapeTextContent(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function serializeNode(
  node: Node,
  unit: string,
  depth: number,
  attrsOnNewLine: boolean,
): string {
  const pad = unit ? unit.repeat(depth) : '';
  const nl = unit ? '\n' : '';

  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').trim();
    return text ? `${pad}${escapeTextContent(text)}${nl}` : '';
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    return `${pad}<!--${node.textContent ?? ''}-->${nl}`;
  }
  if (node.nodeType === Node.CDATA_SECTION_NODE) {
    return `${pad}<![CDATA[${node.textContent ?? ''}]]>${nl}`;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const attrs = Array.from(el.attributes);
  let attrText = '';
  if (attrs.length > 0) {
    if (attrsOnNewLine && unit && attrs.length > 1) {
      const attrPad = unit.repeat(depth + 1);
      attrText = `\n${attrs
        .map((a) => `${attrPad}${a.name}="${escapeAttr(a.value)}"`)
        .join('\n')}`;
    } else {
      attrText = ` ${attrs.map((a) => `${a.name}="${escapeAttr(a.value)}"`).join(' ')}`;
    }
  }

  const children = Array.from(el.childNodes).filter(
    (c) =>
      c.nodeType !== Node.TEXT_NODE || (c.textContent ?? '').trim().length > 0,
  );

  if (children.length === 0) {
    return `${pad}<${el.tagName}${attrText} />${nl}`;
  }

  // 单文本子节点:同一行输出
  if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
    const text = escapeTextContent((children[0].textContent ?? '').trim());
    return `${pad}<${el.tagName}${attrText}>${text}</${el.tagName}>${nl}`;
  }

  const inner = children
    .map((c) => serializeNode(c, unit, depth + 1, attrsOnNewLine))
    .join('');
  return `${pad}<${el.tagName}${attrText}>${nl}${inner}${pad}</${el.tagName}>${nl}`;
}

export function formatXml(input: string, mode: IndentMode, attrsOnNewLine: boolean): string {
  const doc = new DOMParser().parseFromString(input, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    throw new Error(err.textContent?.trim().split('\n')[0] ?? 'XML 解析错误');
  }
  const unit = indentUnit(mode);
  const decl = /^\s*<\?xml/.test(input)
    ? `<?xml version="1.0" encoding="UTF-8"?>${unit ? '\n' : ''}`
    : '';
  return (decl + serializeNode(doc.documentElement, unit, 0, attrsOnNewLine)).trimEnd();
}

export function XmlFormatter(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<IndentMode>('2');
  const [attrNewLine, setAttrNewLine] = useState(false);

  const output = useMemo(() => {
    if (!input.trim()) return '';
    try {
      return formatXml(input, mode, attrNewLine);
    } catch (e) {
      return `格式化失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [input, mode, attrNewLine]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="xml-formatter">
      <ConfigSection title="">
        <ConfigRow icon={IndentIncrease} label="缩进">
          <Select value={mode} onValueChange={(v) => setMode(v as IndentMode)}>
            <SelectTrigger data-testid="xml-indent" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2 个空格</SelectItem>
              <SelectItem value="4">4 个空格</SelectItem>
              <SelectItem value="tab">制表符</SelectItem>
              <SelectItem value="minify">压缩</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={WrapText} label="属性换行" hint="多个属性时每个属性单独一行">
          <Switch
            data-testid="xml-attr-newline"
            aria-label="属性换行"
            checked={attrNewLine}
            onCheckedChange={setAttrNewLine}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输入"
            language="xml"
            value={input}
            onChange={setInput}
            data-testid="xmlfmt-input"
            className="h-full"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输出"
            language="xml"
            value={output}
            readOnly
            data-testid="xmlfmt-output"
            className="h-full"
            actions={<CopyAction text={output} testId="xmlfmt-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * 文本转义 / 反转义
 *
 * 转义:\ " ' 换行 回车 制表符等控制字符 → 反斜杠序列;反转义为逆操作。
 */

import { useMemo, useState, type JSX } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

export function escapeText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f')
    .replace(/[\b]/g, '\\b')
    .replace(/\v/g, '\\v')
    .replace(/\0/g, '\\0');
}

export function unescapeText(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '\\' || i === input.length - 1) {
      out += ch;
      continue;
    }
    const next = input[++i];
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'f':
        out += '\f';
        break;
      case 'b':
        out += '\b';
        break;
      case 'v':
        out += '\v';
        break;
      case '0':
        out += '\0';
        break;
      case 'u': {
        // \uXXXX
        const hex = input.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += '\\u';
        }
        break;
      }
      case 'x': {
        // \xXX
        const hex = input.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        } else {
          out += '\\x';
        }
        break;
      }
      default:
        // \\ \" \' 与未知序列:保留字符本身
        out += next;
    }
  }
  return out;
}

export function TextEscape(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [escapeMode, setEscapeMode] = useState(true);

  const output = useMemo(() => {
    if (!input) return '';
    return escapeMode ? escapeText(input) : unescapeText(input);
  }, [input, escapeMode]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="text-escape">
      <ConfigSection>
        <ConfigRow icon={ArrowLeftRight} label="转换" hint="选择要使用的转换模式">
          <span className="text-xs text-muted-foreground">{escapeMode ? '转义' : '反转义'}</span>
          <Switch
            data-testid="escape-mode-switch"
            aria-label="转义/反转义切换"
            checked={escapeMode}
            onCheckedChange={setEscapeMode}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title="输入"
            language="plaintext"
            value={input}
            onChange={setInput}
            data-testid="escape-input"
            className="h-full"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
          <CodeEditor
            title="输出"
            language="plaintext"
            value={output}
            readOnly
            data-testid="escape-output"
            className="h-full"
            actions={<CopyAction text={output} testId="escape-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * 文本分析和实用工具
 *
 * - 统计:字符 / 单词 / 行 / 字节 / 句子 / 段落
 * - 实用转换:大写 / 小写 / 句首大写 / 每词首字母大写 / 反转 / 去重行 / 排序行
 */

import { useMemo, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

export interface TextStats {
  chars: number;
  charsNoSpace: number;
  words: number;
  lines: number;
  bytes: number;
  sentences: number;
  paragraphs: number;
}

export function analyzeText(text: string): TextStats {
  if (!text) {
    return { chars: 0, charsNoSpace: 0, words: 0, lines: 0, bytes: 0, sentences: 0, paragraphs: 0 };
  }
  const chars = Array.from(text).length;
  const charsNoSpace = Array.from(text.replace(/\s/g, '')).length;
  // 中日韩字符逐字计数,拉丁词按空白分词
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const latinWords = (
    text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/\S+/g) ?? []
  ).length;
  const words = cjk + latinWords;
  const lines = text.split('\n').length;
  const bytes = new TextEncoder().encode(text).length;
  const sentences = (text.match(/[.!?。!?]+/g) ?? []).length || (text.trim() ? 1 : 0);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  return { chars, charsNoSpace, words, lines, bytes, sentences, paragraphs };
}

type Transform = 'upper' | 'lower' | 'sentence' | 'title' | 'reverse' | 'dedupeLines' | 'sortLines';

export function transformText(text: string, kind: Transform): string {
  switch (kind) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'sentence':
      return text.toLowerCase().replace(/(^\s*[a-z])|([.!?。!?]\s*[a-z])/g, (m) => m.toUpperCase());
    case 'title':
      return text.replace(/\b[a-z]/g, (m) => m.toUpperCase());
    case 'reverse':
      return Array.from(text).reverse().join('');
    case 'dedupeLines': {
      const seen = new Set<string>();
      return text
        .split('\n')
        .filter((l) => {
          if (seen.has(l)) return false;
          seen.add(l);
          return true;
        })
        .join('\n');
    }
    case 'sortLines':
      return text
        .split('\n')
        .sort((a, b) => a.localeCompare(b))
        .join('\n');
  }
}

const TRANSFORMS: Array<{ kind: Transform; label: string }> = [
  { kind: 'upper', label: '全部大写' },
  { kind: 'lower', label: '全部小写' },
  { kind: 'sentence', label: '句首大写' },
  { kind: 'title', label: '词首大写' },
  { kind: 'reverse', label: '反转文本' },
  { kind: 'dedupeLines', label: '去重行' },
  { kind: 'sortLines', label: '排序行' },
];

export function TextAnalyzer(_props: ToolProps): JSX.Element {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  const stats = useMemo(() => analyzeText(input), [input]);

  const STAT_ITEMS: Array<{ label: string; value: number }> = [
    { label: '字符', value: stats.chars },
    { label: '字符(不含空白)', value: stats.charsNoSpace },
    { label: '单词', value: stats.words },
    { label: '行', value: stats.lines },
    { label: '字节(UTF-8)', value: stats.bytes },
    { label: '句子', value: stats.sentences },
    { label: '段落', value: stats.paragraphs },
  ];

  return (
    <div className="flex h-full flex-col gap-3" data-testid="text-analyzer">
      {/* 统计 */}
      <div className="grid grid-cols-7 gap-2" data-testid="ta-stats">
        {STAT_ITEMS.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-card px-2 py-2 text-center shadow-card"
          >
            <div className="text-lg font-semibold tabular-nums">{s.value}</div>
            <div className="text-caption text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 转换操作 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-card">
        {TRANSFORMS.map((t) => (
          <Button
            key={t.kind}
            size="sm"
            variant="secondary"
            data-testid={`ta-${t.kind}`}
            onClick={() => setOutput(transformText(input, t.kind))}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输入"
            language="plaintext"
            value={input}
            onChange={setInput}
            data-testid="ta-input"
            className="h-full"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="输出"
            language="plaintext"
            value={output}
            readOnly
            data-testid="ta-output"
            className="h-full"
            actions={<CopyAction text={output} testId="ta-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

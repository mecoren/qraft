/**
 * 列表比对器 —— 比对两个列表(按行),输出交集 / 并集 / 差集
 */

import { useMemo, useState, type JSX } from 'react';
import { CaseSensitive, ListChecks } from 'lucide-react';
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

type CompareMode = 'intersection' | 'union' | 'onlyA' | 'onlyB';

const MODE_LABEL: Record<CompareMode, string> = {
  intersection: '交集(A ∩ B)',
  union: '并集(A ∪ B)',
  onlyA: '仅在 A 中(A - B)',
  onlyB: '仅在 B 中(B - A)',
};

export function compareLists(
  aText: string,
  bText: string,
  mode: CompareMode,
  caseSensitive: boolean,
  trimItems: boolean,
): string[] {
  const normalize = (s: string): string => {
    let out = trimItems ? s.trim() : s;
    if (!caseSensitive) out = out.toLowerCase();
    return out;
  };
  const parse = (text: string): { keys: Set<string>; items: Map<string, string> } => {
    const keys = new Set<string>();
    const items = new Map<string, string>();
    for (const line of text.split('\n')) {
      const raw = trimItems ? line.trim() : line;
      if (!raw) continue;
      const key = normalize(line);
      if (!keys.has(key)) {
        keys.add(key);
        items.set(key, raw);
      }
    }
    return { keys, items };
  };

  const a = parse(aText);
  const b = parse(bText);

  switch (mode) {
    case 'intersection':
      return [...a.keys].filter((k) => b.keys.has(k)).map((k) => a.items.get(k)!);
    case 'union': {
      const out = new Map<string, string>(a.items);
      for (const [k, v] of b.items) if (!out.has(k)) out.set(k, v);
      return [...out.values()];
    }
    case 'onlyA':
      return [...a.keys].filter((k) => !b.keys.has(k)).map((k) => a.items.get(k)!);
    case 'onlyB':
      return [...b.keys].filter((k) => !a.keys.has(k)).map((k) => b.items.get(k)!);
  }
}

export function ListComparer(_props: ToolProps): JSX.Element {
  const [listA, setListA] = useState('');
  const [listB, setListB] = useState('');
  const [mode, setMode] = useState<CompareMode>('intersection');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [trimItems, setTrimItems] = useState(true);

  const result = useMemo(() => {
    if (!listA.trim() && !listB.trim()) return '';
    return compareLists(listA, listB, mode, caseSensitive, trimItems).join('\n');
  }, [listA, listB, mode, caseSensitive, trimItems]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="list-comparer">
      <ConfigSection>
        <ConfigRow icon={CaseSensitive} label="区分大小写">
          <Switch
            checked={caseSensitive}
            onCheckedChange={setCaseSensitive}
            aria-label="区分大小写"
            data-testid="lc-case"
          />
        </ConfigRow>
        <ConfigRow icon={ListChecks} label="比较模式">
          <Select value={mode} onValueChange={(v) => setMode(v as CompareMode)}>
            <SelectTrigger data-testid="lc-mode" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABEL) as CompareMode[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={ListChecks} label="修剪空白" hint="忽略行首尾空白与空行">
          <Switch
            checked={trimItems}
            onCheckedChange={setTrimItems}
            aria-label="修剪空白"
            data-testid="lc-trim"
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={34} minSize={15} className="min-h-0 min-w-0">
          <CodeEditor
            title="列表 A"
            language="plaintext"
            value={listA}
            onChange={setListA}
            data-testid="lc-a"
            className="h-full"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={33} minSize={15} className="min-h-0 min-w-0">
          <CodeEditor
            title="列表 B"
            language="plaintext"
            value={listB}
            onChange={setListB}
            data-testid="lc-b"
            className="h-full"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={33} minSize={15} className="min-h-0 min-w-0">
          <CodeEditor
            title={`结果 · ${MODE_LABEL[mode]}`}
            language="plaintext"
            value={result}
            readOnly
            data-testid="lc-result"
            className="h-full"
            actions={<CopyAction text={result} testId="lc-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

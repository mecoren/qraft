/**
 * 列表比对器 —— 比对两个列表(按行),输出交集 / 并集 / 差集
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { CaseSensitive, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

const MODE_LABEL_KEY: Record<CompareMode, string> = {
  intersection: 'tools.list_comparer.mode_intersection',
  union: 'tools.list_comparer.mode_union',
  onlyA: 'tools.list_comparer.mode_only_a',
  onlyB: 'tools.list_comparer.mode_only_b',
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
  const { t } = useTranslation();
  const [listA, setListA] = useState('');
  const [listB, setListB] = useState('');
  const [mode, setMode] = useState<CompareMode>('intersection');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [trimItems, setTrimItems] = useState(true);
  // 万级行对比(规范化 + 集合运算)开销随行数增长明显:defer 双侧输入
  const deferredA = useDeferredValue(listA);
  const deferredB = useDeferredValue(listB);

  const result = useMemo(() => {
    if (!deferredA.trim() && !deferredB.trim()) return '';
    return compareLists(deferredA, deferredB, mode, caseSensitive, trimItems).join('\n');
  }, [deferredA, deferredB, mode, caseSensitive, trimItems]);

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区 + 三栏工作区收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="list-comparer"
    >
      <ConfigSection title="" searchAnchor="list_comparer:config">
        <ConfigRow icon={CaseSensitive} label={t('tools.list_comparer.case_sensitive')}>
          <Switch
            checked={caseSensitive}
            onCheckedChange={setCaseSensitive}
            aria-label={t('tools.list_comparer.case_sensitive')}
            data-testid="lc-case"
          />
        </ConfigRow>
        <ConfigRow icon={ListChecks} label={t('tools.list_comparer.compare_mode')}>
          <Select value={mode} onValueChange={(v) => setMode(v as CompareMode)}>
            <SelectTrigger data-testid="lc-mode" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABEL_KEY) as CompareMode[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {t(MODE_LABEL_KEY[m])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow
          icon={ListChecks}
          label={t('tools.list_comparer.trim_whitespace')}
          hint={t('tools.list_comparer.trim_whitespace_hint')}
        >
          <Switch
            checked={trimItems}
            onCheckedChange={setTrimItems}
            aria-label={t('tools.list_comparer.trim_whitespace')}
            data-testid="lc-trim"
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={34} minSize={15} className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.list_comparer.list_a')}
            language="plaintext"
            value={listA}
            onChange={setListA}
            data-testid="lc-a"
            // 三栏最左:只保留右侧边框(朝向与 B 列的分隔缝),外三边由 shell 提供
            className="h-full rounded-none border-0 border-r"
            searchAnchor="list_comparer:a"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={33} minSize={15} className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.list_comparer.list_b')}
            language="plaintext"
            value={listB}
            onChange={setListB}
            data-testid="lc-b"
            // 三栏居中:保留左右两侧边框(分别朝向 A/C 两列的分隔缝)
            className="h-full rounded-none border-0 border-r border-l"
            searchAnchor="list_comparer:b"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={33} minSize={15} className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.list_comparer.result_title', { mode: t(MODE_LABEL_KEY[mode]) })}
            language="plaintext"
            value={result}
            readOnly
            data-testid="lc-result"
            // 三栏最右:只保留左侧边框(朝向与 B 列的分隔缝),外三边由 shell 提供
            className="h-full rounded-none border-0 border-l"
            searchAnchor="list_comparer:result"
            actions={<CopyAction text={result} testId="lc-copy" />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * 列表比对器 —— 比对两个列表(按行),输出交集 / 并集 / 差集
 */

import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { CaseSensitive, Hash, ListChecks } from 'lucide-react';
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
import { useToolHandoff } from '@/hooks/useToolHandoff';
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
  return compareListsWithCounts(aText, bText, mode, caseSensitive, trimItems).map((r) => r.value);
}

export interface ListCountRow {
  value: string;
  /** A 侧出现次数(onlyB 模式为 B 侧出现次数) */
  count: number;
}

/**
 * 带计数的列表比对:与 compareLists 同序同口径,额外返回每项在
 * A 侧(onlyB 时为 B 侧)的出现次数,与重复行检测器的「值 / 数量」同构。
 */
export function compareListsWithCounts(
  aText: string,
  bText: string,
  mode: CompareMode,
  caseSensitive: boolean,
  trimItems: boolean,
): ListCountRow[] {
  const normalize = (s: string): string => {
    let out = trimItems ? s.trim() : s;
    if (!caseSensitive) out = out.toLowerCase();
    return out;
  };
  /** keys 额外登记首次出现顺序;counts 统计该侧每 key 的出现次数 */
  const parse = (text: string) => {
    const keys = new Set<string>();
    const items = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const line of text.split('\n')) {
      const raw = trimItems ? line.trim() : line;
      if (!raw) continue;
      const key = normalize(line);
      if (!keys.has(key)) {
        keys.add(key);
        items.set(key, raw);
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { keys, items, counts };
  };

  const a = parse(aText);
  const b = parse(bText);

  switch (mode) {
    case 'intersection':
      return [...a.keys]
        .filter((k) => b.keys.has(k))
        .map((k) => ({ value: a.items.get(k)!, count: a.counts.get(k)! }));
    case 'union': {
      const out = new Map<string, string>(a.items);
      for (const [k, v] of b.items) if (!out.has(k)) out.set(k, v);
      return [...out.entries()].map(([k, v]) => ({ value: v, count: a.counts.get(k) ?? 1 }));
    }
    case 'onlyA':
      return [...a.keys]
        .filter((k) => !b.keys.has(k))
        .map((k) => ({ value: a.items.get(k)!, count: a.counts.get(k)! }));
    case 'onlyB':
      return [...b.keys]
        .filter((k) => !a.keys.has(k))
        .map((k) => ({ value: b.items.get(k)!, count: b.counts.get(k)! }));
  }
}

export function ListComparer({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [listA, setListA] = useState('');
  const [listB, setListB] = useState('');
  const [mode, setMode] = useState<CompareMode>('intersection');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [trimItems, setTrimItems] = useState(true);
  // 计数模式:结果附「来源侧出现次数」,与重复行检测器的值/数量口径一致
  const [withCounts, setWithCounts] = useState(false);

  // handoff 接收:跨工具发来的文本进入 A 列(首个输入位)
  useToolHandoff(toolId, setListA);
  // 万级行对比(规范化 + 集合运算)开销随行数增长明显:defer 双侧输入
  const deferredA = useDeferredValue(listA);
  const deferredB = useDeferredValue(listB);

  const result = useMemo(() => {
    if (!deferredA.trim() && !deferredB.trim()) return '';
    const rows = compareListsWithCounts(deferredA, deferredB, mode, caseSensitive, trimItems);
    return withCounts
      ? rows.map((r) => `${r.value}\t${r.count}`).join('\n')
      : rows.map((r) => r.value).join('\n');
  }, [deferredA, deferredB, mode, caseSensitive, trimItems, withCounts]);

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
        <ConfigRow
          icon={Hash}
          label={t('tools.list_comparer.with_counts')}
          hint={t('tools.list_comparer.with_counts_hint')}
        >
          <Switch
            checked={withCounts}
            onCheckedChange={setWithCounts}
            aria-label={t('tools.list_comparer.with_counts')}
            data-testid="lc-count"
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="34" minSize="15" className="min-h-0 min-w-0">
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
        <ResizablePanel defaultSize="33" minSize="15" className="min-h-0 min-w-0">
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
        <ResizablePanel defaultSize="33" minSize="15" className="min-h-0 min-w-0">
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

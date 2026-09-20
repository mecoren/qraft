/**
 * 乱数假文生成器 —— 词/句/段三种粒度
 */

import { useCallback, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, ListOrdered, Pilcrow, RefreshCw } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

const WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ' +
  'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud ' +
  'exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure ' +
  'in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint ' +
  'occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'
).split(' ');

type Granularity = 'words' | 'sentences' | 'paragraphs';

function pick(rand: () => number): string {
  return WORDS[Math.floor(rand() * WORDS.length)];
}

function makeSentence(rand: () => number): string {
  const len = 6 + Math.floor(rand() * 10);
  const words = Array.from({ length: len }, () => pick(rand));
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

function makeParagraph(rand: () => number): string {
  const n = 3 + Math.floor(rand() * 4);
  return Array.from({ length: n }, () => makeSentence(rand)).join(' ');
}

export function generateLorem(
  granularity: Granularity,
  count: number,
  startWithLorem: boolean,
  rand: () => number = Math.random,
): string {
  const n = Math.min(Math.max(count, 1), 999);
  let result: string;
  switch (granularity) {
    case 'words': {
      const words = Array.from({ length: n }, () => pick(rand));
      result = words.join(' ');
      break;
    }
    case 'sentences':
      result = Array.from({ length: n }, () => makeSentence(rand)).join(' ');
      break;
    case 'paragraphs':
      result = Array.from({ length: n }, () => makeParagraph(rand)).join('\n\n');
      break;
  }
  if (startWithLorem && !result.toLowerCase().startsWith('lorem ipsum')) {
    const prefix = 'Lorem ipsum dolor sit amet';
    result =
      granularity === 'words'
        ? `${prefix} ${result}`
        : `${prefix}, ${result.charAt(0).toLowerCase()}${result.slice(1)}`;
  }
  return result;
}

export function LoremIpsum(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<Granularity>('paragraphs');
  const [count, setCount] = useState(3);
  const [startWithLorem, setStartWithLorem] = useState(true);
  // 重新生成种子:useMemo 依赖它打破「输出只随配置变化」——同配置下点
  // 「重新生成」也能得到新的随机文本(此前输出被配置 memo 锁死)
  const [seed, setSeed] = useState(0);

  const output = useMemo(() => {
    void seed;
    return generateLorem(granularity, count, startWithLorem);
  }, [granularity, count, startWithLorem, seed]);

  const regenerate = useCallback(() => setSeed((s) => s + 1), []);

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与输出编辑器收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="lorem-ipsum"
    >
      <ConfigSection
        headerHint={t('tools.lorem_ipsum.section_hint')}
        searchAnchor="lorem_ipsum:config"
      >
        <ConfigRow
          icon={Pilcrow}
          caption={t('tools.lorem_ipsum.label_type')}
          captionHint={t('tools.lorem_ipsum.hint_granularity')}
        >
          <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <SelectTrigger data-testid="lorem-type" className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="words">{t('tools.lorem_ipsum.granularity_words')}</SelectItem>
              <SelectItem value="sentences">
                {t('tools.lorem_ipsum.granularity_sentences')}
              </SelectItem>
              <SelectItem value="paragraphs">
                {t('tools.lorem_ipsum.granularity_paragraphs')}
              </SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow
          icon={ListOrdered}
          caption={t('tools.lorem_ipsum.label_count')}
          captionHint="1 ~ 999"
        >
          <Input
            type="number"
            min={1}
            max={999}
            value={count}
            onChange={(e) => {
              // 钳制口径与 generateLorem 一致:输入越界值立即钳到 1..999,
              // 框内显示值即实际生成量(此前可显示 5000 但生成恒为 999 条)
              const n = Math.floor(Number(e.target.value)) || 1;
              setCount(Math.min(999, Math.max(1, n)));
            }}
            aria-label={t('tools.lorem_ipsum.count_aria')}
            data-testid="lorem-count"
            className="h-7 w-20 text-right text-xs"
          />
        </ConfigRow>
        <ConfigRow
          icon={FileText}
          caption={t('tools.lorem_ipsum.caption_start_with_lorem')}
          captionHint={t('tools.lorem_ipsum.start_with_lorem_aria')}
        >
          <Switch
            checked={startWithLorem}
            onCheckedChange={setStartWithLorem}
            aria-label={t('tools.lorem_ipsum.start_with_lorem_aria')}
            data-testid="lorem-start"
          />
        </ConfigRow>
      </ConfigSection>

      <CodeEditor
        title={t('tools.lorem_ipsum.output_title')}
        language="plaintext"
        value={output}
        readOnly
        data-testid="lorem-output"
        className="min-h-0 flex-1 rounded-none border-0"
        searchAnchor="lorem_ipsum:output"
        actions={
          <>
            <button
              type="button"
              data-testid="lorem-regenerate"
              title={t('tools.lorem_ipsum.regenerate')}
              aria-label={t('tools.lorem_ipsum.regenerate')}
              onClick={regenerate}
              className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw aria-hidden className="size-3.5" /> {t('tools.lorem_ipsum.regenerate')}
            </button>
            <CopyAction text={output} testId="lorem-copy" />
          </>
        }
      />
    </div>
  );
}

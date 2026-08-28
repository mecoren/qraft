/**
 * 乱数假文生成器 —— 词/句/段三种粒度
 */

import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, ListOrdered, Pilcrow } from 'lucide-react';
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

  const output = useMemo(() => {
    return generateLorem(granularity, count, startWithLorem);
  }, [granularity, count, startWithLorem]);

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与输出编辑器收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="lorem-ipsum"
    >
      <ConfigSection title="" searchAnchor="lorem_ipsum:config">
        <ConfigRow
          icon={Pilcrow}
          label={t('tools.lorem_ipsum.label_type')}
          hint={t('tools.lorem_ipsum.hint_granularity')}
        >
          <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <SelectTrigger data-testid="lorem-type" className="w-28">
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
        <ConfigRow icon={ListOrdered} label={t('tools.lorem_ipsum.label_count')}>
          <Input
            type="number"
            min={1}
            max={999}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
            aria-label={t('tools.lorem_ipsum.count_aria')}
            data-testid="lorem-count"
            className="h-7 w-20 text-right text-body-sm"
          />
        </ConfigRow>
        <ConfigRow icon={FileText} label={t('tools.lorem_ipsum.label_start_with_lorem')}>
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
        actions={<CopyAction text={output} testId="lorem-copy" />}
      />
    </div>
  );
}

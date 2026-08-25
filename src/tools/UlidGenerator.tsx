/**
 * ULID 生成器 —— 纯前端 crypto.getRandomValues,按毫秒时间戳有序。
 * 26 位 Crockford Base32:前 10 字符 = 48bit 毫秒时间戳,后 16 字符 = 80bit 随机。
 */
import { useState, type JSX } from 'react';
import { Fingerprint } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { generateUlid } from './ulid-utils';
import type { ToolProps } from './registry';

export function UlidGenerator({ toolId }: ToolProps): JSX.Element {
  const [count, setCount] = useState(5);
  const [output, setOutput] = useState('');

  function handleGenerate(): void {
    // 非法/越界数量按 1 兜底,上限 100 防误操作刷屏
    const n = Math.min(100, Math.max(1, Math.floor(count) || 1));
    setOutput(Array.from({ length: n }, () => generateUlid()).join('\n'));
  }

  useToolShortcutActions(toolId, {
    execute: () => handleGenerate(),
    clearInput: () => setOutput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="ulid-generator">
      <ConfigSection title="" searchAnchor="ulid_generator:config">
        <ConfigRow icon={Fingerprint} label="数量" hint="1–100,每行一个">
          <Input
            aria-label="生成数量"
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-24"
          />
        </ConfigRow>
      </ConfigSection>
      <CodeEditor
        title="ULID"
        language="plaintext"
        readOnly
        value={output}
        data-testid="output"
        searchAnchor="ulid_generator:output"
        actions={
          <>
            <HeaderAction onClick={() => handleGenerate()}>生成</HeaderAction>
            {output && <CopyAction text={output} testId="copy-ulid" />}
          </>
        }
      />
    </div>
  );
}

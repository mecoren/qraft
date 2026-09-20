/**
 * NanoID 生成器 —— 纯前端 crypto.getRandomValues + 拒绝采样(无模偏差)。
 * 左右分栏(对齐 QrcodeTool 非编辑器面板模式):左生成参数「编辑框」式
 * 面板,右输出编辑器;字母表与长度配置收进顶部配置区,本机生成,不落盘不上传。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Play } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { NANO_DEFAULT_ALPHABET, NANO_DEFAULT_SIZE, generateNanoId } from './nanoid-utils';
import type { ToolProps } from './registry';

export function NanoidGenerator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [count, setCount] = useState(5);
  const [size, setSize] = useState(NANO_DEFAULT_SIZE);
  const [alphabet, setAlphabet] = useState(NANO_DEFAULT_ALPHABET);
  const [output, setOutput] = useState('');

  // 字母表合法性(组件内仅用于禁用生成与提示;纯函数内非法回退默认)
  const alphabetValid =
    alphabet.length >= 2 && alphabet.length <= 255 && new Set(alphabet).size === alphabet.length;

  function handleGenerate(): void {
    if (!alphabetValid) return;
    const n = Math.min(500, Math.max(1, Math.floor(count) || 1));
    setOutput(Array.from({ length: n }, () => generateNanoId(size, alphabet)).join('\n'));
  }

  useToolShortcutActions(toolId, {
    execute: () => handleGenerate(),
    clearInput: () => setOutput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 QrcodeTool 基准):配置区在上,左右分栏收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="nanoid-generator"
    >
      <ConfigSection
        headerHint={t('tools.nanoid_generator.section_hint')}
        searchAnchor="nanoid_generator:config"
      >
        <ConfigRow
          icon={Fingerprint}
          caption={t('tools.nanoid_generator.count')}
          captionHint={t('tools.nanoid_generator.count_hint')}
        >
          <Input
            aria-label={t('tools.nanoid_generator.count_aria')}
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-7 w-24 text-xs"
          />
        </ConfigRow>
        <ConfigRow
          icon={Fingerprint}
          caption={t('tools.nanoid_generator.size')}
          captionHint={t('tools.nanoid_generator.size_hint')}
        >
          <Input
            aria-label={t('tools.nanoid_generator.size_aria')}
            type="number"
            min={1}
            max={256}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="h-7 w-24 text-xs"
          />
        </ConfigRow>
        <ConfigRow
          icon={Fingerprint}
          caption={t('tools.nanoid_generator.alphabet')}
          captionHint={
            alphabetValid
              ? t('tools.nanoid_generator.alphabet_hint')
              : t('tools.nanoid_generator.alphabet_invalid')
          }
        >
          <Input
            aria-label={t('tools.nanoid_generator.alphabet_aria')}
            value={alphabet}
            onChange={(e) => setAlphabet(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="h-7 w-72 text-xs"
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* 左栏:参数「编辑框」(照 QrcodeTool 图片预览面板模式:26px 标题栏 + 内容区) */}
        <ResizablePanel defaultSize="50" minSize="25" className="min-h-0 min-w-0">
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-r"
            data-search-anchor="nanoid_generator:input"
          >
            <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2">
              <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                {t('tools.nanoid_generator.params_title')}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <HeaderAction onClick={() => handleGenerate()} disabled={!alphabetValid}>
                  <Play aria-hidden className="size-3.5" />
                  {t('tools.nanoid_generator.generate')}
                </HeaderAction>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-sm">
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('tools.nanoid_generator.size')}
                  </dt>
                  <dd className="font-medium tabular-nums">{size}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('tools.nanoid_generator.alphabet')}
                  </dt>
                  <dd className="break-all font-medium">{alphabet || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('tools.nanoid_generator.count')}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {Math.min(500, Math.max(1, Math.floor(count) || 1))}
                  </dd>
                </div>
              </dl>
              {!alphabetValid && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
                  data-testid="nanoid-alphabet-error"
                >
                  {t('tools.nanoid_generator.alphabet_invalid')}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        {/* 右栏:输出编辑器 */}
        <ResizablePanel defaultSize="50" minSize="25" className="min-h-0 min-w-0">
          <CodeEditor
            title="NanoID"
            language="plaintext"
            readOnly
            value={output}
            className="h-full rounded-none border-0 border-l"
            data-testid="output"
            searchAnchor="nanoid_generator:output"
            actions={output ? <CopyAction text={output} testId="copy-nanoid" /> : undefined}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

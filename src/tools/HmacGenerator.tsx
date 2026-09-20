/**
 * HMAC 生成器 —— 消息 + 密钥 → HMAC 摘要(SHA-1/224/256/384/512)。
 * 左右分栏(对齐 GzipCodec 基准):左消息输入编辑器,右摘要只读编辑器;
 * 密钥/算法/编码收进顶部配置区。仅在本机内存中计算,不落盘不上传。
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash, KeyRound } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SendToMenu } from '@/components/send-to-menu';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import {
  HMAC_ALGORITHMS,
  HMAC_ENCODINGS,
  computeHmac,
  type HmacAlgorithm,
  type HmacEncoding,
} from './hmac-utils';
import type { ToolProps } from './registry';

export function HmacGenerator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [secret, setSecret] = useState('');
  const [algorithm, setAlgorithm] = useState<HmacAlgorithm>('SHA-256');
  const [encoding, setEncoding] = useState<HmacEncoding>('hex');

  // 异步计算:输入任一变化即重算;错误(理论上仅空密钥外的异常)落入错误态
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = message !== '' && secret !== '';

  // 输入不全时结果视为不存在(不依赖 effect 同步清空,避免级联渲染)
  const shownResult = ready ? result : null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void computeHmac(message, secret, algorithm, encoding)
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setResult(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, message, secret, algorithm, encoding]);

  useToolShortcutActions(toolId, {
    clearInput: () => {
      setMessage('');
      setSecret('');
      setResult(null);
      setError(null);
    },
    copyOutput: shownResult ? () => navigator.clipboard.writeText(shownResult) : undefined,
  });

  const output = useMemo(
    () =>
      error ? t('tools.hmac_generator.error_compute', { message: error }) : (shownResult ?? ''),
    [error, shownResult, t],
  );

  return (
    // 外层 shell 卡片(对齐 GzipCodec 基准):配置区在上,左右分栏收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="hmac-generator"
    >
      <ConfigSection
        headerHint={t('tools.hmac_generator.section_hint')}
        searchAnchor="hmac_generator:config"
      >
        <ConfigRow
          icon={KeyRound}
          caption={t('tools.hmac_generator.secret')}
          captionHint={t('tools.hmac_generator.privacy_hint')}
        >
          <Input
            aria-label={t('tools.hmac_generator.secret')}
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="h-7 w-72 text-xs"
          />
        </ConfigRow>
        <ConfigRow icon={Hash} caption={t('tools.hmac_generator.algorithm')}>
          <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as HmacAlgorithm)}>
            <SelectTrigger
              aria-label={t('tools.hmac_generator.algorithm')}
              className="h-7 w-32 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HMAC_ALGORITHMS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={Hash} caption={t('tools.hmac_generator.caption_encoding')}>
          <Select value={encoding} onValueChange={(v) => setEncoding(v as HmacEncoding)}>
            <SelectTrigger
              aria-label={t('tools.hmac_generator.encoding')}
              className="h-7 w-32 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HMAC_ENCODINGS.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.hmac_generator.message')}
            language="plaintext"
            value={message}
            onChange={setMessage}
            placeholder={t('tools.hmac_generator.message_placeholder')}
            data-testid="hmac-message"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="hmac_generator:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.hmac_generator.output_title')}
            language="plaintext"
            readOnly
            value={output}
            data-testid="hmac-output"
            className="h-full rounded-none border-0 border-l"
            searchAnchor="hmac_generator:output"
            actions={
              <>
                {shownResult && <CopyAction text={shownResult} testId="copy-hmac" />}
                {shownResult && (
                  <SendToMenu text={shownResult} currentToolId={toolId} testId="hmac-send" />
                )}
              </>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

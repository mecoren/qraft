/**
 * AES 加解密 —— AES-256-GCM 文本双向加解密。
 * 左右分栏(对齐 GzipCodec 基准):左输入(加密=明文/解密=密文)、右输出
 * (加密=密文/解密=明文);密钥来源与口令收进顶部配置区。密钥二选一:
 * 口令(PBKDF2-SHA256 100k 迭代派生,盐随机且随文输出)或 256-bit 原始密钥
 * (hex 64 / base64 44 字符)。输出自包含密信封,同密钥直接解回;
 * 仅在本机内存中计算,不落盘不上传。
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, KeyRound, Lock, Unlock } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SendToMenu } from '@/components/send-to-menu';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { aesDecrypt, aesEncrypt } from './aes-utils';
import type { ToolProps } from './registry';

export function AesCrypto({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [encryptMode, setEncryptMode] = useState(true);
  const [usePassphrase, setUsePassphrase] = useState(true);
  const [keyInput, setKeyInput] = useState('');
  const [text, setText] = useState('');

  // 异步结果与错误(与 HmacGenerator 同模式)
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = text.trim() !== '' && keyInput !== '';

  // 输入不全时结果视为不存在(不依赖 effect 同步清空,避免级联渲染)
  const shownResult = ready ? result : null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const compute = encryptMode
      ? aesEncrypt(text, keyInput, usePassphrase)
      : aesDecrypt(text, keyInput, usePassphrase);
    void compute
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setResult(null);
          // 口令/密钥错误时 WebCrypto 抛 OperationError;统一本地化文案
          setError(
            e instanceof Error && /OperationError|malformed/i.test(e.name + e.message)
              ? t('tools.aes_crypto.error_key_mismatch')
              : e instanceof Error && e.message
                ? t('tools.aes_crypto.error_generic', { message: e.message })
                : String(e),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, text, keyInput, encryptMode, usePassphrase, t]);

  useToolShortcutActions(toolId, {
    clearInput: () => {
      setText('');
      setKeyInput('');
      setResult(null);
      setError(null);
    },
    copyOutput: shownResult ? () => navigator.clipboard.writeText(shownResult) : undefined,
  });

  const output = useMemo(() => (error ? '' : (shownResult ?? '')), [error, shownResult]);

  return (
    // 外层 shell 卡片(对齐 GzipCodec 基准):配置区在上,左右分栏收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="aes-crypto"
    >
      <ConfigSection title="" searchAnchor="aes_crypto:config">
        <ConfigRow
          icon={ArrowLeftRight}
          label={t('tools.aes_crypto.label_direction')}
          hint={t('tools.aes_crypto.hint_direction')}
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {encryptMode ? (
              <Lock aria-hidden className="size-3.5" />
            ) : (
              <Unlock aria-hidden className="size-3.5" />
            )}
            {encryptMode ? t('tools.aes_crypto.mode_encrypt') : t('tools.aes_crypto.mode_decrypt')}
          </span>
          <Switch
            data-testid="aes-direction-switch"
            aria-label={t('tools.aes_crypto.label_direction')}
            checked={encryptMode}
            onCheckedChange={setEncryptMode}
          />
        </ConfigRow>
        <ConfigRow
          icon={KeyRound}
          label={t('tools.aes_crypto.label_key_source')}
          hint={t('tools.aes_crypto.hint_key_source')}
        >
          <span className="text-xs text-muted-foreground">
            {usePassphrase
              ? t('tools.aes_crypto.key_source_passphrase')
              : t('tools.aes_crypto.key_source_raw')}
          </span>
          <Switch
            aria-label={t('tools.aes_crypto.label_key_source')}
            checked={usePassphrase}
            onCheckedChange={setUsePassphrase}
          />
        </ConfigRow>
        <ConfigRow
          icon={KeyRound}
          label={usePassphrase ? t('tools.aes_crypto.passphrase') : t('tools.aes_crypto.raw_key')}
          hint={
            usePassphrase
              ? t('tools.aes_crypto.passphrase_hint')
              : t('tools.aes_crypto.raw_key_hint')
          }
        >
          <Input
            aria-label={
              usePassphrase ? t('tools.aes_crypto.passphrase') : t('tools.aes_crypto.raw_key')
            }
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={
              encryptMode ? t('tools.aes_crypto.plaintext') : t('tools.aes_crypto.ciphertext_input')
            }
            language="plaintext"
            value={text}
            onChange={setText}
            placeholder={
              encryptMode
                ? t('tools.aes_crypto.plaintext_placeholder')
                : t('tools.aes_crypto.ciphertext_placeholder')
            }
            data-testid="aes-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="aes_crypto:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          {error ? (
            <div
              role="alert"
              className="flex h-full items-center justify-center p-4 text-sm text-destructive"
              data-testid="aes-error"
            >
              {error}
            </div>
          ) : (
            <CodeEditor
              title={
                encryptMode
                  ? t('tools.aes_crypto.ciphertext_output')
                  : t('tools.aes_crypto.plaintext_output')
              }
              language="plaintext"
              readOnly
              value={output}
              data-testid="aes-output"
              className="h-full rounded-none border-0 border-l"
              searchAnchor="aes_crypto:output"
              actions={
                <>
                  {shownResult && <CopyAction text={shownResult} testId="copy-aes" />}
                  {shownResult && (
                    <SendToMenu text={shownResult} currentToolId={toolId} testId="aes-send" />
                  )}
                </>
              }
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

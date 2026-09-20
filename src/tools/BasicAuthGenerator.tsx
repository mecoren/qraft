/**
 * Basic Auth 生成器/解码器 —— user:password ↔ Authorization 头,双向。
 * 仅在本机内存中计算,不落盘不上传;凭据为空时不产出结果。
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, KeyRound } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { SendToMenu } from '@/components/send-to-menu';
import { decodeBasicAuth, encodeBasicAuth } from './basic-auth-utils';
import type { ToolProps } from './registry';

export function BasicAuthGenerator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [encodeMode, setEncodeMode] = useState(true);
  // 解码模式输入的 Authorization 头 / 裸 base64
  const [encodedInput, setEncodedInput] = useState('');

  // 编码:任一凭据为空则不产出(空串头没有发送意义)
  const header = useMemo(
    () => (user === '' || password === '' ? '' : encodeBasicAuth(user, password)),
    [user, password],
  );

  // 解码:解析失败给出本地化错误
  const decoded = useMemo(() => {
    if (encodeMode || !encodedInput.trim()) return null;
    try {
      const r = decodeBasicAuth(encodedInput);
      return { ...r, error: null as string | null };
    } catch (e) {
      return {
        user: '',
        password: '',
        error: t('tools.basic_auth_generator.error_decode', {
          message: e instanceof Error ? e.message : String(e),
        }),
      };
    }
  }, [encodeMode, encodedInput, t]);

  useToolShortcutActions(toolId, {
    clearInput: () => {
      setUser('');
      setPassword('');
      setEncodedInput('');
    },
    copyOutput: header ? () => void copyTextWithFeedback(header) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与输出编辑器收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="basic-auth-generator"
    >
      <ConfigSection
        headerHint={t('tools.basic_auth_generator.section_hint')}
        searchAnchor="basic_auth_generator:config"
      >
        <ConfigRow
          icon={ArrowLeftRight}
          caption={t('tools.basic_auth_generator.label_direction')}
          captionHint={t('tools.basic_auth_generator.hint_direction')}
        >
          <Tabs
            value={encodeMode ? 'encode' : 'decode'}
            onValueChange={(v) => setEncodeMode(v === 'encode')}
          >
            {/* 二选一方向用分段控件而非开关:开关只能表达布尔态,读不出「左侧=生成、
                右侧=解码」的方向语义,且同一形态在工具间必须一致(Base64Codec 基准) */}
            <TabsList className="h-7 w-fit">
              <TabsTrigger
                value="encode"
                data-testid="dir-encode"
                className="gap-1 px-2 py-0.5 text-xs"
              >
                <ArrowUpFromLine aria-hidden className="size-3.5" />
                {t('tools.basic_auth_generator.mode_encode')}
              </TabsTrigger>
              <TabsTrigger
                value="decode"
                data-testid="dir-decode"
                className="gap-1 px-2 py-0.5 text-xs"
              >
                <ArrowDownToLine aria-hidden className="size-3.5" />
                {t('tools.basic_auth_generator.mode_decode')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </ConfigRow>
      </ConfigSection>

      {encodeMode ? (
        <>
          <ConfigSection title="" searchAnchor="basic_auth_generator:fields">
            <ConfigRow icon={KeyRound} caption={t('tools.basic_auth_generator.username')}>
              <Input
                aria-label={t('tools.basic_auth_generator.username')}
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-7 w-72 text-xs"
              />
            </ConfigRow>
            <ConfigRow
              icon={KeyRound}
              caption={t('tools.basic_auth_generator.password')}
              captionHint={t('tools.basic_auth_generator.privacy_hint')}
            >
              <Input
                aria-label={t('tools.basic_auth_generator.password')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-7 w-72 text-xs"
              />
            </ConfigRow>
          </ConfigSection>
          <CodeEditor
            title={t('tools.basic_auth_generator.output_title')}
            language="plaintext"
            readOnly
            value={header}
            className="min-h-0 flex-1 rounded-none border-0"
            data-testid="auth-output"
            searchAnchor="basic_auth_generator:output"
            actions={
              <>
                {header && <CopyAction text={header} testId="copy-auth" />}
                {header && <SendToMenu text={header} currentToolId={toolId} testId="output-send" />}
              </>
            }
          />
        </>
      ) : (
        <>
          <ConfigSection title="" searchAnchor="basic_auth_generator:decode_input">
            <ConfigRow
              icon={KeyRound}
              caption={t('tools.basic_auth_generator.caption_encoded_input')}
              captionHint={t('tools.basic_auth_generator.encoded_input_hint')}
            >
              <Input
                aria-label={t('tools.basic_auth_generator.encoded_input')}
                value={encodedInput}
                onChange={(e) => setEncodedInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-7 w-72 text-xs"
              />
            </ConfigRow>
          </ConfigSection>
          {decoded?.error ? (
            <div
              role="alert"
              className="m-3 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
              data-testid="auth-decode-error"
            >
              {decoded.error}
            </div>
          ) : (
            <ConfigSection title="" searchAnchor="basic_auth_generator:decode_result">
              <ConfigRow icon={KeyRound} caption={t('tools.basic_auth_generator.username')}>
                <span
                  className="max-w-72 truncate font-mono text-body-sm"
                  data-testid="auth-decoded-user"
                >
                  {decoded?.user || '-'}
                </span>
              </ConfigRow>
              <ConfigRow icon={KeyRound} caption={t('tools.basic_auth_generator.password')}>
                <span
                  className="max-w-72 truncate font-mono text-body-sm"
                  data-testid="auth-decoded-password"
                >
                  {decoded?.password || '-'}
                </span>
              </ConfigRow>
            </ConfigSection>
          )}
        </>
      )}
    </div>
  );
}

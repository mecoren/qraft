/**
 * Basic Auth 生成器 —— user:password → Authorization 请求头。
 * 仅在本机内存中计算,不落盘不上传;凭据为空时不产出结果。
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { SendToMenu } from '@/components/send-to-menu';
import { encodeBasicAuth } from './basic-auth-utils';
import type { ToolProps } from './registry';

export function BasicAuthGenerator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  // 任一凭据为空则不产出(空串头没有发送意义)
  const header = useMemo(
    () => (user === '' || password === '' ? '' : encodeBasicAuth(user, password)),
    [user, password],
  );

  useToolShortcutActions(toolId, {
    clearInput: () => {
      setUser('');
      setPassword('');
    },
    copyOutput: header ? () => void copyTextWithFeedback(header) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):配置区与输出编辑器收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="basic-auth-generator"
    >
      <ConfigSection title="" searchAnchor="basic_auth_generator:config">
        <ConfigRow icon={KeyRound} label={t('tools.basic_auth_generator.username')}>
          <Input
            aria-label={t('tools.basic_auth_generator.username')}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </ConfigRow>
        <ConfigRow
          icon={KeyRound}
          label={t('tools.basic_auth_generator.password')}
          hint={t('tools.basic_auth_generator.privacy_hint')}
        >
          <Input
            aria-label={t('tools.basic_auth_generator.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            spellCheck={false}
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
    </div>
  );
}

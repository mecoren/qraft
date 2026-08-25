/**
 * Basic Auth 生成器 —— user:password → Authorization 请求头。
 * 仅在本机内存中计算,不落盘不上传;凭据为空时不产出结果。
 */
import { useMemo, useState, type JSX } from 'react';
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
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="basic-auth-generator">
      <ConfigSection title="" searchAnchor="basic_auth_generator:config">
        <ConfigRow icon={KeyRound} label="用户名">
          <Input
            aria-label="用户名"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </ConfigRow>
        <ConfigRow icon={KeyRound} label="密码" hint="仅在本机内存中计算,不落盘不上传">
          <Input
            aria-label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </ConfigRow>
      </ConfigSection>
      <CodeEditor
        title="Authorization 头"
        language="plaintext"
        readOnly
        value={header}
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

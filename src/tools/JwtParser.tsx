import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeCommand, CommandError } from '@/lib/ipc';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

// JwtParser 输出 extra 字段结构,镜像 Rust 端 jwt_parser.rs 的 extra Map
interface JwtExtra {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  expires_at?: string;
}

export function JwtParser({ toolId }: ToolProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [extra, setExtra] = useState<JwtExtra | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleParse() {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text, params: {} },
      });
      setExtra(result.extra as JwtExtra | null);
    } catch (e) {
      if (e instanceof CommandError) {
        setError(`${e.code}: ${e.message}`);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="flex flex-col gap-2">
        <Label>{t('tools.jwt_parser.token_label')}</Label>
        <CodeEditor
          placeholder={t('tools.jwt_parser.token_placeholder')}
          value={text}
          onChange={setText}
          language="plaintext"
          className="flex-1"
          data-testid="input"
          searchAnchor="jwt_parser:input"
        />
        <Button onClick={handleParse} disabled={loading || !text}>
          {loading ? t('tools.jwt_parser.parsing') : t('tools.jwt_parser.parse')}
        </Button>
      </div>

      <ScrollArea className="min-h-0 rounded-md border border-border">
        <div className="flex flex-col gap-2 p-3">
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : extra ? (
            <>
              <div className="flex flex-col gap-1">
                <Label>{t('tools.jwt_parser.header')}</Label>
                <CodeEditor
                  readOnly
                  value={JSON.stringify(extra.header, null, 2)}
                  language="json"
                  data-testid="header"
                  searchAnchor="jwt_parser:header"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t('tools.jwt_parser.payload')}</Label>
                <CodeEditor
                  readOnly
                  value={JSON.stringify(extra.payload, null, 2)}
                  language="json"
                  data-testid="payload"
                  searchAnchor="jwt_parser:payload"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t('tools.jwt_parser.signature')}</Label>
                <CodeEditor
                  readOnly
                  value={extra.signature}
                  language="plaintext"
                  data-testid="signature"
                  searchAnchor="jwt_parser:signature"
                />
              </div>
              {extra.expires_at && (
                <div className="text-xs text-muted-foreground">
                  {t('tools.jwt_parser.expires_at', { time: extra.expires_at })}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {t('tools.jwt_parser.empty_state')}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

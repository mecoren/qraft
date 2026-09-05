/**
 * JWT 编码器/解码器 —— 纯前端实时解析(对标 jwt.io)
 *
 * 输入即解析:防抖后本地解码 header / payload / signature;
 * 标准 claims(iat/nbf/exp)可读化并给出过期状态徽章。
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Clock, ShieldCheck, ShieldX } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import { getLocale } from '@/i18n';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { parseJwt, type ParsedJwt } from './jwt-utils';
import type { ToolProps } from './registry';

// 输入防抖:粘贴完整 token 后立即解析,打字中途避免逐键解码
const PARSE_DEBOUNCE_MS = 200;

function fmtDate(d: Date): string {
  return d.toLocaleString(getLocale(), { hour12: false });
}

interface ParseState {
  parsed: ParsedJwt | null;
  error: string | null;
}

export function JwtParser({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [state, setState] = useState<ParseState>({ parsed: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const trimmed = text.trim();
      if (!trimmed) {
        setState({ parsed: null, error: null });
        return;
      }
      try {
        const parsed = parseJwt(trimmed);
        if (!cancelled) setState({ parsed, error: null });
      } catch (e) {
        if (!cancelled) {
          setState({
            parsed: null,
            error: t('tools.jwt_parser.error_parse', {
              message: e instanceof Error ? e.message : String(e),
            }),
          });
        }
      }
    }, PARSE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, t]);

  const outputs = useMemo(() => {
    if (!state.parsed) return null;
    return {
      header: JSON.stringify(state.parsed.header, null, 2),
      payload: JSON.stringify(state.parsed.payload, null, 2),
      signature: state.parsed.signature,
    };
  }, [state.parsed]);

  useToolShortcutActions(toolId, {
    clearInput: () => setText(''),
    copyOutput: outputs ? () => void copyTextWithFeedback(outputs.payload) : undefined,
  });

  const { meta } = state.parsed ?? {};
  const statusLabel = meta
    ? meta.status === 'valid'
      ? t('tools.jwt_parser.status_valid')
      : meta.status === 'expired'
        ? t('tools.jwt_parser.status_expired')
        : meta.status === 'not_yet_valid'
          ? t('tools.jwt_parser.status_not_yet_valid')
          : null
    : null;

  return (
    // 外层 shell 卡片:左输入 / 右解析结果双栏收进同一卡片(与 Base64 转换器同构)
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="jwt-parser"
    >
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.jwt_parser.token_label')}
            language="plaintext"
            value={text}
            onChange={setText}
            placeholder={t('tools.jwt_parser.token_placeholder')}
            data-testid="jwt-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="jwt_parser:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <div className="flex h-full flex-col border-l" data-testid="jwt-result">
            {state.error ? (
              <div
                role="alert"
                className="m-3 rounded-md border border-destructive bg-destructive/10 p-3 text-sm whitespace-pre-wrap text-destructive"
                data-testid="jwt-error"
              >
                {state.error}
              </div>
            ) : state.parsed && outputs ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
                {/* 状态徽章行:过期/生效状态 + 关键时间 */}
                {statusLabel && (
                  <div className="flex flex-wrap items-center gap-4" data-testid="jwt-status">
                    {meta && meta.status !== 'unknown' && (
                      <span
                        className={`inline-flex items-center gap-1 text-body-sm font-medium ${
                          meta.status === 'valid' ? 'text-diff-add-fg' : 'text-destructive'
                        }`}
                      >
                        {meta.status === 'valid' ? (
                          <ShieldCheck aria-hidden className="size-4" />
                        ) : (
                          <ShieldX aria-hidden className="size-4" />
                        )}
                        {statusLabel}
                      </span>
                    )}
                    {meta?.issuedAt && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock aria-hidden className="size-3.5" />
                        {t('tools.jwt_parser.issued_at', { time: fmtDate(meta.issuedAt) })}
                      </span>
                    )}
                    {meta?.expiresAt && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock aria-hidden className="size-3.5" />
                        {t('tools.jwt_parser.expires_at', { time: fmtDate(meta.expiresAt) })}
                      </span>
                    )}
                  </div>
                )}

                <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_1fr] gap-3">
                  <div className="flex min-h-0 flex-col gap-1">
                    <span className="text-body-sm font-semibold">
                      {t('tools.jwt_parser.header')}
                    </span>
                    <CodeEditor
                      readOnly
                      value={outputs.header}
                      language="json"
                      data-testid="jwt-header"
                      className="h-32 rounded-md"
                      searchAnchor="jwt_parser:header"
                      actions={<CopyAction text={outputs.header} testId="copy-header" />}
                    />
                  </div>
                  <div className="flex min-h-0 flex-col gap-1">
                    <span className="text-body-sm font-semibold">
                      {t('tools.jwt_parser.payload')}
                    </span>
                    <CodeEditor
                      readOnly
                      value={outputs.payload}
                      language="json"
                      data-testid="jwt-payload"
                      className="h-40 rounded-md"
                      searchAnchor="jwt_parser:payload"
                      actions={<CopyAction text={outputs.payload} testId="copy-payload" />}
                    />
                  </div>
                  <div className="flex min-h-0 flex-col gap-1">
                    <span className="text-body-sm font-semibold">
                      {t('tools.jwt_parser.signature')}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t('tools.jwt_parser.signature_hint')}
                      </span>
                    </span>
                    <CodeEditor
                      readOnly
                      value={outputs.signature}
                      language="plaintext"
                      data-testid="jwt-signature"
                      className="min-h-0 flex-1 rounded-md"
                      searchAnchor="jwt_parser:signature"
                      actions={<CopyAction text={outputs.signature} testId="copy-signature" />}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <AlertCircle aria-hidden className="size-4" />
                  {t('tools.jwt_parser.empty_state')}
                </span>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

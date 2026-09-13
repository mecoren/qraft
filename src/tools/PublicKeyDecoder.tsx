/**
 * 公钥解析器 —— PEM 公钥/私钥(RSA/EC/Ed25519)结构信息展示
 *
 * 左右分栏:左侧输入 PEM(或 base64 DER),右侧展示算法/位数/指纹等;
 * 纯前端本地解析(ASN.1 全家桶直解),零网络零 IPC,私钥永不出本机。
 */

import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import { useToolHandoff } from '@/hooks/useToolHandoff';
import { describeKey, reportToText, type PublicKeyReport } from './public-key-utils';
import type { ToolProps } from './registry';

const PARSE_DEBOUNCE_MS = 300;

interface ParseState {
  report: PublicKeyReport | null;
  error: string | null;
}

function SectionTitle({ children }: { children: string }): JSX.Element {
  return <h3 className="mb-1 mt-4 text-body-sm font-semibold first:mt-0">{children}</h3>;
}

export function PublicKeyDecoder({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [state, setState] = useState<ParseState>({ report: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const text = input.trim();
      if (!text) {
        setState({ report: null, error: null });
        return;
      }
      void describeKey(text).then(
        (report) => {
          if (!cancelled) setState({ report, error: null });
        },
        (reason: unknown) => {
          if (cancelled) return;
          const detail = reason instanceof Error ? reason.message : String(reason);
          setState({
            report: null,
            error: `${t('tools.public_key_decoder.error_parse_failed')}\n${detail}`,
          });
        },
      );
    }, PARSE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input, t]);

  // Smart Detection / 「发送到…」接收端:预填 PEM 文本
  useToolHandoff(toolId, setInput);

  const copyText = state.report ? reportToText(state.report, (k, v) => `${k}: ${v}`) : null;

  return (
    // 外层 shell 卡片(对齐 CertificateDecoder 基准):配置区 + 横向双栏工作区
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="public-key-decoder"
    >
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.public_key_decoder.title_input')}
            language="plaintext"
            value={input}
            onChange={setInput}
            placeholder={'-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'}
            data-testid="pk-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="public_key_decoder:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          {/* 右侧结果区:标题栏与 CodeEditor 同构(26px),内容独立承载 */}
          <div className="flex h-full flex-col">
            <div className="flex h-[26px] shrink-0 items-center gap-2 border-b border-input px-2">
              <span className="truncate pl-1 text-xs font-medium text-foreground">
                {t('tools.public_key_decoder.title_output')}
              </span>
              {copyText ? <CopyAction text={copyText} testId="pk-copy" /> : null}
            </div>
            <div
              data-testid="pk-output"
              data-search-anchor="public_key_decoder:output"
              className="min-h-0 flex-1 overflow-auto"
            >
              {state.error !== null ? (
                <div
                  role="alert"
                  data-testid="pk-error"
                  className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-body-sm text-destructive"
                >
                  <pre className="whitespace-pre-wrap break-all font-mono text-xs">
                    {state.error}
                  </pre>
                </div>
              ) : state.report ? (
                <div className="flex flex-col gap-4 p-4" data-testid="pk-report">
                  {/* 种类徽章行 */}
                  <div className="flex items-center gap-2" data-testid="pk-kind">
                    <span className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground">
                      <KeyRound className="size-3" aria-hidden />
                      {state.report.kind === 'public'
                        ? t('tools.public_key_decoder.kind_public')
                        : t('tools.public_key_decoder.kind_private')}
                    </span>
                    <span className="rounded-md border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground">
                      {state.report.algorithmName} · {state.report.keySize} bits
                    </span>
                  </div>

                  <section data-testid="pk-section-basic">
                    <SectionTitle>{t('tools.public_key_decoder.section_basic')}</SectionTitle>
                    <div className="space-y-1.5">
                      <Field
                        label={t('tools.public_key_decoder.label_algorithm')}
                        value={state.report.algorithmName}
                      />
                      <Field
                        label={t('tools.public_key_decoder.label_key_size')}
                        value={`${state.report.keySize} bits`}
                      />
                      <Field
                        label={t('tools.public_key_decoder.label_oid')}
                        value={state.report.algorithmOid}
                        mono
                      />
                      <Field
                        label={t('tools.public_key_decoder.label_size')}
                        value={`${state.report.spkiBytes} bytes`}
                      />
                      {state.report.kind === 'private' && (
                        <Field
                          label={t('tools.public_key_decoder.label_has_pub')}
                          value={
                            state.report.hasPublicKeyMaterial
                              ? t('tools.public_key_decoder.value_yes')
                              : t('tools.public_key_decoder.value_no')
                          }
                        />
                      )}
                    </div>
                  </section>

                  {state.report.rsa && (
                    <section data-testid="pk-section-rsa">
                      <SectionTitle>{t('tools.public_key_decoder.section_rsa')}</SectionTitle>
                      <div className="space-y-1.5">
                        <Field
                          label={t('tools.public_key_decoder.label_exponent')}
                          value={String(state.report.rsa.exponent)}
                        />
                        <Field
                          label={t('tools.public_key_decoder.label_modulus')}
                          value={state.report.rsa.modulusHex}
                          mono
                        />
                      </div>
                    </section>
                  )}

                  {state.report.ec && (
                    <section data-testid="pk-section-ec">
                      <SectionTitle>{t('tools.public_key_decoder.section_ec')}</SectionTitle>
                      <div className="space-y-1.5">
                        {state.report.ec.curveName && (
                          <Field
                            label={t('tools.public_key_decoder.label_curve')}
                            value={state.report.ec.curveName}
                          />
                        )}
                        {state.report.ec.pointHex && (
                          <Field
                            label={t('tools.public_key_decoder.label_point')}
                            value={state.report.ec.pointHex}
                            mono
                          />
                        )}
                      </div>
                    </section>
                  )}

                  {state.report.ed25519 && (
                    <section data-testid="pk-section-ed25519">
                      <SectionTitle>{t('tools.public_key_decoder.section_ed25519')}</SectionTitle>
                      <div className="space-y-1.5">
                        <Field
                          label={t('tools.public_key_decoder.label_raw')}
                          value={state.report.ed25519.rawHex}
                          mono
                        />
                      </div>
                    </section>
                  )}

                  <section data-testid="pk-section-fingerprint">
                    <SectionTitle>{t('tools.public_key_decoder.section_fingerprint')}</SectionTitle>
                    <div className="space-y-1.5">
                      <Field label="SHA-256" value={state.report.fingerprintSha256} mono />
                    </div>
                  </section>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <KeyRound className="size-8 opacity-50" aria-hidden />
                  <p className="text-body-sm">{t('tools.public_key_decoder.empty_hint')}</p>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/** 字段行:固定宽标签 + 可换行值(长 hex 用 mono) */
function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-start gap-2" data-field-value={label}>
      <span className="w-40 shrink-0 select-none text-xs text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 flex-1 text-body-sm break-all ${mono ? 'font-mono text-xs' : 'break-words'}`}
      >
        {value}
      </span>
    </div>
  );
}

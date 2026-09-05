/**
 * 证书解码 —— 解析 PEM / Base64 DER / HEX 格式 X.509 证书
 *
 * 输出:结构化卡片(基本信息 / 有效期 / 签名与公钥 / 指纹 / 扩展),
 * 另附 ASN.1 全量文本(对标 openssl x509 -text),支持一键复制。
 *
 * 注意:reflect-metadata polyfill 由 main.tsx 入口最顶部统一引入(@peculiar/x509
 * 基于 tsyringe 装饰器,模块初始化时即依赖 Reflect.metadata)。不可在本懒加载
 * chunk 内引入 —— 生产构建代码分割后,x509 共享 chunk 可能先于本 chunk 执行,
 * 导致 "tsyringe requires a reflect polyfill" 渲染错误(安装版页面空白根因)。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ShieldCheck, ShieldX, Clock } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import { getLocale } from '@/i18n';
import {
  describeCertificate,
  normalizeCertInput,
  reportToText,
  type CertificateReport,
  type CertValidityStatus,
} from './certificate-utils';
import type { ToolProps } from './registry';

function fmtDate(d: Date): string {
  return d.toLocaleString(getLocale(), { hour12: false });
}

// 输入防抖:证书解析开销较大(ASN.1 全量解码 + 双哈希指纹),逐键触发无意义
const PARSE_DEBOUNCE_MS = 300;

interface ParsedState {
  report: CertificateReport | null;
  selfSigned: boolean | null;
  error: string | null;
  /** 剩余有效天数(报告解析时快照,避免 render 中调用 Date.now) */
  daysLeft: number | null;
}

function StatusBadge({ status }: { status: CertValidityStatus }): JSX.Element {
  const { t } = useTranslation();
  const label =
    status === 'valid'
      ? t('tools.certificate_decoder.status_valid')
      : status === 'not_yet_valid'
        ? t('tools.certificate_decoder.status_not_yet_valid')
        : t('tools.certificate_decoder.status_expired');
  const Icon = status === 'valid' ? ShieldCheck : ShieldX;
  const tone = status === 'valid' ? 'text-diff-add-fg' : 'text-destructive';
  return (
    <span className={`inline-flex items-center gap-1 text-body-sm font-medium ${tone}`}>
      <Icon aria-hidden className="size-4" />
      {label}
    </span>
  );
}

/** 键值行:标签固定宽、值可选中复制,长值(主题/指纹)自动折行 */
function Field({
  label,
  value,
  wrap,
}: {
  label: string;
  value: string;
  wrap?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-start gap-4 py-1">
      <span className="w-40 shrink-0 text-xs text-muted-foreground select-none">{label}</span>
      <span
        className={`min-w-0 flex-1 text-body-sm ${wrap ? 'break-all' : 'break-words'}`}
        data-field-value={label}
      >
        {value}
      </span>
    </div>
  );
}

/** 分节标题 */
function SectionTitle({ children }: { children: string }): JSX.Element {
  return <h3 className="mb-1 mt-4 text-body-sm font-semibold first:mt-0">{children}</h3>;
}

export function CertificateDecoder(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [state, setState] = useState<ParsedState>({
    report: null,
    selfSigned: null,
    error: null,
    daysLeft: null,
  });

  useEffect(() => {
    let cancelled = false;
    // 防抖:停止输入 300ms 后再解析,避免逐键触发全量 ASN.1 解码;
    // 统一走定时器路径,同时消除空输入分支在 effect 中同步 setState 的级联渲染
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const normalized = normalizeCertInput(input);
      if (!normalized) {
        setState({ report: null, selfSigned: null, error: null, daysLeft: null });
        return;
      }
      void describeCertificate(input).then(
        (report) => {
          if (cancelled) return;
          // 剩余天数在解析回调中快照,render 保持纯净
          const daysLeft = Math.max(
            0,
            Math.ceil((report.notAfter.getTime() - Date.now()) / 86_400_000),
          );
          setState({ report, selfSigned: null, error: null, daysLeft });
        },
        (reason: unknown) => {
          if (cancelled) return;
          // 附加原始错误详情(如 "Too few bytes to read ASN.1 Integer"),
          // 便于定位是编码问题还是证书结构损坏
          const detail = reason instanceof Error ? reason.message : String(reason);
          setState({
            report: null,
            selfSigned: null,
            daysLeft: null,
            error: `${t('tools.certificate_decoder.error_parse_failed')}\n${detail}`,
          });
        },
      );
    }, PARSE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input, t]);

  // 自签名检测:与主解析解耦,先渲染核心字段再补自签名徽章
  useEffect(() => {
    if (!state.report) return;
    let cancelled = false;
    const snapshot = input;
    void (async () => {
      const { X509Certificate } = await import('@peculiar/x509');
      try {
        const selfSigned = await new X509Certificate(normalizeCertInput(snapshot)).isSelfSigned();
        if (!cancelled) setState((s) => ({ ...s, selfSigned }));
      } catch {
        if (!cancelled) setState((s) => ({ ...s, selfSigned: null }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // 仅在报告变化时重测自签名;input 快照在回调内读取
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [state.report]);

  // 复制用纯文本报告(本地化标签)
  const copyText = state.report
    ? reportToText(
        state.report,
        (key, value) => `${key}: ${value}`,
        {
          basic: t('tools.certificate_decoder.section_basic'),
          validity: t('tools.certificate_decoder.section_validity'),
          signature: t('tools.certificate_decoder.section_signature'),
          fingerprints: t('tools.certificate_decoder.section_fingerprints'),
          extensions: t('tools.certificate_decoder.section_extensions'),
        },
        (s) =>
          s === 'valid'
            ? t('tools.certificate_decoder.status_valid')
            : s === 'not_yet_valid'
              ? t('tools.certificate_decoder.status_not_yet_valid')
              : t('tools.certificate_decoder.status_expired'),
        state.selfSigned ?? undefined,
      )
    : '';

  return (
    // 外层 shell 卡片:无配置区,左右双栏面板组直接填充(与 Base64 转换器同构)
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="certificate-decoder"
    >
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <CodeEditor
            title={t('tools.certificate_decoder.title_input')}
            language="plaintext"
            value={input}
            onChange={setInput}
            placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
            data-testid="cert-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="certificate_decoder:input"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="20" className="min-h-0 min-w-0">
          <div className="flex h-full flex-col border-l">
            {/* 输出工具栏:标题 + 复制(输出区不再走 CodeEditor,独立承载) */}
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-body-sm font-medium">
                {t('tools.certificate_decoder.title_output')}
              </span>
              {copyText ? <CopyAction text={copyText} testId="cert-copy" /> : null}
            </div>
            <div
              className="min-h-0 flex-1 overflow-auto"
              data-testid="cert-output"
              data-search-anchor="certificate_decoder:output"
            >
              {state.error ? (
                <div
                  role="alert"
                  className="m-3 rounded-md border border-destructive bg-destructive/10 p-3 text-sm whitespace-pre-wrap text-destructive"
                  data-testid="cert-error"
                >
                  {state.error}
                </div>
              ) : state.report ? (
                <div className="flex flex-col gap-4 p-4">
                  {/* 状态徽章行:有效期 + 自签名 + 剩余天数 */}
                  <div className="flex flex-wrap items-center gap-4" data-testid="cert-status">
                    <StatusBadge status={state.report.validityStatus} />
                    {state.selfSigned !== null && (
                      <span className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
                        <ShieldCheck aria-hidden className="size-4" />
                        {t('tools.certificate_decoder.field_self_signed', {
                          value: state.selfSigned
                            ? t('tools.certificate_decoder.value_yes')
                            : t('tools.certificate_decoder.value_no'),
                        })}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
                      <Clock aria-hidden className="size-4" />
                      {t('tools.certificate_decoder.field_days_left', {
                        days: state.daysLeft ?? 0,
                      })}
                    </span>
                  </div>

                  <section data-testid="cert-section-basic">
                    <SectionTitle>{t('tools.certificate_decoder.section_basic')}</SectionTitle>
                    <Field
                      label={t('tools.certificate_decoder.label_subject')}
                      value={state.report.subject}
                      wrap
                    />
                    <Field
                      label={t('tools.certificate_decoder.label_issuer')}
                      value={state.report.issuer}
                      wrap
                    />
                    <Field
                      label={t('tools.certificate_decoder.label_serial')}
                      value={state.report.serialNumber}
                      wrap
                    />
                    <Field
                      label={t('tools.certificate_decoder.label_version')}
                      value={state.report.version}
                    />
                  </section>

                  <section data-testid="cert-section-validity">
                    <SectionTitle>{t('tools.certificate_decoder.section_validity')}</SectionTitle>
                    <Field
                      label={t('tools.certificate_decoder.label_not_before')}
                      value={fmtDate(state.report.notBefore)}
                    />
                    <Field
                      label={t('tools.certificate_decoder.label_not_after')}
                      value={fmtDate(state.report.notAfter)}
                    />
                  </section>

                  <section data-testid="cert-section-signature">
                    <SectionTitle>{t('tools.certificate_decoder.section_signature')}</SectionTitle>
                    <Field
                      label={t('tools.certificate_decoder.label_signature_algorithm')}
                      value={state.report.signatureAlgorithm}
                    />
                    <Field
                      label={t('tools.certificate_decoder.label_public_key_algorithm')}
                      value={state.report.publicKeyAlgorithm}
                    />
                  </section>

                  <section data-testid="cert-section-fingerprints">
                    <SectionTitle>
                      {t('tools.certificate_decoder.section_fingerprints')}
                    </SectionTitle>
                    <Field label="SHA-1" value={state.report.sha1} wrap />
                    <Field label="SHA-256" value={state.report.sha256} wrap />
                  </section>

                  {state.report.extensions.length > 0 && (
                    <section data-testid="cert-section-extensions">
                      <SectionTitle>
                        {t('tools.certificate_decoder.section_extensions')}
                      </SectionTitle>
                      <ul className="space-y-1">
                        {state.report.extensions.map((ext) => (
                          <li
                            key={ext.type}
                            className="flex items-start gap-2 text-body-sm"
                            data-testid="cert-extension"
                          >
                            <span className="min-w-0 break-all">
                              <span className="font-medium">{ext.type}</span>
                              {ext.critical && (
                                <span className="ml-1 text-destructive">
                                  {t('tools.certificate_decoder.extension_critical')}
                                </span>
                              )}
                              <span className="text-muted-foreground"> — {ext.summary}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* ASN.1 原始文本:折叠区,对标 openssl -text 全量输出 */}
                  <details className="rounded-md border border-border" data-testid="cert-asn1">
                    <summary className="cursor-pointer px-3 py-2 text-body-sm select-none">
                      {t('tools.certificate_decoder.asn1_details')}
                    </summary>
                    <pre className="max-h-80 overflow-auto border-t border-border px-3 py-2 text-xs whitespace-pre-wrap">
                      {state.report.asn1Text}
                    </pre>
                  </details>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <AlertCircle aria-hidden className="size-4" />
                    {t('tools.certificate_decoder.empty_hint')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * 证书解码 —— 解析 PEM / Base64 DER 格式 X.509 证书
 *
 * 输出:主题、颁发者、有效期、序列号、指纹(SHA-1/SHA-256)、公钥算法、扩展等。
 */

// reflect-metadata 是 @peculiar/x509 依赖注入的运行时前提(必须先于其加载)。
// 全仓唯一消费方是本工具(懒加载 chunk),因此在此引入而非 main.tsx,
// 避免把 ~100KB 的 polyfill 拖进首屏依赖图
import 'reflect-metadata';
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { X509Certificate } from '@peculiar/x509';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import { getLocale, t } from '@/i18n';
import type { ToolProps } from './registry';

function hex(buffer: ArrayBuffer, sep = ':'): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(sep);
}

function fmtDate(d: Date): string {
  return d.toLocaleString(getLocale(), { hour12: false });
}

export async function describeCertificate(input: string): Promise<string> {
  const cert = new X509Certificate(input.trim());
  const sha1 = await cert.getThumbprint('SHA-1');
  const sha256 = await cert.getThumbprint('SHA-256');
  const now = new Date();
  const valid = now >= cert.notBefore && now <= cert.notAfter;

  const lines: string[] = [
    t('tools.certificate_decoder.section_basic'),
    t('tools.certificate_decoder.field_subject', { value: cert.subject }),
    t('tools.certificate_decoder.field_issuer', { value: cert.issuer }),
    t('tools.certificate_decoder.field_serial', { value: cert.serialNumber.toUpperCase() }),
    t('tools.certificate_decoder.field_version'),
    '',
    t('tools.certificate_decoder.section_validity'),
    t('tools.certificate_decoder.field_not_before', { value: fmtDate(cert.notBefore) }),
    t('tools.certificate_decoder.field_not_after', { value: fmtDate(cert.notAfter) }),
    t('tools.certificate_decoder.field_status', {
      value: valid
        ? t('tools.certificate_decoder.status_valid')
        : t('tools.certificate_decoder.status_inactive'),
    }),
    '',
    t('tools.certificate_decoder.section_signature'),
    t('tools.certificate_decoder.field_signature_algorithm', {
      name: cert.signatureAlgorithm.name,
      hash: cert.signatureAlgorithm.hash?.name ?? '-',
    }),
    t('tools.certificate_decoder.field_public_key_algorithm', {
      value: cert.publicKey.algorithm.name,
    }),
    '',
    t('tools.certificate_decoder.section_fingerprints'),
    `SHA-1: ${hex(sha1)}`,
    `SHA-256: ${hex(sha256)}`,
  ];

  if (cert.extensions.length > 0) {
    lines.push('', t('tools.certificate_decoder.section_extensions'));
    for (const ext of cert.extensions) {
      lines.push(
        t('tools.certificate_decoder.extension_line', {
          type: ext.type,
          critical: ext.critical ? t('tools.certificate_decoder.extension_critical') : '',
        }),
      );
    }
  }
  return lines.join('\n');
}

export function CertificateDecoder(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  useEffect(() => {
    let cancelled = false;
    // 空输入也走 promise 链,避免在 effect 中同步 setState 触发级联渲染
    const trimmed = input.trim();
    if (!trimmed) {
      void Promise.resolve().then(() => {
        if (!cancelled) setOutput('');
      });
      return;
    }
    void describeCertificate(input).then(
      (text) => {
        if (!cancelled) setOutput(text);
      },
      () => {
        if (!cancelled) setOutput(t('tools.certificate_decoder.error_parse_failed'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [input, t]);

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="min-h-0 flex-1"
      data-testid="certificate-decoder"
    >
      <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
        <CodeEditor
          title={t('tools.certificate_decoder.title_input')}
          language="plaintext"
          value={input}
          onChange={setInput}
          placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
          data-testid="cert-input"
          className="h-full"
          searchAnchor="certificate_decoder:input"
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
        <CodeEditor
          title={t('tools.certificate_decoder.title_output')}
          language="plaintext"
          value={output}
          readOnly
          data-testid="cert-output"
          className="h-full"
          searchAnchor="certificate_decoder:output"
          actions={<CopyAction text={output} testId="cert-copy" />}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * 证书解码 —— 解析 PEM / Base64 DER 格式 X.509 证书
 *
 * 输出:主题、颁发者、有效期、序列号、指纹(SHA-1/SHA-256)、公钥算法、扩展等。
 */

import { useEffect, useState, type JSX } from 'react';
import { X509Certificate } from '@peculiar/x509';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CopyAction } from '@/components/copy-action';
import type { ToolProps } from './registry';

function hex(buffer: ArrayBuffer, sep = ':'): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(sep);
}

function fmtDate(d: Date): string {
  return d.toLocaleString('zh-CN', { hour12: false });
}

export async function describeCertificate(input: string): Promise<string> {
  const cert = new X509Certificate(input.trim());
  const sha1 = await cert.getThumbprint('SHA-1');
  const sha256 = await cert.getThumbprint('SHA-256');
  const now = new Date();
  const valid = now >= cert.notBefore && now <= cert.notAfter;

  const lines: string[] = [
    '[基本信息]',
    `主题 (Subject): ${cert.subject}`,
    `颁发者 (Issuer): ${cert.issuer}`,
    `序列号: ${cert.serialNumber.toUpperCase()}`,
    `版本: v3`,
    '',
    '[有效期]',
    `生效时间: ${fmtDate(cert.notBefore)}`,
    `过期时间: ${fmtDate(cert.notAfter)}`,
    `当前状态: ${valid ? '有效' : '已过期或尚未生效'}`,
    '',
    '[签名与公钥]',
    `签名算法: ${cert.signatureAlgorithm.name}(${cert.signatureAlgorithm.hash?.name ?? '-'})`,
    `公钥算法: ${cert.publicKey.algorithm.name}`,
    '',
    '[指纹]',
    `SHA-1: ${hex(sha1)}`,
    `SHA-256: ${hex(sha256)}`,
  ];

  if (cert.extensions.length > 0) {
    lines.push('', '[扩展]');
    for (const ext of cert.extensions) {
      lines.push(`${ext.type}${ext.critical ? '(关键)' : ''}`);
    }
  }
  return lines.join('\n');
}

export function CertificateDecoder(_props: ToolProps): JSX.Element {
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
        if (!cancelled) setOutput('解析失败:请输入有效的 PEM 或 Base64 DER 格式证书');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [input]);

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="min-h-0 flex-1"
      data-testid="certificate-decoder"
    >
      <ResizablePanel defaultSize={50} minSize={20} className="min-h-0">
        <CodeEditor
          title="输入证书(PEM / Base64 DER)"
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
          title="解码结果"
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

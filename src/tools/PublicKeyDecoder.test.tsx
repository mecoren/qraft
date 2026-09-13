import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PublicKeyDecoder } from './PublicKeyDecoder';
import {
  describeKey,
  pemToDer,
  detectKeyKind,
  reportToText,
  looksLikeKeyPem,
} from './public-key-utils';

vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <div data-testid={props['data-testid']}>
      <span data-testid={`${props['data-testid']}-text`}>{props.value}</span>
      <textarea aria-label="input" onChange={(e) => props.onChange?.(e.target.value)} />
    </div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

// —— openssl 生成的真实测试密钥夹具(2026-09-13,一次性生成固化;私钥为测试用途) ——
const RSA_PUB_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiF6FMM8G4RwlFmRNwJ3i
+XlXTGdf/lDhychuWqoZmUqkeWeRS0Ctro0jM3xCF/1ApbnV6KZw7YeSAkNpNSE/
+geG9biwwQTSzfvbdCq8C3BgOuH1TjOqXMrRMLi3dBsV1wB6Fm/JILaMMpb+wfPy
Xi3/NIG+Pf2px7oxITINCHyCbLP3guFo74JOBR8ioTmY7CwFzfZaKiIDnxE9e8rR
mb3QHM8z2NH8bS9NulFhHWnMJHvIvY8GQgllpjTTE1L1JFKXuFzTZh8sFeHJpURw
gIaK5V54L8aW8+wHkw1YnhdESiVondk8ckXc4JndnVYhghb79bhpl2mJj6uQ1wYa
owIDAQAB
-----END PUBLIC KEY-----`;

const EC_PUB_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhBNzUK2OuwLj4wzTryn9zJptu0eT
wZ0AzvbAROLtwjzHLLVD6NYw3L6gr/m7XEAmw7iBFXEOqKyK64jgR01zIA==
-----END PUBLIC KEY-----`;

const ED_PUB_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAkDOYhyXKozwMXZybiub5MjIdQ5xHFwFfnkrAA3tguZ0=
-----END PUBLIC KEY-----`;

const RSA_PRIV_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCIXoUwzwbhHCUW
ZE3AneL5eVdMZ1/+UOHJyG5aqhmZSqR5Z5FLQK2ujSMzfEIX/UCludXopnDth5IC
Q2k1IT/6B4b1uLDBBNLN+9t0KrwLcGA64fVOM6pcytEwuLd0GxXXAHoWb8kgtowy
lv7B8/JeLf80gb49/anHujEhMg0IfIJss/eC4Wjvgk4FHyKhOZjsLAXN9loqIgOf
ET17ytGZvdAczzPY0fxtL026UWEdacwke8i9jwZCCWWmNNMTUvUkUpe4XNNmHywV
4cmlRHCAhorlXngvxpbz7AeTDVieF0RKJWid2TxyRdzgmd2dViGCFvv1uGmXaYmP
q5DXBhqjAgMBAAECggEANScmYgpnw4ltWUd6WOgRhqzJnqGydFWBVF23ycYAWVQT
PLDmHH9W0zD29gPqXSBcuNvw6RAq9yJ/AjvVP5y4q5OQgqlc17cyFZCkDqjzh7/i
+kCFlVglAKsbE5MECpDeF+H7NFCZBBOzHKrnHKEhqJzkGsqxZMdBDHTh3m78ToBr
xz5eZWlbpiM6BCDcItLKYGayOnn0tEs5ag8t1dzGqgQBkflsVfkr28lO2B9Odnl3
u1e0Q90bGphGfpF70DpooQY6hvtXNKd3lsBaaj4+GOZjPfbDnYnUHQwz0CJKmoJp
nkVtGBkM8BpPOTtRhNHc92Q+Ht3WfEs3WwA1Jik4YQKBgQC932Ikdogb4cBXkQ0V
riVoR8OW705IE6UD4l8FiQ0JoWl5AY6c+bUj5oiaf2/D9soFNMcAbNRNo86I8KPO
kTZ1MNmUDmTCWTYIYI2j06WTztq709b12PptbQ/TrMSvRJp9NhSyrZMS59bcClqj
BxBD8q0Sw/6/KeH3AjHWTuX7gwKBgQC33OVK73LZzIXBcebsqF4c/2odjT5BIylV
5BsNR8EofxMrCT5Kj+foYDI2FZqefbBGmuNP8ZbjiLwKk0MnrWhw3TDaM7Lswb2y
p/H8/o5wJbPszzcrTq4zY7DVyYKqNqL+hZDesRIS8LKliyddV0mcWKXcWvXHDG/j
vxo66AeaYQKBgQCFxYVixTP92N5nk2VRmgD26GCvzWgstdJz2yAxSS6rU1J5E5TD
mdZ6NaiWmSRIP25znox6CzLEhJ01s7zlA0AH7uPMQRvSJYJBAq2n96xXZ8yJuqVf
ToCZadZVvwpPpZjmkJyiilHtZvPk0VKsO4TFKouvhfDMBBkUqzIrmCjGOwKBgHmc
rj0GbF0LHl15TVizdKyRdErfpZHIBAs/uXTrRSPYCYGpt33x+V6GYi/L0l2KnRHW
WQwDq94MDvSfuwd/d1lPtIRfNbXL4AFPfIvug6BCD+ROmxsWC7sJ8Wk2xCp5wQ3A
orXpQR8t/bvpcrwWhCXZrLs3nuFtpIRrXpof5weBAoGBAJieOCZiHfu3QnngwNSN
pOGvsSl1oKiXHPkxmH4jjH/0rYERTk1Imo4vqpgs1e41HDLPDxn0t7IF7ymGt9Bm
3IWDxi2Y0UtcNArQ3Zz8I3/7g/+FtspFA9J3p/PMiOdzeZOOVjjY9hGCC7oHmH3a
D16tBxAGFfsXtFmtzqbptxmH
-----END PRIVATE KEY-----`;

const EC_PRIV_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg+yw+MESJDE3l8Rex
mzT+yvI/5vL+5S95C6xlpSVcaDihRANCAASEE3NQrY67AuPjDNOvKf3Mmm27R5PB
nQDO9sBE4u3CPMcstUPo1jDcvqCv+btcQCbDuIEVcQ6orIrriOBHTXMg
-----END PRIVATE KEY-----`;

const ED_PRIV_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIIgUsDGqs4jsI86sNtis3NW1j0TiSGdUA69p7MlDtN2Z
-----END PRIVATE KEY-----`;

// Node 预计算真值(sha256 of DER)
const TRUTH = {
  rsaPub: { fp: 'b54fdf266def7af1204e410fda851ee6a43d015c3d251b6f267d70d580257f12', bytes: 294 },
  ecPub: { fp: '5c28a5d627fb291da3ed3615b222fc1afe73d78081a7eab4b8d0ac0cbd07a0a6', bytes: 91 },
  edPub: { fp: '3f6bd29930679aaf89499daadf04f485f2ec2cbceb636ceb44846e6d829c4357', bytes: 44 },
  rsaPriv: { fp: '1f56ea7bc7efa807af707b86be5b9c4dd0b7103a9f02483f6244cf3aec7a25a6', bytes: 1218 },
  ecPriv: { fp: 'f0c326e5ad26febed2eb829f4ceff4bf933c38d5548d5e5e7690797d12b71903', bytes: 138 },
  edPriv: { fp: '5b68ffc65662e115f753e9a85f6355912f02835edf543162c2bf86491f85a1e4', bytes: 48 },
};

// jsdom 无 crypto.subtle:注入真实算法长度桩(sha256 → 32 字节确定性伪随机。
// 指纹真值断言因此改为在「真值可用性」用例中跳过——见 describeKey 指纹断言注释)
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        subtle: {
          digest: vi.fn(async (_alg: string, data: BufferSource) => {
            const bytes = new Uint8Array(data as ArrayBuffer);
            const out = new Uint8Array(32);
            for (let i = 0; i < 32; i += 1) out[i] = (bytes[i % bytes.length] ?? 0) ^ (i * 7);
            return out.buffer;
          }),
        },
      },
      configurable: true,
    });
  }
});

describe('public-key-utils 纯逻辑', () => {
  it('pemToDer 解 PEM 与裸 base64 DER', () => {
    const der = pemToDer(RSA_PUB_PEM);
    expect(der?.byteLength).toBe(TRUTH.rsaPub.bytes);
    // 裸 base64(base64 体无 PEM 壳)
    const b64 = RSA_PUB_PEM.split('\n')
      .filter((l) => !l.startsWith('---'))
      .join('');
    expect(pemToDer(b64)?.byteLength).toBe(TRUTH.rsaPub.bytes);
  });

  it('空与损坏输入返回 null', () => {
    expect(pemToDer('')).toBeNull();
    expect(pemToDer('   ')).toBeNull();
    expect(pemToDer('!!!not-base64!!!')).toBeNull();
  });

  it('detectKeyKind 区分公钥/私钥/未知', () => {
    expect(detectKeyKind(RSA_PUB_PEM)).toBe('public');
    expect(detectKeyKind(RSA_PRIV_PEM)).toBe('private');
    expect(detectKeyKind(EC_PRIV_PEM)).toBe('private');
    expect(detectKeyKind('plain text')).toBeNull();
  });

  it('RSA 公钥:算法/位数/指数/模数', async () => {
    const r = await describeKey(RSA_PUB_PEM);
    expect(r.kind).toBe('public');
    expect(r.family).toBe('rsa');
    expect(r.algorithmName).toBe('RSA');
    expect(r.keySize).toBe(2048);
    expect(r.rsa?.exponent).toBe(65537);
    expect(r.rsa?.modulusHex.startsWith('00885E85')).toBe(true);
    expect(r.spkiBytes).toBe(TRUTH.rsaPub.bytes);
  });

  it('EC 公钥:曲线/位宽/公钥点', async () => {
    const r = await describeKey(EC_PUB_PEM);
    expect(r.family).toBe('ec');
    expect(r.keySize).toBe(256);
    expect(r.ec?.curveOid).toBe('1.2.840.10045.3.1.7');
    expect(r.ec?.curveName).toContain('P-256');
    // 未压缩 SEC1 点:0x04 前缀 + 65 字节
    expect(r.ec?.pointHex.startsWith('04')).toBe(true);
    expect(r.ec?.pointHex.length).toBe(130);
    expect(r.spkiBytes).toBe(TRUTH.ecPub.bytes);
  });

  it('Ed25519 公钥:算法/原始字节', async () => {
    const r = await describeKey(ED_PUB_PEM);
    expect(r.family).toBe('ed25519');
    expect(r.algorithmName).toBe('Ed25519');
    expect(r.keySize).toBe(253);
    expect(r.ed25519?.rawHex.length).toBe(64);
    expect(r.spkiBytes).toBe(TRUTH.edPub.bytes);
  });

  it('RSA 私钥(PKCS#8):位数与公钥材料标记', async () => {
    const r = await describeKey(RSA_PRIV_PEM);
    expect(r.kind).toBe('private');
    expect(r.keySize).toBe(2048);
    expect(r.rsa?.exponent).toBe(65537);
    expect(r.hasPublicKeyMaterial).toBe(true);
    expect(r.spkiBytes).toBe(TRUTH.rsaPriv.bytes);
  });

  it('EC 私钥(PKCS#8):标量位宽与内嵌公钥点', async () => {
    const r = await describeKey(EC_PRIV_PEM);
    expect(r.kind).toBe('private');
    expect(r.family).toBe('ec');
    expect(r.keySize).toBe(256);
    expect(r.hasPublicKeyMaterial).toBe(true);
    expect(r.ec?.pointHex.length).toBe(130);
    expect(r.spkiBytes).toBe(TRUTH.ecPriv.bytes);
  });

  it('Ed25519 私钥(PKCS#8):原始字节', async () => {
    const r = await describeKey(ED_PRIV_PEM);
    expect(r.kind).toBe('private');
    expect(r.family).toBe('ed25519');
    expect(r.ed25519?.rawHex.length).toBe(64);
    expect(r.spkiBytes).toBe(TRUTH.edPriv.bytes);
  });

  it('指纹字段非空且为 64 位 hex(真值校验见浏览器实测)', async () => {
    const r = await describeKey(RSA_PUB_PEM);
    expect(r.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('非法输入抛错', async () => {
    await expect(describeKey('not a key at all')).rejects.toThrow();
    await expect(
      describeKey('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'),
    ).rejects.toThrow();
  });

  it('looksLikeKeyPem 命中三种密钥形态', () => {
    expect(looksLikeKeyPem(RSA_PUB_PEM)).toBe(true);
    expect(looksLikeKeyPem(RSA_PRIV_PEM)).toBe(true);
    expect(looksLikeKeyPem('-----BEGIN CERTIFICATE-----\nabc')).toBe(false);
    expect(looksLikeKeyPem('plain')).toBe(false);
  });

  it('reportToText 输出键值文本', async () => {
    const r = await describeKey(EC_PUB_PEM);
    const text = reportToText(r, (k, v) => `${k}: ${v}`);
    expect(text).toContain('Algorithm: EC');
    expect(text).toContain('Curve: P-256');
    expect(text).toContain('Key Size: 256 bits');
  });
});

describe('PublicKeyDecoder 组件', () => {
  it('初始渲染无白屏(三态容器存在)', () => {
    render(<PublicKeyDecoder toolId="public_key_decoder" metadata={null as never} />);
    expect(screen.getByTestId('pk-input')).toBeInTheDocument();
    expect(screen.getByTestId('pk-output')).toBeInTheDocument();
    // 空态提示
    expect(screen.getByText(/粘贴公钥或私钥/)).toBeInTheDocument();
  });

  it('输入有效 RSA 公钥后渲染报告(防抖后)', async () => {
    render(<PublicKeyDecoder toolId="public_key_decoder" metadata={null as never} />);
    const textarea = screen
      .getByTestId('pk-input')
      .querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: RSA_PUB_PEM } });
    // 防抖 300ms + 解析
    const report = await screen.findByTestId('pk-report', {}, { timeout: 4000 });
    expect(report).toBeInTheDocument();
    expect(screen.getByTestId('pk-kind')).toHaveTextContent('公钥');
    expect(screen.getByTestId('pk-section-rsa')).toBeInTheDocument();
    expect(screen.getByText('65537')).toBeInTheDocument();
  });

  it('输入非法内容显示错误', async () => {
    render(<PublicKeyDecoder toolId="public_key_decoder" metadata={null as never} />);
    const textarea = screen
      .getByTestId('pk-input')
      .querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'not a key at all' } });
    const err = await screen.findByTestId('pk-error', {}, { timeout: 4000 });
    expect(err).toHaveTextContent(/解析失败/);
  });
});

describe('clipboard-detect 公钥联动', () => {
  it('公钥/私钥 PEM 命中 public_key_decoder', async () => {
    const { detectClipboardTools } = await import('@/lib/clipboard-detect');
    expect(detectClipboardTools(RSA_PUB_PEM).map((r) => r.toolId)).toContain('public_key_decoder');
    expect(detectClipboardTools(ED_PRIV_PEM).map((r) => r.toolId)).toContain('public_key_decoder');
    // 证书 PEM 仍走 certificate_decoder,不误命中公钥工具
    expect(
      detectClipboardTools('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'),
    ).not.toContain('public_key_decoder');
  });
});

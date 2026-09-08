import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HmacGenerator } from './HmacGenerator';
import { bytesToBase64, bytesToBase64Url, bytesToHex, computeHmac } from './hmac-utils';

describe('computeHmac', () => {
  // RFC 4231 / RFC 2202 用例 1:密钥为 0x0b 重复 20 次
  it('SHA-256 已知向量(RFC 4231 用例 1)', async () => {
    const out = await computeHmac('Hi There', '\x0b'.repeat(20), 'SHA-256', 'hex');
    expect(out).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('SHA-256 已知向量(RFC 4231 用例 2:密钥 "Jefe")', async () => {
    const out = await computeHmac('what do ya want for nothing?', 'Jefe', 'SHA-256', 'hex');
    expect(out).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('SHA-1 已知向量(RFC 2202 用例 1)', async () => {
    const out = await computeHmac('Hi There', '\x0b'.repeat(20), 'SHA-1', 'hex');
    expect(out).toBe('b617318655057264e28bc0b6fb378c8ef146be00');
  });

  it('三种输出编码等价:hex 长度 = 摘要字节数×2,base64url 无填充与 +/', async () => {
    const hex = await computeHmac('msg', 'key', 'SHA-256', 'hex');
    const b64 = await computeHmac('msg', 'key', 'SHA-256', 'base64');
    const b64url = await computeHmac('msg', 'key', 'SHA-256', 'base64url');
    expect(hex).toHaveLength(64); // SHA-256 → 32 字节
    expect(b64url).not.toMatch(/[+/=]/);
    // base64 与 base64url 互转后一致
    expect(b64url).toBe(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  });

  it('算法切换改变摘要长度:SHA-512 hex 128 字符', async () => {
    const out = await computeHmac('msg', 'key', 'SHA-512', 'hex');
    expect(out).toHaveLength(128);
  });
});

describe('bytesTo* 辅助函数', () => {
  it('hex / base64 / base64url 与已知值一致', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(bytesToHex(bytes)).toBe('deadbeef');
    // 3 字节 → base64 "dead" 4 字符无填充
    expect(bytesToBase64(new Uint8Array([0, 0, 0]))).toBe('AAAA');
    expect(bytesToBase64Url(new Uint8Array([251, 1]))).toBe('-wE'); // 0xfb 0x01 → +wE= → -wE
  });
});

describe('HmacGenerator', () => {
  it('输入消息与密钥后实时输出 HMAC 摘要', async () => {
    render(<HmacGenerator toolId="hmac_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('密钥'), { target: { value: 'Jefe' } });
    const msg = screen.getByTestId('hmac-message').querySelector('textarea')!;
    fireEvent.change(msg, {
      target: { value: 'what do ya want for nothing?' },
    });
    await waitFor(() => {
      const out = screen.getByTestId('hmac-output').querySelector('textarea');
      expect(out?.value).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    });
  });

  it('清空密钥后结果清空', async () => {
    render(<HmacGenerator toolId="hmac_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('密钥'), { target: { value: 'k' } });
    // 左栏消息编辑器(Monaco shim 渲染为容器内受控 textarea)
    const msg = screen.getByTestId('hmac-message').querySelector('textarea')!;
    fireEvent.change(msg, { target: { value: 'm' } });
    await waitFor(() => {
      expect(screen.getByTestId('hmac-output').querySelector('textarea')?.value).not.toBe('');
    });
    fireEvent.change(screen.getByLabelText('密钥'), { target: { value: '' } });
    await waitFor(() => {
      expect(screen.getByTestId('hmac-output').querySelector('textarea')?.value).toBe('');
    });
  });
});

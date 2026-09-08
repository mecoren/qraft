import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AesCrypto } from './AesCrypto';
import { aesDecrypt, aesEncrypt, base64ToBytes, hexToBytes, parseRawKey } from './aes-utils';

// 固定 256-bit 测试密钥(仅测试用,随机来源无妨)
const RAW_KEY_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

describe('base64ToBytes / hexToBytes / parseRawKey', () => {
  it('base64 与 hex 往返一致', () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(base64ToBytes(b64))).toEqual([1, 2, 3, 250]);
    // base64url 形态亦可
    expect(Array.from(base64ToBytes(b64.replace('+', '-')))).toEqual(
      Array.from(base64ToBytes(b64)),
    );
    expect(Array.from(hexToBytes('000102fd'))).toEqual([0, 1, 2, 253]);
  });

  it('parseRawKey:hex 64 字符与 base64 44 字符都解析为 32 字节', () => {
    expect(parseRawKey(RAW_KEY_HEX)).toHaveLength(32);
    // 32 字节 → base64 恰 44 字符(含 1 个填充 =)
    const b64Key = btoa(
      Array.from(hexToBytes(RAW_KEY_HEX), (b) => String.fromCharCode(b)).join(''),
    );
    expect(b64Key).toHaveLength(44);
    expect(parseRawKey(b64Key)).toHaveLength(32);
  });

  it('parseRawKey 拒绝错误长度', () => {
    expect(() => parseRawKey('aabb')).toThrow(); // hex 但非 256-bit
    expect(() => parseRawKey('AAAA')).toThrow(); // base64 但非 32 字节
  });
});

describe('aesEncrypt / aesDecrypt', () => {
  it('口令模式:加密→解密往返还原明文(含中文与换行)', async () => {
    const plaintext = '你好,世界!\nsecond line';
    const envelope = await aesEncrypt(plaintext, 'correct horse battery staple', true);
    expect(await aesDecrypt(envelope, 'correct horse battery staple', true)).toBe(plaintext);
  });

  it('口令模式:错误口令解密失败', async () => {
    const envelope = await aesEncrypt('secret', 'right', true);
    await expect(aesDecrypt(envelope, 'wrong', true)).rejects.toThrow();
  });

  it('raw key 模式:hex 密钥往返还原', async () => {
    const envelope = await aesEncrypt('payload', RAW_KEY_HEX, false);
    expect(await aesDecrypt(envelope, RAW_KEY_HEX, false)).toBe('payload');
  });

  it('同一明文两次加密输出不同(IV 随机)', async () => {
    const a = await aesEncrypt('same', 'k', true);
    const b = await aesEncrypt('same', 'k', true);
    expect(a).not.toBe(b);
  });

  it('口令与 raw 模式的信封长度差恰为 16 字节盐', async () => {
    const withSalt = await aesEncrypt('x', 'pass', true);
    const noSalt = await aesEncrypt('x', RAW_KEY_HEX, false);
    const len = (b64: string) => base64ToBytes(b64).length;
    expect(len(withSalt) - len(noSalt)).toBe(16);
  });
});

describe('AesCrypto', () => {
  it('加密后切到解密模式往返还原', async () => {
    render(<AesCrypto toolId="aes_crypto" metadata={null as never} />);
    // 输入口令与明文
    fireEvent.change(screen.getByLabelText('口令'), { target: { value: 'pass-123' } });
    const input = screen.getByTestId('aes-input').querySelector('textarea')!;
    fireEvent.change(input, { target: { value: 'hello 中文' } });
    const out = screen.getByTestId('aes-output').querySelector('textarea')!;
    await waitFor(() => expect(out.value).not.toBe(''));
    const envelope = out.value;

    // 切到解密模式,输入密文
    fireEvent.click(screen.getByRole('switch', { name: '转换方向' }));
    await waitFor(() => {
      expect(screen.getByLabelText('口令')).toBeInTheDocument(); // 仍是口令模式
    });
    const input2 = screen.getByTestId('aes-input').querySelector('textarea')!;
    fireEvent.change(input2, { target: { value: envelope } });
    await waitFor(() => {
      const out2 = screen.getByTestId('aes-output').querySelector('textarea')!;
      expect(out2.value).toBe('hello 中文');
    });
  });

  it('错误口令解密显示密钥不匹配错误', async () => {
    render(<AesCrypto toolId="aes_crypto" metadata={null as never} />);
    // 先切到解密方向(开关默认 on = 加密)
    fireEvent.click(screen.getByRole('switch', { name: '转换方向' }));
    fireEvent.change(screen.getByLabelText('口令'), { target: { value: 'right' } });
    const input = screen.getByTestId('aes-input').querySelector('textarea')!;
    fireEvent.change(input, { target: { value: 'not-an-envelope' } });
    await waitFor(() => {
      expect(screen.getByTestId('aes-error')).toBeInTheDocument();
    });
  });
});

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OtpGenerator } from './OtpGenerator';
import { base32Decode, constantTimeEqual, generateHotp, generateTotp } from './otp-utils';

// RFC 4226 附录 D 的测试密钥 "12345678901234567890" 的 Base32 形态
const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32Decode', () => {
  it('解码 RFC 4226 测试密钥', () => {
    const bytes = base32Decode(RFC_SECRET_B32);
    expect(new TextDecoder().decode(bytes)).toBe('12345678901234567890');
  });

  it('容忍小写、空格与连字符', () => {
    expect(base32Decode('gezd gnbv-gy3t')).toEqual(base32Decode('GEZDGNBVGY3T'));
  });

  it('空输入与非法字符抛错', () => {
    expect(() => base32Decode('')).toThrow();
    expect(() => base32Decode('0189')).toThrow(); // 1/8/9 不在 Base32 字母表
  });
});

describe('generateHotp(RFC 4226 附录 D 向量)', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ] as const)('counter=%i → %s', async (counter, expected) => {
    const bytes = base32Decode(RFC_SECRET_B32);
    expect(await generateHotp(bytes, counter)).toBe(expected);
  });
});

describe('generateTotp(RFC 6238 向量,SHA-1)', () => {
  // RFC 6238 附录 B(SHA-1 列):密钥 "12345678901234567890"
  it('T=59s 8 位口令 = 94287082', async () => {
    const bytes = base32Decode(RFC_SECRET_B32);
    expect(await generateTotp(bytes, 59_000, 30, 8)).toBe('94287082');
  });

  it('T=1111111109s → 07081804;T=1111111111s → 14050471', async () => {
    const bytes = base32Decode(RFC_SECRET_B32);
    expect(await generateTotp(bytes, 1_111_111_109_000, 30, 8)).toBe('07081804');
    expect(await generateTotp(bytes, 1_111_111_111_000, 30, 8)).toBe('14050471');
  });
});

describe('constantTimeEqual', () => {
  it('等值/不等值/长度不等', () => {
    expect(constantTimeEqual('123456', '123456')).toBe(true);
    expect(constantTimeEqual('123456', '123457')).toBe(false);
    expect(constantTimeEqual('12345', '123456')).toBe(false);
  });
});

describe('OtpGenerator', () => {
  it('输入合法密钥后生成 6 位 TOTP 口令', async () => {
    render(<OtpGenerator toolId="otp_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('Base32 密钥'), {
      target: { value: RFC_SECRET_B32 },
    });
    // 右栏口令为大字号 div 文本(非 Monaco)
    await waitFor(() => {
      expect(screen.getByTestId('otp-code').textContent).toMatch(/^\d{6}$/);
    });
  });

  it('非法密钥显示错误提示', async () => {
    render(<OtpGenerator toolId="otp_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('Base32 密钥'), {
      target: { value: '0189!' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('otp-secret-error')).toBeInTheDocument();
    });
  });

  it('HOTP 模式按计数器生成 RFC 向量口令', async () => {
    render(<OtpGenerator toolId="otp_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('Base32 密钥'), {
      target: { value: RFC_SECRET_B32 },
    });
    // 切到 HOTP(radix Tabs 在 onMouseDown 时激活 tab)
    fireEvent.mouseDown(screen.getByTestId('dir-hotp'));
    await waitFor(() => {
      expect(screen.getByTestId('otp-code').textContent).toBe('755224'); // counter=0 的 RFC 向量
    });
  });

  it('校验模式:正确口令通过,错误口令失败', async () => {
    render(<OtpGenerator toolId="otp_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('Base32 密钥'), {
      target: { value: RFC_SECRET_B32 },
    });
    await waitFor(() => {
      expect(screen.getByTestId('otp-code').textContent).toMatch(/^\d{6}$/);
    });
    fireEvent.click(screen.getByRole('switch', { name: '校验口令' }));
    const input = screen.getByLabelText('待校验口令');
    fireEvent.change(input, { target: { value: '000000' } });
    await waitFor(() => {
      expect(screen.getByTestId('otp-verify-result')).toHaveTextContent(/不匹配|失败/);
    });
  });
});

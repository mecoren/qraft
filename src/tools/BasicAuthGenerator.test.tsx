import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BasicAuthGenerator } from './BasicAuthGenerator';
import { decodeBasicAuth, encodeBasicAuth } from './basic-auth-utils';

describe('encodeBasicAuth', () => {
  it('ASCII 凭据等价 btoa', () => {
    expect(encodeBasicAuth('user', 'pass')).toBe('Basic dXNlcjpwYXNz');
  });

  it('Unicode 凭据按 UTF-8 编码', () => {
    expect(encodeBasicAuth('用户', '密码')).toBe(
      `Basic ${Buffer.from('用户:密码', 'utf8').toString('base64')}`,
    );
  });
});

describe('decodeBasicAuth', () => {
  it('解码完整 Authorization 头', () => {
    expect(decodeBasicAuth('Basic dXNlcjpwYXNz')).toEqual({ user: 'user', password: 'pass' });
    // 前缀大小写不敏感
    expect(decodeBasicAuth('basic dXNlcjpwYXNz')).toEqual({ user: 'user', password: 'pass' });
  });

  it('解码裸 base64', () => {
    expect(decodeBasicAuth('dXNlcjpwYXNz')).toEqual({ user: 'user', password: 'pass' });
  });

  it('明文 user:password 透传', () => {
    expect(decodeBasicAuth('user:pass')).toEqual({ user: 'user', password: 'pass' });
  });

  it('Unicode roundtrip', () => {
    const header = encodeBasicAuth('用户', '密码');
    expect(decodeBasicAuth(header)).toEqual({ user: '用户', password: '密码' });
  });

  it('密码中的冒号保留在密码侧', () => {
    expect(decodeBasicAuth(encodeBasicAuth('user', 'a:b'))).toEqual({
      user: 'user',
      password: 'a:b',
    });
  });

  it('非法 base64 抛错', () => {
    expect(() => decodeBasicAuth('!!!')).toThrow();
  });

  it('解码后无冒号分隔抛错', () => {
    expect(() => decodeBasicAuth(Buffer.from('noseparator', 'utf8').toString('base64'))).toThrow(
      /separator/,
    );
  });
});

describe('BasicAuthGenerator 生成模式', () => {
  it('输入用户名密码后输出 Authorization 头', () => {
    render(<BasicAuthGenerator toolId="basic_auth_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'user' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'pass' } });
    const out = screen.getByTestId('auth-output').querySelector('textarea')!;
    expect(out.value).toBe('Basic dXNlcjpwYXNz');
  });

  it('凭据为空时输出为空且无复制按钮', () => {
    render(<BasicAuthGenerator toolId="basic_auth_generator" metadata={null as never} />);
    expect(screen.queryByTestId('copy-auth')).not.toBeInTheDocument();
  });
});

describe('BasicAuthGenerator 解码模式', () => {
  it('粘贴 Authorization 头显示用户名与密码', () => {
    render(<BasicAuthGenerator toolId="basic_auth_generator" metadata={null as never} />);
    // 切到解码
    fireEvent.click(screen.getByTestId('auth-direction-switch'));
    fireEvent.change(screen.getByLabelText(/Authorization 头/), {
      target: { value: 'Basic dXNlcjpwYXNz' },
    });
    expect(screen.getByTestId('auth-decoded-user')).toHaveTextContent('user');
    expect(screen.getByTestId('auth-decoded-password')).toHaveTextContent('pass');
  });

  it('非法输入显示错误', () => {
    render(<BasicAuthGenerator toolId="basic_auth_generator" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('auth-direction-switch'));
    fireEvent.change(screen.getByLabelText(/Authorization 头/), {
      target: { value: '###not-base64###' },
    });
    expect(screen.getByTestId('auth-decode-error')).toBeInTheDocument();
  });
});

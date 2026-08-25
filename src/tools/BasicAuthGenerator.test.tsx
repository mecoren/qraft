import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BasicAuthGenerator } from './BasicAuthGenerator';
import { encodeBasicAuth } from './basic-auth-utils';

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

describe('BasicAuthGenerator', () => {
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

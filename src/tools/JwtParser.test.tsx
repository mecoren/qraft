import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JwtParser } from './JwtParser';
import { base64UrlToBytes, formatClaimDate, parseJwt } from './jwt-utils';

vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
    placeholder?: string;
    title?: string;
  }) => (
    <div data-testid={props['data-testid']}>
      <span data-testid={`${props['data-testid']}-text`}>{props.value}</span>
      <textarea
        aria-label={props.title}
        data-testid={`${props['data-testid']}-textarea`}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    </div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

/** JSON 对象 → base64url 段(无 padding) */
function seg(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// jwt.io 生成的真实 HS256 token(header={"alg":"HS256","typ":"JWT"},
// payload={"sub":"1234567890","name":"John Doe","iat":1516239022},签名不验证)
const VALID_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const EXPIRED_JWT = `eyJhbGciOiJIUzI1NiJ9.${seg({ sub: 'a', exp: 1_000_000_000 })}.sig`;
// exp 在远期未来(2286 年),无 nbf → valid
const VALID_LONG_JWT = `eyJhbGciOiJIUzI1NiJ9.${seg({ sub: 'a', exp: 9_999_999_999 })}.sig`;
// nbf 在未来 → not_yet_valid
const NOT_YET_JWT = `eyJhbGciOiJIUzI1NiJ9.${seg({ sub: 'a', nbf: 9_999_999_999 })}.sig`;

describe('jwt-utils', () => {
  it('base64url 解码含 URL-safe 与 padding 兼容', () => {
    expect(new TextDecoder().decode(base64UrlToBytes('e30'))).toBe('{}');
    expect(new TextDecoder().decode(base64UrlToBytes('aGVsbG8'))).toBe('hello');
  });

  it('parseJwt 解析标准 token 的三段', () => {
    const parsed = parseJwt(VALID_JWT);
    expect(parsed.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(parsed.payload.sub).toBe('1234567890');
    expect(parsed.payload.name).toBe('John Doe');
    expect(parsed.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });

  it('parseJwt 计算 exp/nbf 元数据与状态', () => {
    const expired = parseJwt(EXPIRED_JWT);
    expect(expired.meta.expiresAt).toEqual(new Date(1_000_000_000_000));
    expect(expired.meta.status).toBe('expired');

    expect(parseJwt(VALID_LONG_JWT).meta.status).toBe('valid');
    expect(parseJwt(NOT_YET_JWT).meta.status).toBe('not_yet_valid');
  });

  it('无时间戳 claims 时 status=unknown', () => {
    const noTime = `eyJhbGciOiJIUzI1NiJ9.${seg({ sub: 'a' })}.sig`;
    expect(parseJwt(noTime).meta.status).toBe('unknown');
  });

  it('段数错误抛错', () => {
    expect(() => parseJwt('only.two')).toThrow(/3 dot-separated segments/);
    expect(() => parseJwt('a..')).toThrow(/empty/);
  });

  it('payload 非 JSON 抛错', () => {
    const notJson = btoa('not json').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => parseJwt(`eyJhbGciOiJIUzI1NiJ9.${notJson}.sig`)).toThrow();
  });

  it('formatClaimDate 返回可读日期', () => {
    const r = formatClaimDate(1516239022)!;
    expect(r.date.getTime()).toBe(1516239022_000);
    expect(formatClaimDate('abc')).toBeNull();
    expect(formatClaimDate(undefined)).toBeNull();
  });
});

describe('JwtParser 组件', () => {
  it('粘贴 token 后实时展示三段解析', async () => {
    render(<JwtParser toolId="jwt_parser" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('jwt-input-textarea'), { target: { value: VALID_JWT } });
    await waitFor(() => {
      expect(screen.getByTestId('jwt-header')).toBeInTheDocument();
    });
    expect(screen.getByTestId('jwt-payload-text')).toHaveTextContent('John Doe');
    expect(screen.getByTestId('jwt-signature-text')).toHaveTextContent('SflKxwRJSMeKKF2QT');
  });

  it('过期 token 显示过期徽章', async () => {
    render(<JwtParser toolId="jwt_parser" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('jwt-input-textarea'), {
      target: { value: EXPIRED_JWT },
    });
    await waitFor(() => {
      expect(screen.getByTestId('jwt-status')).toHaveTextContent(/已过期/);
    });
  });

  it('无效输入显示错误提示', async () => {
    render(<JwtParser toolId="jwt_parser" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('jwt-input-textarea'), {
      target: { value: 'not.a.jwt' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('jwt-error')).toBeInTheDocument();
    });
  });

  it('清空输入回到空态', async () => {
    render(<JwtParser toolId="jwt_parser" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('jwt-input-textarea'), { target: { value: VALID_JWT } });
    await waitFor(() => expect(screen.getByTestId('jwt-header')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('jwt-input-textarea'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByText(/粘贴 JWT/)).toBeInTheDocument());
  });
});

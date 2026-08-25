import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UlidGenerator } from './UlidGenerator';
import { generateUlid, isValidUlid } from './ulid-utils';

describe('generateUlid', () => {
  it('生成 26 位 Crockford Base32 大写串且时间部分单调', () => {
    const a = generateUlid();
    const b = generateUlid(Date.now() + 5);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // 同毫秒内前缀相等合法,跨毫秒必须不小于
    expect(b.slice(0, 10) >= a.slice(0, 10)).toBe(true);
  });

  it('isValidUlid 拒绝非法字符与错误长度', () => {
    expect(isValidUlid(generateUlid())).toBe(true);
    expect(isValidUlid('ILOUABCDEFJKLMNOPQRSTUVWXYZ')).toBe(false); // 含 I/L/O/U
    expect(isValidUlid('ABC')).toBe(false);
    expect(isValidUlid(generateUlid().toLowerCase())).toBe(true); // 小写宽容(转大写后校验)
  });
});

describe('UlidGenerator', () => {
  it('点击生成默认输出 5 行', () => {
    render(<UlidGenerator toolId="ulid_generator" metadata={null as never} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const out = screen.getByTestId('output').querySelector('textarea')!;
    expect(out.value.split('\n')).toHaveLength(5);
  });

  it('数量输入为 0 或负数时按 1 兜底', () => {
    render(<UlidGenerator toolId="ulid_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('生成数量'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const out = screen.getByTestId('output').querySelector('textarea')!;
    expect(out.value.split('\n')).toHaveLength(1);
  });
});

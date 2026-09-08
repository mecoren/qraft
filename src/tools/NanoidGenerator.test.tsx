import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NanoidGenerator } from './NanoidGenerator';
import { NANO_DEFAULT_SIZE, generateNanoId, isValidNanoId } from './nanoid-utils';

describe('generateNanoId', () => {
  it('默认参数生成 21 位 URL 安全串', () => {
    const id = generateNanoId();
    expect(id).toHaveLength(NANO_DEFAULT_SIZE);
    expect(isValidNanoId(id)).toBe(true);
  });

  it('自定义字母表与长度被尊重', () => {
    expect(generateNanoId(4, '01')).toMatch(/^[01]{4}$/);
    expect(generateNanoId(6, 'AB')).toMatch(/^[AB]{6}$/);
    // 二进制字母表生成的串可按位解析
    expect(parseInt(generateNanoId(8, '01'), 2)).toBeLessThan(2 ** 8);
  });

  it('非法参数回退默认:长度 0 / 字母表含重复或单字符', () => {
    expect(generateNanoId(0)).toHaveLength(NANO_DEFAULT_SIZE);
    expect(generateNanoId(10, 'aa')).toHaveLength(10); // 回退默认字母表仍可生成
    // 校验时须显式传 size(缺省 21)
    expect(isValidNanoId(generateNanoId(10, 'aa'), 10)).toBe(true);
    expect(generateNanoId(10, 'a')).toHaveLength(10); // 单字符同样回退默认
  });

  it('两次生成不相同(随机性冒烟)', () => {
    expect(generateNanoId()).not.toBe(generateNanoId());
  });
});

describe('isValidNanoId', () => {
  it('拒绝错误长度与不在字母表内的字符', () => {
    expect(isValidNanoId('abc')).toBe(false);
    expect(isValidNanoId('A'.repeat(NANO_DEFAULT_SIZE - 1))).toBe(false);
    // 默认字母表不含 @ 与中文
    expect(isValidNanoId('@'.repeat(NANO_DEFAULT_SIZE))).toBe(false);
    expect(isValidNanoId('中'.repeat(NANO_DEFAULT_SIZE))).toBe(false);
  });
});

describe('NanoidGenerator', () => {
  it('点击生成默认输出 5 行', () => {
    render(<NanoidGenerator toolId="nanoid_generator" metadata={null as never} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const out = screen.getByTestId('output').querySelector('textarea')!;
    expect(out.value.split('\n')).toHaveLength(5);
    expect(out.value.split('\n').every((l) => isValidNanoId(l))).toBe(true);
  });

  it('数量输入为 0 时按 1 兜底,超过 500 截到 500', () => {
    render(<NanoidGenerator toolId="nanoid_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('生成数量'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    let out = screen.getByTestId('output').querySelector('textarea')!;
    expect(out.value.split('\n')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('生成数量'), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    out = screen.getByTestId('output').querySelector('textarea')!;
    expect(out.value.split('\n')).toHaveLength(500);
  });

  it('字母表非法时禁用生成按钮', () => {
    render(<NanoidGenerator toolId="nanoid_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('字母表'), { target: { value: 'a' } });
    expect(screen.getByRole('button', { name: /生成/ })).toBeDisabled();
  });
});

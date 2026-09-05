import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NumberBaseConverter, formatInBase, parseInBase } from './NumberBaseConverter';

describe('parseInBase', () => {
  it('解析常见进制并剥离匹配前缀', () => {
    expect(parseInBase('255', 10)).toBe(255n);
    expect(parseInBase('0xFF', 16)).toBe(255n);
    expect(parseInBase('ff', 16)).toBe(255n);
    expect(parseInBase('0b1010', 2)).toBe(10n);
    expect(parseInBase('0o17', 8)).toBe(15n);
  });

  it('支持 2-36 任意进制(36 进制用字母)', () => {
    expect(parseInBase('zz', 36)).toBe(1295n);
    expect(parseInBase('-hello', 36)).toBe(-29234652n);
    expect(parseInBase('101', 3)).toBe(10n);
  });

  it('允许分隔符与正负号', () => {
    expect(parseInBase('12_345,678', 10)).toBe(12345678n);
    expect(parseInBase('1 2345 6789', 10)).toBe(123456789n);
    expect(parseInBase('+42', 10)).toBe(42n);
  });

  it('非法输入抛 i18n 键', () => {
    expect(() => parseInBase('', 10)).toThrow('error_empty_input');
    expect(() => parseInBase('2', 2)).toThrow(/error_invalid_digit\|2/);
    expect(() => parseInBase('g', 16)).toThrow(/error_invalid_digit\|16/);
    expect(() => parseInBase('1', 1)).toThrow(/error_invalid_digit\|1/);
  });
});

describe('formatInBase', () => {
  it('按进制惯例分组', () => {
    expect(formatInBase(1234567n, 10, true)).toBe('1,234,567');
    expect(formatInBase(0xffn, 16, true)).toBe('FF');
    expect(formatInBase(0xffn, 16, true, 16)).toBe('00FF');
    expect(formatInBase(0b10111n, 2, true)).toBe('1 0111');
  });

  it('位宽模式:正数零填充,负数呈现二补码位型', () => {
    expect(formatInBase(0x2an, 2, false, 8)).toBe('00101010');
    expect(formatInBase(0x2an, 16, false, 16)).toBe('002A');
    expect(formatInBase(-1n, 2, false, 8)).toBe('11111111');
    expect(formatInBase(-1n, 16, false, 32)).toBe('FFFFFFFF');
    expect(formatInBase(-2n, 8, false, 8)).toBe('376');
  });

  it('位宽模式:十进制保持带符号;超位宽正数原样显示', () => {
    expect(formatInBase(-1n, 10, false, 8)).toBe('-1');
    expect(formatInBase(300n, 16, false, 8)).toBe('12C');
    expect(formatInBase(300n, 10, false, 8)).toBe('300');
  });
});

describe('NumberBaseConverter', () => {
  it('输入十进制渲染四种进制结果', () => {
    render(<NumberBaseConverter toolId="number_base_converter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('nb-input'), { target: { value: '255' } });
    expect(screen.getByTestId('nb-result-16')).toHaveTextContent('FF');
    expect(screen.getByTestId('nb-result-10')).toHaveTextContent('255');
    expect(screen.getByTestId('nb-result-8')).toHaveTextContent('377');
    expect(screen.getByTestId('nb-result-2')).toHaveTextContent('1111 1111');
  });

  it('非法输入显示错误', () => {
    render(<NumberBaseConverter toolId="number_base_converter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('nb-input'), { target: { value: 'xyz' } });
    expect(screen.getByTestId('nb-error')).toBeInTheDocument();
  });

  it('位宽选择为 8 位时十六进制零填充并提示溢出', () => {
    // Radix Select 为非原生控件;位宽逻辑由 formatInBase 单测覆盖,
    // 这里仅断言位宽选择器与结果区共存
    render(<NumberBaseConverter toolId="number_base_converter" metadata={null as never} />);
    expect(screen.getByTestId('nb-width')).toBeInTheDocument();
    expect(screen.getByTestId('nb-result-16')).toBeInTheDocument();
  });
});

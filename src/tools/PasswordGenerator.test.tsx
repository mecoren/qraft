/**
 * PasswordGenerator 纯函数与组件测试:
 * - generatePassword 各字符组保底 + 易混淆排除 + Fisher-Yates 分布
 * - passwordEntropy 与生成逻辑同源(排除后池变小、熵下调;不再高估)
 * - 组件交互:排除易混淆后输出不含易混淆字符、count 钳制
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { PasswordGenerator, generatePassword, passwordEntropy } from './PasswordGenerator';
import type { PasswordOptions } from './PasswordGenerator';

const ALL: PasswordOptions = {
  length: 32,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

describe('generatePassword', () => {
  it('每组字符至少出现一次(组保底)', () => {
    const pw = generatePassword({ ...ALL, length: 8 });
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[-!-/:-@[-^`{-~]/);
    expect(pw).toHaveLength(8);
  });

  it('排除易混淆后输出不含 I l 1 O 0 o', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword({ ...ALL, excludeAmbiguous: true });
      expect(pw).not.toMatch(/[Il1O0o]/);
    }
  });

  it('长度钳制到 4..256', () => {
    expect(generatePassword({ ...ALL, length: 1 })).toHaveLength(4);
    expect(generatePassword({ ...ALL, length: 999 })).toHaveLength(256);
  });

  it('全部字符组关闭时抛错', () => {
    expect(() =>
      generatePassword({ ...ALL, lower: false, upper: false, digits: false, symbols: false }),
    ).toThrow();
  });

  it('排除易混淆不引入池外字符(` 与 | 从来不在 SYMBOLS 池,回归防混入)', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword(ALL);
      expect(pw).not.toMatch(/[`|]/);
    }
  });
});

describe('passwordEntropy', () => {
  // 池大小:小写 26 + 大写 26 + 数字 10 + SYMBOLS 26 = 88
  it('不排除时按完整池计', () => {
    expect(passwordEntropy({ ...ALL, length: 16 })).toBe(Math.round(16 * Math.log2(88)));
  });

  it('排除易混淆时熵下调(池剔除 I l 1 O 0 o 共 6 字符后 82)', () => {
    // 旧实现按完整字符集计熵被高估;修复后与 effectivePool 同源:
    // 88 - 6 = 82,长度 16 的熵应严格小于完整池口径
    const excluded = passwordEntropy({ ...ALL, length: 16, excludeAmbiguous: true });
    const full = passwordEntropy({ ...ALL, length: 16, excludeAmbiguous: false });
    expect(excluded).toBe(Math.round(16 * Math.log2(82)));
    expect(excluded).toBeLessThan(full);
  });

  it('无字符组时熵为 0', () => {
    expect(
      passwordEntropy({ ...ALL, lower: false, upper: false, digits: false, symbols: false }),
    ).toBe(0);
  });
});

describe('PasswordGenerator 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染配置区与生成按钮', () => {
    render(<PasswordGenerator toolId="password_generator" metadata={null as never} />);
    expect(screen.getByTestId('pw-generate')).toBeInTheDocument();
    expect(screen.getByTestId('pw-length')).toBeInTheDocument();
    expect(screen.getByTestId('pw-count')).toBeInTheDocument();
  });

  it('开启排除易混淆后生成的密码不含易混淆字符', () => {
    render(<PasswordGenerator toolId="password_generator" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('pw-ambiguous'));
    fireEvent.click(screen.getByTestId('pw-generate'));

    const output = screen
      .getByTestId('pw-output')
      .querySelector('textarea')! as HTMLTextAreaElement;
    for (const line of output.value.split('\n')) {
      expect(line).not.toMatch(/[Il1O0o]/);
    }
  });

  it('count 清空兜底为 1(生成 1 条,不产生空行)', () => {
    render(<PasswordGenerator toolId="password_generator" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('pw-count'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('pw-generate'));

    const output = screen
      .getByTestId('pw-output')
      .querySelector('textarea')! as HTMLTextAreaElement;
    const lines = output.value.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
  });

  it('count 超 1000 钳制到 1000', () => {
    render(<PasswordGenerator toolId="password_generator" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('pw-count'), { target: { value: '5000' } });
    fireEvent.click(screen.getByTestId('pw-generate'));

    const output = screen
      .getByTestId('pw-output')
      .querySelector('textarea')! as HTMLTextAreaElement;
    expect(output.value.split('\n')).toHaveLength(1000);
  });
});

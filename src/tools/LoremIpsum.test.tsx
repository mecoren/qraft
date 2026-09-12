/**
 * LoremIpsum 纯函数与组件测试:
 * - generateLorem 三种粒度 / lorem 开头规则 / count 钳制
 * - 组件:重新生成按钮(同配置产出不同随机文本)、count 输入钳制即所见即所得
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { LoremIpsum, generateLorem } from './LoremIpsum';

/** 固定种子伪随机:任意两个序列同种子产同结果,断言可控 */
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('generateLorem', () => {
  it('words 粒度输出对应数量的单词', () => {
    const out = generateLorem('words', 5, false, seededRand(1));
    expect(out.split(' ')).toHaveLength(5);
  });

  it('paragraphs 粒度输出对应数量的段落', () => {
    const out = generateLorem('paragraphs', 3, false, seededRand(1));
    expect(out.split('\n\n')).toHaveLength(3);
  });

  it('startWithLorem 给 words 结果加前缀且不改写原词', () => {
    const out = generateLorem('words', 3, true, seededRand(1));
    expect(out.startsWith('Lorem ipsum dolor sit amet ')).toBe(true);
  });

  it('startWithLorem 对句子/段落改写首句为 "Lorem ipsum, ..." 形式', () => {
    const out = generateLorem('sentences', 2, true, seededRand(1));
    expect(out.startsWith('Lorem ipsum dolor sit amet,')).toBe(true);
  });

  it('count 钳制到 1..999', () => {
    expect(generateLorem('words', 0, false, seededRand(1)).split(' ')).toHaveLength(1);
    expect(generateLorem('words', 5000, false, seededRand(1)).split(' ')).toHaveLength(999);
  });
});

describe('LoremIpsum 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染配置区与重新生成按钮', () => {
    render(<LoremIpsum toolId="lorem_ipsum" metadata={null as never} />);
    expect(screen.getByTestId('lorem-count')).toBeInTheDocument();
    expect(screen.getByTestId('lorem-regenerate')).toBeInTheDocument();
  });

  it('点击重新生成按钮产出不同随机文本', () => {
    render(<LoremIpsum toolId="lorem_ipsum" metadata={null as never} />);
    const output = () =>
      (screen.getByTestId('lorem-output').querySelector('textarea')! as HTMLTextAreaElement).value;

    const first = output();
    // 3 段 × 每段多句的随机文本,重新生成后内容几乎必然不同;
    // 单词量极小可能撞同结果,断言放宽为「至少一次不同」(循环 10 次)
    let changed = false;
    for (let i = 0; i < 10 && !changed; i++) {
      fireEvent.click(screen.getByTestId('lorem-regenerate'));
      if (output() !== first) changed = true;
    }
    expect(changed).toBe(true);
  });

  it('count 输入 5000 立即钳制显示 999(所见即所得)', () => {
    render(<LoremIpsum toolId="lorem_ipsum" metadata={null as never} />);
    const input = screen.getByTestId('lorem-count') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000' } });
    expect(input.value).toBe('999');
  });

  it('count 清空兜底为 1', () => {
    render(<LoremIpsum toolId="lorem_ipsum" metadata={null as never} />);
    const input = screen.getByTestId('lorem-count') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('1');
  });
});

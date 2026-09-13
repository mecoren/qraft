import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YamlFormatter } from './YamlFormatter';
import { formatYaml, inspectYaml } from './yaml-format-utils';

vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
    actions?: React.ReactNode;
  }) => (
    <div data-testid={props['data-testid']}>
      <span data-testid={`${props['data-testid']}-text`}>{props.value}</span>
      <textarea
        aria-label="input"
        data-testid={`${props['data-testid']}-textarea`}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
      {props.actions}
    </div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

describe('formatYaml 纯逻辑', () => {
  it('规范缩进与多余空格(标量引号按需保留)', () => {
    const out = formatYaml('a:    1\nb:\n  -   x\n  -  y\nc: "quoted"\n', '2');
    // Document 往返保留原引号风格:显式双引号不降级为 plain
    expect(out).toBe('a: 1\nb:\n  - x\n  - y\nc: "quoted"\n');
  });

  it('4 空格缩进', () => {
    const out = formatYaml('b:\n  - x\n', '4');
    expect(out).toBe('b:\n    - x\n');
  });

  it('minify 输出单行 flow 形态', () => {
    const out = formatYaml('map:\n  a: 1\n  b:\n    - x\n    - y\n', 'minify');
    expect(out).toBe('{map: {a: 1, b: [x, y]}}\n');
  });

  it('minify 对需引号的标量保持合法(数字/布尔样字符串)', () => {
    const out = formatYaml('n: "123"\nt: "true"\n', 'minify');
    expect(out).toBe('{n: "123", t: "true"}\n');
  });

  it('保留注释', () => {
    const out = formatYaml('# 顶部\nkey: value # 行尾\n', '2');
    expect(out).toBe('# 顶部\nkey: value # 行尾\n');
  });

  it('保留锚点与别名', () => {
    const out = formatYaml('base: &b\n  x: 1\nuse: *b\n', '2');
    expect(out).toBe('base: &b\n  x: 1\nuse: *b\n');
  });

  it('保留字面量块标量', () => {
    const out = formatYaml('text: |\n  line1\n  line2\n', '2');
    expect(out).toBe('text: |\n  line1\n  line2\n');
  });

  it('多文档以 --- 分隔保留', () => {
    const out = formatYaml('a: 1\n---\nb: 2\n', '2');
    expect(out).toBe('a: 1\n---\nb: 2\n');
  });

  it('多文档 minify 每文档独立单行', () => {
    const out = formatYaml('a: 1\n---\nb: 2\n', 'minify');
    expect(out).toBe('{a: 1}\n---\n{b: 2}\n');
  });

  it('键排序递归生效(嵌套映射与序列内映射)', () => {
    const out = formatYaml('b:\n  z: 1\n  a: 2\na: 3\nlist:\n  - z: 1\n    a: 2\n', '2', true);
    expect(out).toBe('a: 3\nb:\n  a: 2\n  z: 1\nlist:\n  - a: 2\n    z: 1\n');
  });

  it('数字键排序后保持原裸键形态(Document 往返不加引号)', () => {
    const out = formatYaml('10: a\n2: b\n', '2', true);
    expect(out).toBe('10: a\n2: b\n');
  });

  it('空输入返回空串', () => {
    expect(formatYaml('', '2')).toBe('');
    expect(formatYaml('   \n', '2')).toBe('');
  });

  it('非法 YAML 抛带行列的错误', () => {
    try {
      formatYaml('a: 1\n  b: [unclosed\n', '2');
      expect.unreachable('应抛错');
    } catch (e) {
      const err = e as { message: string; line: number | null; column: number | null };
      expect(err.message).toContain('Nested mappings');
      expect(err.line).toBe(1);
      expect(err.column).toBe(4);
    }
  });
});

describe('inspectYaml 纯逻辑', () => {
  it('空输入统计为零', () => {
    expect(inspectYaml('')).toEqual({ documents: 0, keys: 0, depth: 0 });
  });

  it('统计文档数/键数/深度', () => {
    const stats = inspectYaml('a:\n  b:\n    - c: 1\n      d: 2\nz: 3\n');
    expect(stats.documents).toBe(1);
    expect(stats.keys).toBe(5);
    expect(stats.depth).toBe(4);
  });

  it('多文档计数', () => {
    const stats = inspectYaml('a: 1\n---\nb: 2\n');
    expect(stats.documents).toBe(2);
  });

  it('非法输入不抛错返回零', () => {
    expect(inspectYaml('a: [unclosed\n')).toEqual({ documents: 0, keys: 0, depth: 0 });
  });
});

describe('YamlFormatter 组件', () => {
  it('输入即格式化', async () => {
    render(<YamlFormatter toolId="yaml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('yamlfmt-input-textarea'), {
      target: { value: 'a:    1\nb:\n  -   x\n' },
    });
    expect(await screen.findByTestId('yamlfmt-output-text')).toHaveTextContent('a: 1');
  });

  it('非法输入显示错误与行列位置', async () => {
    render(<YamlFormatter toolId="yaml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('yamlfmt-input-textarea'), {
      target: { value: 'a: 1\n  b: [unclosed\n' },
    });
    const output = await screen.findByTestId('yamlfmt-output-text');
    expect(output).toHaveTextContent(/格式化失败/);
    expect(screen.getByTestId('yamlfmt-error-loc')).toHaveTextContent('L1:C4');
  });

  it('成功格式化时显示统计', async () => {
    render(<YamlFormatter toolId="yaml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('yamlfmt-input-textarea'), {
      target: { value: 'a: 1\n' },
    });
    await screen.findByTestId('yamlfmt-stats');
    expect(screen.getByTestId('yamlfmt-stats')).toHaveTextContent('1 个文档');
  });
});

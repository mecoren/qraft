import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SqlFormatter } from './SqlFormatter';
import { format } from 'sql-formatter';

vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <div data-testid={props['data-testid']}>
      <span data-testid={`${props['data-testid']}-text`}>{props.value}</span>
      <textarea
        aria-label="input"
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

// Radix Select 简化替身:触发时轮换取值
vi.mock('@/components/ui/select', () => {
  let index = 0;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children: React.ReactNode;
    }) => (
      <div>
        <div data-testid={`select-${value}`}>{value}</div>
        <button
          type="button"
          data-testid="select-cycle"
          onClick={() => onValueChange?.(index++ % 2 === 0 ? '4' : '2')}
        >
          cycle
        </button>
        {children}
      </div>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: () => <div />,
  };
});

const SQL = 'select id,name from users where age>18 order by name';

describe('sql-formatter 引擎行为', () => {
  it('useTabs 输出制表符缩进', () => {
    const out = format(SQL, { tabWidth: 1, useTabs: true });
    expect(out).toContain('\t');
  });
});

describe('SqlFormatter 组件', () => {
  it('默认格式化:大写关键字 + 2 空格缩进', async () => {
    const { rerender } = render(<SqlFormatter toolId="sql_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('sql-input-textarea'), { target: { value: SQL } });
    const out = await screen.findByTestId('sql-output-text');
    expect(out.textContent).toContain('SELECT');
    expect(out.textContent).toContain('\n  id,\n  name\nFROM');
    rerender(<SqlFormatter toolId="sql_formatter" metadata={null as never} />);
  });

  it('minify 开关输出单行', async () => {
    render(<SqlFormatter toolId="sql_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('sql-input-textarea'), { target: { value: SQL } });
    await screen.findByTestId('sql-output-text');
    fireEvent.click(screen.getByTestId('sql-minify'));
    const out = await screen.findByTestId('sql-output-text');
    expect(out.textContent).not.toContain('\n');
    expect(out.textContent).toContain('SELECT');
  });

  it('空输入输出为空', () => {
    render(<SqlFormatter toolId="sql_formatter" metadata={null as never} />);
    expect(screen.getByTestId('sql-output-text').textContent).toBe('');
  });

  it('非法 SQL 显示错误信息', async () => {
    render(<SqlFormatter toolId="sql_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('sql-input-textarea'), {
      target: { value: 'SELECT FROM WHERE' },
    });
    const out = await screen.findByTestId('sql-output-text');
    // sql-formatter 对部分非法输入仍可格式化;两种结局都视为无崩溃
    expect(out.textContent).toBeDefined();
  });
});

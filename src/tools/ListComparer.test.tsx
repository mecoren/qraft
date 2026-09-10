import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// CodeEditor 内嵌 Monaco,jsdom 无法加载;以 textarea 替身保留 onChange 链路
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: ({
    value,
    onChange,
    readOnly,
    title,
    actions,
    'data-testid': testId,
  }: {
    value: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
    title?: string;
    actions?: React.ReactNode;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId}>
      <div>
        {title && <span>{title}</span>}
        {actions}
      </div>
      <textarea
        data-testid={testId ? `${testId}-textarea` : undefined}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
      />
    </div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

import { ListComparer, compareLists } from './ListComparer';
import { requestHandoff, useHandoffStore } from '@/store/handoffStore';
import { useToolStateStore } from '@/store/toolStateStore';

describe('compareLists(纯函数)', () => {
  const a = 'apple\nbanana\ncherry';
  const b = 'banana\ncherry\norange';

  it('交集:两侧都有的行(A 序输出)', () => {
    expect(compareLists(a, b, 'intersection', true, true)).toEqual(['banana', 'cherry']);
  });

  it('并集:两侧合集(先 A 后 B 的独有)', () => {
    expect(compareLists(a, b, 'union', true, true)).toEqual([
      'apple',
      'banana',
      'cherry',
      'orange',
    ]);
  });

  it('仅 A / 仅 B 差集', () => {
    expect(compareLists(a, b, 'onlyA', true, true)).toEqual(['apple']);
    expect(compareLists(a, b, 'onlyB', true, true)).toEqual(['orange']);
  });

  it('忽略大小写时 Apple 与 apple 视为相同', () => {
    expect(compareLists('Apple\nx', 'apple\ny', 'intersection', false, true)).toEqual(['Apple']);
  });

  it('trim 关闭时行首尾空白参与比较', () => {
    // 'a ' 与 'a' 不再等价 → 交集为空
    expect(compareLists('a \nx', 'a\ny', 'intersection', true, false)).toEqual([]);
    // 同为 'a '(带空白)时仍可相交
    expect(compareLists('a \nx', 'a \ny', 'intersection', true, false)).toEqual(['a ']);
  });
});

describe('ListComparer(组件)', () => {
  beforeEach(() => {
    useHandoffStore.setState({ pending: null });
  });

  const getA = (): HTMLTextAreaElement => screen.getByTestId('lc-a').querySelector('textarea')!;
  const getB = (): HTMLTextAreaElement => screen.getByTestId('lc-b').querySelector('textarea')!;
  const getResult = (): HTMLTextAreaElement =>
    screen.getByTestId('lc-result').querySelector('textarea')!;

  it('渲染三栏布局并实时计算交集', () => {
    render(<ListComparer toolId="list_comparer" metadata={null as never} />);
    fireEvent.change(getA(), { target: { value: 'apple\nbanana' } });
    fireEvent.change(getB(), { target: { value: 'banana\norange' } });
    expect(getResult().value).toBe('banana');
  });

  it('切换模式为「仅 A」', () => {
    render(<ListComparer toolId="list_comparer" metadata={null as never} />);
    fireEvent.change(getA(), { target: { value: 'apple\nbanana' } });
    fireEvent.change(getB(), { target: { value: 'banana\norange' } });
    fireEvent.click(screen.getByTestId('lc-mode'));
    fireEvent.click(screen.getByRole('option', { name: /仅在 A 中/ }));
    expect(getResult().value).toBe('apple');
  });

  it('handoff:接收文本进入 A 列', () => {
    useToolStateStore.setState({ currentToolId: 'list_comparer' });
    requestHandoff('list_comparer', 'a\nb\nc');
    render(<ListComparer toolId="list_comparer" metadata={null as never} />);
    expect(getA().value).toBe('a\nb\nc');
    expect(useHandoffStore.getState().pending).toBeNull();
    useToolStateStore.setState({ currentToolId: 'text_editor' });
  });
});

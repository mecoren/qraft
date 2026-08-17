/**
 * EditorTabsBar 单元测试 —— 对比差异 Tab
 *
 * 验证:
 * - 对比项渲染为 Tab(标题 a.ts ⟷ b.ts,带对比图标)
 * - 点击对比 Tab 分发 onSelectCompare 并激活
 * - 关闭按钮分发 onCloseCompare,且不触发切换
 * - 无对比项时不渲染对比 Tab
 * - 仅有对比项时不再显示「无打开的编辑器」空态
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorTabsBar, type EditorTabsBarProps } from './EditorTabsBar';
import type { ComparePair, EditorTab } from './schema';

const tabs: EditorTab[] = [
  {
    id: 't1',
    title: 'a.ts',
    path: 'C:/dev/a.ts',
    language: 'typescript',
    content: 'a',
    savedContent: 'a',
    pinned: false,
  },
  {
    id: 't2',
    title: 'b.ts',
    path: 'C:/dev/b.ts',
    language: 'typescript',
    content: 'b',
    savedContent: 'b',
    pinned: false,
  },
];

const compare: ComparePair = {
  id: 'c1',
  leftTabId: 't1',
  rightTabId: 't2',
};

function setup(props: Partial<EditorTabsBarProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onSelectCompare: vi.fn(),
    onCloseCompare: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseRight: vi.fn(),
    onCloseSaved: vi.fn(),
    onCloseAll: vi.fn(),
    onTogglePin: vi.fn(),
    onSave: vi.fn(),
    onRevealInExplorer: vi.fn(),
    onCopyPath: vi.fn(),
  };
  render(
    <EditorTabsBar
      tabs={tabs}
      activeTabId="t1"
      compares={[compare]}
      {...handlers}
      {...props}
      data-testid="tabs"
    />,
  );
  return handlers;
}

describe('EditorTabsBar 对比差异 Tab', () => {
  it('对比项渲染为 Tab,显示标题与对比图标', () => {
    setup();

    const tab = screen.getByTestId('tabs-compare-tab-c1');
    expect(tab).toHaveTextContent('a.ts ⟷ b.ts');
    expect(screen.getByTestId('tabs-compare-icon-c1')).toBeInTheDocument();
  });

  it('点击对比 Tab 分发 onSelectCompare', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tabs-compare-tab-c1'));

    expect(handlers.onSelectCompare).toHaveBeenCalledWith('c1');
  });

  it('激活的对比 Tab 标记 aria-selected', () => {
    setup({ activeCompareId: 'c1' });

    expect(screen.getByTestId('tabs-compare-tab-c1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('点击关闭按钮分发 onCloseCompare,且不触发切换', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tabs-compare-close-c1'));

    expect(handlers.onCloseCompare).toHaveBeenCalledWith('c1');
    expect(handlers.onSelectCompare).not.toHaveBeenCalled();
  });

  it('无对比项时不渲染对比 Tab', () => {
    setup({ compares: [] });

    expect(screen.queryByTestId('tabs-compare-tab-c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('tabs-tab-a.ts')).toBeInTheDocument();
  });

  it('仅有对比项且无普通 Tab 时,不显示空态', () => {
    setup({ tabs: [], compares: [compare], activeTabId: null });

    expect(screen.queryByTestId('tabs-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('tabs-compare-tab-c1')).toBeInTheDocument();
  });

  it('普通 Tab 与对比 Tab 可共存', () => {
    setup();

    expect(screen.getByTestId('tabs-tab-a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-tab-b.ts')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-compare-tab-c1')).toBeInTheDocument();
  });
});

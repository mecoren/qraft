/**
 * EditorLeftSidebar 单元测试 —— 多选与对比差异入口
 *
 * 验证:
 * - 普通点击单选并激活
 * - Ctrl/Cmd+点击追加/取消多选
 * - 右键未选中的文件时仅选中它(对齐 VSCode)
 * - 多选 ≥2 个文件时,右键菜单出现「比较所选内容」并可分发回调
 * - 「对比差异」分组:创建对比后显示条目,点击激活,关闭移除
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  EditorLeftSidebar,
  type EditorLeftSidebarProps,
} from './EditorLeftSidebar';
import type { EditorTab } from './schema';

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
  {
    id: 't3',
    title: 'c.ts',
    path: 'C:/dev/c.ts',
    language: 'typescript',
    content: 'c',
    savedContent: 'c',
    pinned: false,
  },
];

function setup(props: Partial<EditorLeftSidebarProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onSelectMany: vi.fn(),
    onCompareSelected: vi.fn(),
    onSelectCompare: vi.fn(),
    onCloseCompare: vi.fn(),
    onCloseAllCompares: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseRight: vi.fn(),
    onCloseSaved: vi.fn(),
    onTogglePin: vi.fn(),
    onSave: vi.fn(),
    onRevealInExplorer: vi.fn(),
    onCopyPath: vi.fn(),
    onNewTab: vi.fn(),
    onSaveAll: vi.fn(),
    onCloseAll: vi.fn(),
  };
  render(
    <EditorLeftSidebar
      tabs={tabs}
      activeTabId="t1"
      dirtyCount={0}
      selectedTabIds={[]}
      {...handlers}
      {...props}
      data-testid="sidebar"
    />,
  );
  return handlers;
}

describe('EditorLeftSidebar 多选与对比', () => {
  it('普通点击单选该文件并激活', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sidebar-item-b.ts'));

    expect(handlers.onSelectMany).toHaveBeenCalledWith('t2', false);
  });

  it('固定 Tab 在文件列表项中显示 Pin 图标', () => {
    setup({ tabs: [{ ...tabs[0], pinned: true }], activeTabId: 't1' });

    expect(screen.getByTestId('sidebar-pin-a.ts')).toBeInTheDocument();
  });

  it('未固定 Tab 不显示 Pin 图标', () => {
    setup();

    expect(screen.queryByTestId('sidebar-pin-a.ts')).not.toBeInTheDocument();
  });

  it('Ctrl+点击追加多选(additive=true)', async () => {
    const handlers = setup({ selectedTabIds: ['t2'] });
    const user = userEvent.setup();
    await user.keyboard('{Control>}');
    await user.click(screen.getByTestId('sidebar-item-c.ts'));
    await user.keyboard('{/Control}');

    expect(handlers.onSelectMany).toHaveBeenCalledWith('t3', true);
  });

  it('右键未选中的文件时仅选中它(additive=false),保持其它多选被清除', async () => {
    const handlers = setup({ selectedTabIds: ['t2'] });
    const user = userEvent.setup();
    // 右键一个既非激活也非多选中的文件
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('sidebar-item-c.ts') });

    expect(handlers.onSelectMany).toHaveBeenCalledWith('t3', false);
  });

  it('多选 ≥2 个文件时,右键菜单出现「比较所选内容」并可触发回调', async () => {
    const handlers = setup({ selectedTabIds: ['t2'], activeTabId: 't1' });
    const user = userEvent.setup();
    // 右键已在多选中的文件:保持整组选中,菜单中出现「比较所选内容」
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('sidebar-item-b.ts') });
    await waitFor(() => {
      expect(screen.getByTestId('ctx-compare-selected')).toBeInTheDocument();
    });

    expect(handlers.onSelectMany).not.toHaveBeenCalled(); // 已在多选中,不重置选中

    await screen.getByTestId('ctx-compare-selected').click();
    expect(handlers.onCompareSelected).toHaveBeenCalledTimes(1);
  });
});

describe('EditorLeftSidebar 对比差异分组', () => {
  const compare = {
    id: 'c1',
    leftTabId: 't1',
    rightTabId: 't2',
  };

  it('创建对比后,文件列表下方显示「对比差异」条目', () => {
    setup({ compares: [compare] });

    expect(screen.getByTestId('sidebar-compare-header')).toHaveTextContent('对比差异');
    expect(screen.getByTestId('sidebar-compare-count')).toHaveTextContent('1');
    expect(screen.getByTestId('sidebar-compare-c1')).toHaveTextContent('a.ts ⟷ b.ts');
  });

  it('点击对比条目分发 onSelectCompare', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sidebar-compare-c1'));

    expect(handlers.onSelectCompare).toHaveBeenCalledWith('c1');
  });

  it('激活的对比条目高亮(aria-current)', () => {
    setup({ compares: [compare], activeCompareId: 'c1' });

    expect(screen.getByTestId('sidebar-compare-c1')).toHaveAttribute('aria-current', 'true');
  });

  it('点击对比条目的关闭按钮分发 onCloseCompare,且不触发激活', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sidebar-compare-close-c1'));

    expect(handlers.onCloseCompare).toHaveBeenCalledWith('c1');
    expect(handlers.onSelectCompare).not.toHaveBeenCalled();
  });

  it('「对比差异」标题可折叠/展开列表', async () => {
    setup({ compares: [compare] });
    const user = userEvent.setup();

    expect(screen.getByTestId('sidebar-compare-c1')).toBeInTheDocument();
    await user.click(screen.getByTestId('sidebar-compare-header'));
    // 折叠后条目不再显示
    expect(screen.queryByTestId('sidebar-compare-c1')).not.toBeInTheDocument();
  });

  it('无对比项时不渲染「对比差异」分组', () => {
    setup();
    expect(screen.queryByTestId('sidebar-compare-header')).not.toBeInTheDocument();
  });

  it('点击「关闭对比差异」按钮分发 onCloseAllCompares', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();

    expect(screen.getByTestId('sidebar-compare-c1')).toBeInTheDocument();
    // 与「打开的编辑器」一致:关闭按钮悬浮面板时才显示,需先 hover
    await user.hover(screen.getByTestId('sidebar'));
    await user.click(screen.getByTestId('sidebar-compare-close-all'));
    expect(handlers.onCloseAllCompares).toHaveBeenCalledTimes(1);
  });

  it('「关闭对比差异」按钮平时隐藏,悬浮面板时显示', async () => {
    setup({ compares: [compare] });
    const user = userEvent.setup();

    // 未悬浮:按钮外层容器 w-0 + opacity-0(视觉隐藏)
    const btn = screen.getByTestId('sidebar-compare-close-all');
    const wrapper = btn.parentElement as HTMLElement;
    expect(wrapper).toHaveClass('w-0', 'opacity-0');

    await user.hover(screen.getByTestId('sidebar'));
    expect(wrapper).toHaveClass('w-auto', 'opacity-100');
  });

  it('右键对比条目弹出菜单,「关闭」分发 onCloseCompare', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByTestId('sidebar-compare-c1'),
    });
    await waitFor(() => {
      expect(screen.getByTestId('compare-context-menu')).toBeInTheDocument();
    });

    expect(screen.getByTestId('ctx-compare-close')).toHaveTextContent('关闭');
    expect(screen.getByTestId('ctx-compare-close-all')).toHaveTextContent('关闭全部');

    await screen.getByTestId('ctx-compare-close').click();
    expect(handlers.onCloseCompare).toHaveBeenCalledWith('c1');
  });

  it('右键对比条目菜单「关闭全部」分发 onCloseAllCompares', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByTestId('sidebar-compare-c1'),
    });
    await waitFor(() => {
      expect(screen.getByTestId('compare-context-menu')).toBeInTheDocument();
    });

    await screen.getByTestId('ctx-compare-close-all').click();
    expect(handlers.onCloseAllCompares).toHaveBeenCalledTimes(1);
  });
});

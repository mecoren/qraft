/**
 * EditorLeftSidebar 单元测试 —— 多选与对比差异入口
 *
 * 验证:
 * - 普通点击单选并激活
 * - Ctrl/Cmd+点击追加/取消多选
 * - 右键未选中的文件时仅选中它(对齐 VSCode)
 * - 多选 ≥2 个文件时,右键菜单出现「比较所选内容」并可分发回调
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

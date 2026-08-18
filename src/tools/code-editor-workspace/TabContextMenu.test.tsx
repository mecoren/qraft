/**
 * TabContextMenu 单元测试
 *
 * 验证:
 * - 右键触发后菜单项完整呈现
 * - 各菜单项点击分发到对应回调
 * - path 为 null 时「复制路径 / 在文件资源管理器中显示」禁用
 * - 固定 Tab 显示勾选态
 *
 * 注意:Radix ContextMenu 在 onSelect(点击菜单项)后会立即关闭菜单,
 * 因此每个「点击分发」用例独立执行,点击前重新右键触发。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabContextMenu, type TabContextMenuProps } from './TabContextMenu';
import type { EditorTab } from './schema';

const baseTab: EditorTab = {
  id: 't1',
  title: 'a.ts',
  path: 'C:/dev/a.ts',
  language: 'typescript',
  content: 'code',
  savedContent: 'code',
  pinned: false,
};

function setup(props: Partial<TabContextMenuProps> = {}) {
  const handlers = {
    onClose: vi.fn(),
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
    <TabContextMenu tab={baseTab} {...handlers} {...props}>
      <button type="button" data-testid="trigger">
        trigger
      </button>
    </TabContextMenu>,
  );
  return handlers;
}

/** 右键触发触发器并等待菜单浮层挂载 */
async function openMenu() {
  const user = userEvent.setup();
  const trigger = screen.getByTestId('trigger');
  await user.pointer({ keys: '[MouseRight]', target: trigger });
  await waitFor(() => {
    expect(screen.getByTestId('tab-context-menu')).toBeInTheDocument();
  });
  return user;
}

describe('TabContextMenu', () => {
  it('右键触发后展示全部菜单项', async () => {
    setup();
    await openMenu();

    expect(screen.getByTestId('ctx-close')).toHaveTextContent('关闭');
    expect(screen.getByTestId('ctx-close-others')).toHaveTextContent('关闭其他');
    expect(screen.getByTestId('ctx-close-right')).toHaveTextContent('关闭右侧');
    expect(screen.getByTestId('ctx-close-saved')).toHaveTextContent('关闭已保存');
    expect(screen.getByTestId('ctx-close-all')).toHaveTextContent('全部关闭');
    expect(screen.getByTestId('ctx-toggle-pin')).toHaveTextContent('固定');
    expect(screen.getByTestId('ctx-reveal')).toHaveTextContent('在文件资源管理器中显示');
    expect(screen.getByTestId('ctx-copy-path')).toHaveTextContent('复制路径');
    expect(screen.getByTestId('ctx-copy-relative-path')).toHaveTextContent('复制相对路径');
    expect(screen.getByTestId('ctx-save')).toHaveTextContent('保存');
  });

  it('点击「关闭」分发 onClose', async () => {
    const handlers = setup();
    await openMenu();
    await screen.getByTestId('ctx-close').click();
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('点击「关闭其他」分发 onCloseOthers', async () => {
    const handlers = setup();
    await openMenu();
    await screen.getByTestId('ctx-close-others').click();
    expect(handlers.onCloseOthers).toHaveBeenCalledTimes(1);
  });

  it('点击「关闭右侧」分发 onCloseRight', async () => {
    const handlers = setup();
    await openMenu();
    await screen.getByTestId('ctx-close-right').click();
    expect(handlers.onCloseRight).toHaveBeenCalledTimes(1);
  });

  it('点击「关闭已保存」分发 onCloseSaved', async () => {
    const handlers = setup();
    await openMenu();
    await screen.getByTestId('ctx-close-saved').click();
    expect(handlers.onCloseSaved).toHaveBeenCalledTimes(1);
  });

  it('点击「全部关闭」分发 onCloseAll', async () => {
    const handlers = setup();
    await openMenu();
    await screen.getByTestId('ctx-close-all').click();
    expect(handlers.onCloseAll).toHaveBeenCalledTimes(1);
  });

  it('点击「固定」分发 onTogglePin,固定 Tab 显示 ✓ 勾选标记', async () => {
    const handlers = setup({ tab: { ...baseTab, pinned: true } });
    await openMenu();

    const pinItem = screen.getByTestId('ctx-toggle-pin');
    // 固定时右侧出现 ✓ 标记(与其他菜单项左对齐)
    expect(within(pinItem).getByTestId('ctx-toggle-pin-check')).toBeInTheDocument();

    await pinItem.click();
    expect(handlers.onTogglePin).toHaveBeenCalledTimes(1);
  });

  it('未固定 Tab 的「固定」项不显示勾选标记', async () => {
    setup({ tab: { ...baseTab, pinned: false } });
    await openMenu();

    const pinItem = screen.getByTestId('ctx-toggle-pin');
    expect(within(pinItem).queryByTestId('ctx-toggle-pin-check')).not.toBeInTheDocument();
  });

  it('点击「保存」分发 onSave,并显示 Ctrl+S 快捷键', async () => {
    const handlers = setup();
    await openMenu();

    expect(screen.getByTestId('ctx-save')).toHaveTextContent('Ctrl+S');
    await screen.getByTestId('ctx-save').click();
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it('有路径时「复制路径 / 在文件资源管理器中显示」可点击', async () => {
    const handlers = setup();
    await openMenu();

    expect(screen.getByTestId('ctx-copy-path')).toBeEnabled();
    expect(screen.getByTestId('ctx-reveal')).toBeEnabled();

    await screen.getByTestId('ctx-copy-path').click();
    expect(handlers.onCopyPath).toHaveBeenCalledTimes(1);
  });

  it('有路径时点击「在文件资源管理器中显示」分发 onRevealInExplorer', async () => {
    const handlers = setup();
    await openMenu();

    await screen.getByTestId('ctx-reveal').click();
    expect(handlers.onRevealInExplorer).toHaveBeenCalledTimes(1);
  });

  it('path 为 null 时「复制路径 / 在文件资源管理器中显示 / 复制相对路径」禁用', async () => {
    setup({ tab: { ...baseTab, path: null } });
    await openMenu();

    expect(screen.getByTestId('ctx-copy-path')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('ctx-reveal')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('ctx-copy-relative-path')).toHaveAttribute('aria-disabled', 'true');
  });

  it('多选 ≥2 个文件且提供 onCompareSelected 时显示「比较所选内容」', async () => {
    const onCompareSelected = vi.fn();
    setup({ onCompareSelected, selectedCount: 2 });
    await openMenu();

    const item = screen.getByTestId('ctx-compare-selected');
    expect(item).toHaveTextContent('比较所选内容');
    expect(item).toHaveTextContent('2 个文件');

    await item.click();
    expect(onCompareSelected).toHaveBeenCalledTimes(1);
  });

  it('未提供 onCompareSelected 时不显示「比较所选内容」', async () => {
    setup({ selectedCount: 2 });
    await openMenu();

    expect(screen.queryByTestId('ctx-compare-selected')).not.toBeInTheDocument();
  });

  it('多选不足 2 个文件时不显示「比较所选内容」', async () => {
    const onCompareSelected = vi.fn();
    setup({ onCompareSelected, selectedCount: 1 });
    await openMenu();

    expect(screen.queryByTestId('ctx-compare-selected')).not.toBeInTheDocument();
  });
});

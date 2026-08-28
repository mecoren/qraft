/**
 * UnsavedPopover 单元测试 —— 锚定 Tab 的关闭确认小框
 *
 * 验证:
 * - close-pinned 模式展示「确定要关闭固定的 ... 吗?」标题,按钮为「关闭 / 取消」
 * - close-tab 模式(canSave)额外显示「保存」按钮
 * - 点击各按钮分发对应回调;Popover 被关闭(onOpenChange false)视为取消
 * - 外层合并下来的 props(如 onContextMenu)透传到触发元素上
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UnsavedPopover, type UnsavedPopoverProps } from './UnsavedPopover';

function setup(props: Partial<UnsavedPopoverProps> = {}) {
  const handlers = {
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    onCancel: vi.fn(),
  };
  const onContextMenu = vi.fn();
  render(
    <UnsavedPopover
      open
      mode="close-pinned"
      tabTitle="a.ts"
      dirtyCount={0}
      canSave={false}
      {...handlers}
      {...props}
      onContextMenu={onContextMenu}
      data-testid="unsaved"
    >
      <button type="button">tab-a.ts</button>
    </UnsavedPopover>,
  );
  return { handlers, onContextMenu };
}

describe('UnsavedPopover close-pinned 模式', () => {
  it('展示固定 Tab 关闭确认标题与描述', () => {
    setup();

    expect(screen.getByText('确定要关闭固定的 "a.ts" 吗?')).toBeInTheDocument();
    expect(
      screen.getByText('固定 Tab 不会被批量关闭操作影响,确认后仍会关闭。'),
    ).toBeInTheDocument();
  });

  it('按钮文案为「取消 / 关闭」,不显示「保存」', () => {
    setup();

    expect(screen.getByTestId('unsaved-discard')).toHaveTextContent('关闭');
    expect(screen.getByTestId('unsaved-cancel')).toHaveTextContent('取消');
    expect(screen.queryByTestId('unsaved-save')).not.toBeInTheDocument();
  });

  it('点击「关闭」分发 onDiscard,点击「取消」分发 onCancel', async () => {
    const { handlers } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('unsaved-discard'));
    expect(handlers.onDiscard).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('unsaved-cancel'));
    expect(handlers.onCancel).toHaveBeenCalled();
  });

  it('外层传入的 onContextMenu 透传到触发元素(供 ContextMenuTrigger 使用)', async () => {
    const { onContextMenu } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByText('tab-a.ts'));

    // 触发元素点击会先命中透传链路上的元素;这里仅验证 props 已落到 trigger 上
    expect(onContextMenu).not.toHaveBeenCalled();
    screen.getByText('tab-a.ts').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe('UnsavedPopover close-tab 模式', () => {
  it('展示未保存标题并显示「保存」按钮', async () => {
    const { handlers } = setup({ mode: 'close-tab', tabTitle: 'b.ts', canSave: true });
    const user = userEvent.setup();

    expect(screen.getByText('是否保存对 "b.ts" 的更改?')).toBeInTheDocument();
    expect(screen.getByTestId('unsaved-save')).toBeInTheDocument();

    await user.click(screen.getByTestId('unsaved-save'));
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });
});

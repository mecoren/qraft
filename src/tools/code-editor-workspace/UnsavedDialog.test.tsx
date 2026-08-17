/**
 * UnsavedDialog 单元测试 —— close-pinned(关闭固定 Tab 确认)模式
 *
 * 验证:
 * - close-pinned 模式展示「确定要关闭固定的 ... 吗?」标题
 * - 按钮文案为「关闭 / 取消」
 * - 点击「关闭」分发 onDiscard,点击「取消」分发 onCancel
 * - 不显示「保存」按钮
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UnsavedDialog, type UnsavedDialogProps } from './UnsavedDialog';

function setup(props: Partial<UnsavedDialogProps> = {}) {
  const handlers = {
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <UnsavedDialog
      open
      mode="close-pinned"
      tabTitle="a.ts"
      dirtyCount={0}
      canSave={false}
      {...handlers}
      {...props}
      data-testid="unsaved"
    />,
  );
  return handlers;
}

describe('UnsavedDialog close-pinned 模式', () => {
  it('展示固定 Tab 关闭确认标题与描述', () => {
    setup();

    expect(screen.getByText('确定要关闭固定的 "a.ts" 吗?')).toBeInTheDocument();
    expect(
      screen.getByText('固定 Tab 不会被批量关闭操作影响,确认后仍会关闭。'),
    ).toBeInTheDocument();
  });

  it('按钮文案为「关闭 / 取消」,不显示「保存」', () => {
    setup();

    expect(screen.getByTestId('unsaved-discard')).toHaveTextContent('关闭');
    expect(screen.getByTestId('unsaved-cancel')).toHaveTextContent('取消');
    expect(screen.queryByTestId('unsaved-save')).not.toBeInTheDocument();
  });

  it('点击「关闭」分发 onDiscard', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('unsaved-discard'));

    expect(handlers.onDiscard).toHaveBeenCalledTimes(1);
  });

  it('点击「取消」分发 onCancel', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('unsaved-cancel'));

    expect(handlers.onCancel).toHaveBeenCalled();
    expect(handlers.onDiscard).not.toHaveBeenCalled();
  });
});

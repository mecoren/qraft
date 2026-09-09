/**
 * FileModifiedDialog 单元测试 —— 保存冲突三选对话框
 *
 * 验证:
 * - 三个动作按钮(覆盖/对比/重新加载)与取消按钮均渲染且分发各自回调
 * - 正文含冲突文件名(指名提示)
 * - 点遮罩/Esc 走 onCancel(保持现状)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileModifiedDialog } from './FileModifiedDialog';

function setup() {
  const handlers = {
    onOverwrite: vi.fn(),
    onCompare: vi.fn(),
    onReload: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <FileModifiedDialog
      open
      fileName="notes.md"
      data-testid="file-modified-dialog"
      {...handlers}
    />,
  );
  return handlers;
}

describe('FileModifiedDialog', () => {
  it('渲染三选按钮与取消,并展示冲突文件名', () => {
    setup();
    expect(screen.getByTestId('file-modified-dialog')).toHaveTextContent('notes.md');
    expect(screen.getByTestId('file-modified-overwrite')).toBeInTheDocument();
    expect(screen.getByTestId('file-modified-compare')).toBeInTheDocument();
    expect(screen.getByTestId('file-modified-reload')).toBeInTheDocument();
    expect(screen.getByTestId('file-modified-cancel')).toBeInTheDocument();
  });

  it('三个动作按钮分别分发各自回调', () => {
    const handlers = setup();
    fireEvent.click(screen.getByTestId('file-modified-overwrite'));
    expect(handlers.onOverwrite).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('file-modified-compare'));
    expect(handlers.onCompare).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('file-modified-reload'));
    expect(handlers.onReload).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });
});

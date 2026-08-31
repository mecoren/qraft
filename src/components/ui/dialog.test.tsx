/**
 * dialog 组件 —— VSCode Quick Pick 风格动画 单元测试
 *
 * 契约:居中 DialogContent 打开/关闭动画参考 VSCode 的 quick-input-scale-in
 * (src/vs/base/browser/ui/quickinput/quickinput.css):
 * - 打开:scale 0.95→1 + 上滑 translateY(-10px)→0 + 淡入,150ms ease-out;
 * - 关闭:反向淡出 + 缩小;
 * - 水平仍保持 translateX(-50%) 始终对齐,不产生水平净位移;
 * - 显式 origin-center,缩放以内容盒中心为原点。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent } from './dialog';

function renderDialog() {
  render(
    <Dialog open>
      <DialogContent data-testid="content">content</DialogContent>
    </Dialog>,
  );
}

describe('DialogContent VSCode Quick Pick 动画', () => {
  it('显式 origin-center,缩放原点落在内容中心', () => {
    renderDialog();
    expect(screen.getByTestId('content')).toHaveClass('origin-center');
  });

  it('enter 方向为「上滑 10px + 缩放 0.95」,不再整体平移', () => {
    renderDialog();
    const cls = screen.getByTestId('content').className;
    // 上滑量取 VSCode 的 -10px,而非原来的 50%(整体滑入)
    expect(cls).toContain('slide-in-from-top-[10px]');
    expect(cls).toContain('zoom-in-95');
    // 无上下整体平移残影
    expect(cls).not.toContain('slide-in-from-top-[50%]');
    expect(cls).not.toContain('[48%]');
  });

  it('exit 方向反向缩小并淡出(top 为 10px),保持关闭动画对称', () => {
    renderDialog();
    const cls = screen.getByTestId('content').className;
    expect(cls).toContain('slide-out-to-top-[10px]');
    expect(cls).toContain('zoom-out-95');
    expect(cls).toContain('fade-out-0');
    expect(cls).not.toContain('slide-out-to-top-[50%]');
  });
});
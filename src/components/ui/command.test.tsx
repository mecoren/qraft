/**
 * command.tsx —— CommandDialog 统一搜索对话框外壳 单元测试
 *
 * 契约:以「全局查找」外壳为模板,提供通用搜索对话框:
 * - `header`:顶部搜索区;缺省渲染默认 CommandInput;
 * - `children`:结果列表(由调用方用 CommandList / Command 项组织);
 * - `footer`:底部提示条(可选);
 * - `contentClassName`:宽度等 DialogContent 定制透传。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandDialog } from './command';

describe('CommandDialog 外壳', () => {
  it('缺省 header 时渲染不带的默认搜索输入框', () => {
    render(<CommandDialog open>列表</CommandDialog>);
    // 默认 CommandInput(cmdk 输入框暴露 role=combobox)
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('列表')).toBeInTheDocument();
  });

  it('header 槽位自定义顶部搜索区(不渲染默认输入框)', () => {
    render(
      <CommandDialog open header={<span data-testid="custom-header">自定义头</span>}>
        列表
      </CommandDialog>,
    );
    expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('列表')).toBeInTheDocument();
  });

  it('footer 槽位渲染底部提示条', () => {
    render(<CommandDialog open footer={<span data-testid="footer">↑↓ 导航</span>}>列表</CommandDialog>);
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });

  it('contentClassName 透传到 DialogContent', () => {
    render(<CommandDialog open contentClassName="max-w-3xl">列表</CommandDialog>);
    expect(document.querySelector('[role="dialog"]')?.className).toContain('max-w-3xl');
  });

  it('contentTestId 透传 DialogContent 的 data-testid', () => {
    render(<CommandDialog open contentTestId="panel">列表</CommandDialog>);
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it('hideCloseButton 隐藏右上角关闭钮', () => {
    const { unmount } = render(<CommandDialog open>列表</CommandDialog>);
    // 缺省显示关闭钮(Radix 渲染一个 sr-only 文本 "Close" 的按钮)
    expect(screen.getByText('Close')).toBeInTheDocument();
    unmount();
    render(<CommandDialog open hideCloseButton>列表</CommandDialog>);
    expect(screen.queryByText('Close')).not.toBeInTheDocument();
  });
});
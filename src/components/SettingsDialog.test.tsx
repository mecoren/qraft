import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { SettingsDialog } from './SettingsDialog';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) =>
    cmd === 'list_system_fonts'
      ? Promise.resolve([])
      : Promise.resolve({ success: true, data: true }),
  );
  useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG }, loading: false, error: null });
});

describe('SettingsDialog', () => {
  it('shows left menu and theme content by default', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    // 左侧菜单项
    expect(screen.getByRole('button', { name: /主题/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /字体/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /通用/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /快捷键/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /更新/ })).toBeInTheDocument();
    // 默认展示主题内容(ThemeSection 的说明文案)
    expect(screen.getByText(/选择预设主题或自定义 accent 色/)).toBeInTheDocument();
  });

  it('switches content when clicking a menu item', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={() => {}} />);
    // 点击「通用」菜单
    await user.click(screen.getByRole('button', { name: /通用/ }));
    expect(screen.getByLabelText(/最大历史数/)).toBeInTheDocument();
    // 点击「快捷键」菜单
    await user.click(screen.getByRole('button', { name: /快捷键/ }));
    expect(screen.getByLabelText(/打开命令面板/)).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when clicking close button', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SettingsDialog open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: /关闭设置/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('drags the dialog via the title bar', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const title = within(dialog).getByText('设置');
    const titleBar = title.closest('div') as HTMLElement;

    const initialLeft = Number.parseFloat(dialog.style.left);
    const initialTop = Number.parseFloat(dialog.style.top);

    const startX = 500;
    const startY = 300;
    fireEvent.pointerDown(titleBar, { button: 0, clientX: startX, clientY: startY, pointerId: 1 });
    fireEvent.pointerMove(titleBar, { clientX: startX + 80, clientY: startY + 50, pointerId: 1 });
    fireEvent.pointerUp(titleBar, { pointerId: 1 });

    // 拖拽后弹窗向右/向下移动,但被 clamp 到视口内(jsdom 视口 1024x768)
    const maxLeft = 1024 - 880 - 16;
    const maxTop = 768 - 620 - 16;
    expect(dialog.style.left).toBe(`${Math.min(initialLeft + 80, maxLeft)}px`);
    expect(dialog.style.top).toBe(`${Math.min(initialTop + 50, maxTop)}px`);
    // 位置必须发生变化,证明拖拽生效
    expect(dialog.style.left).not.toBe(`${initialLeft}px`);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AboutDialog } from './AboutDialog';
import { CHANGELOG_VERSIONS } from '@/lib/changelog';
import { changeLocale } from '@/i18n';

describe('AboutDialog', () => {
  it('en-US:更新日志摘要/描述与组件描述随语言切换(手动切语言场景),结束恢复 zh 桩', async () => {
    const user = userEvent.setup();
    changeLocale('en-US');
    // 先卸载再切回 zh 桩,避免异步 languageChanged 在 act 环境外触发告警更新
    const { unmount } = render(<AboutDialog open onOpenChange={() => {}} />);
    try {
      await user.click(screen.getByRole('button', { name: /Changelog/ }));
      const latest = CHANGELOG_VERSIONS[0];
      expect(screen.getByText(latest.summary.en)).toBeInTheDocument();
      expect(screen.getByText(latest.changes[0]!.description.en)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Components/ }));
      expect(screen.getByText('Declarative library for building user interfaces')).toBeInTheDocument();
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });
  it('en-US:导航/标题随语言切换(手动切语言场景),结束恢复 zh 桩', () => {
    changeLocale('en-US');
    // 先卸载再切回 zh 桩,避免异步 languageChanged 在 act 环境外触发告警更新
    const { unmount } = render(<AboutDialog open onOpenChange={() => {}} />);
    try {
      expect(screen.getByRole('button', { name: /App info/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Changelog/ })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'App info' })).toBeInTheDocument();
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });
  it('shows left nav with four categories and info content by default', () => {
    render(<AboutDialog open onOpenChange={() => {}} />);
    // 左侧导航四分区
    expect(screen.getByRole('button', { name: /应用信息/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /更新日志/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开源许可/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开源组件/ })).toBeInTheDocument();
    // 默认展示应用信息:名称(标题 + 信息条目)+ 描述 + 版本号(Badge + 信息条目)
    expect(screen.getAllByText('Qraft').length).toBeGreaterThan(0);
    expect(screen.getByText(/本地优先的开发者工具箱/)).toBeInTheDocument();
    // 版本号由 Vite/vitest 从 package.json 注入(__APP_VERSION__)
    expect(screen.getAllByText(`v${__APP_VERSION__}`).length).toBeGreaterThan(0);
  });

  it('switches to changelog section with latest entry', async () => {
    const user = userEvent.setup();
    render(<AboutDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /更新日志/ }));
    // 区块标题(精确匹配,避免命中折叠触发器中 summary 文本的"更新日志"字样)
    const changelog = screen.getByRole('heading', { name: '更新日志' });
    expect(changelog).toBeInTheDocument();
    // 首个版本默认展开,展示版本号与摘要(summary 为 LocalizedText,zh 桩下取 zh 半边)
    const latest = CHANGELOG_VERSIONS[0];
    expect(screen.getByText(`v${latest.version}`)).toBeInTheDocument();
    expect(screen.getByText(latest.summary.zh)).toBeInTheDocument();
    // 变更条目展示类别标签与描述
    for (const change of latest.changes.slice(0, 3)) {
      expect(screen.getByText(change.description.zh)).toBeInTheDocument();
    }
  });

  it('switches to licenses section', async () => {
    const user = userEvent.setup();
    render(<AboutDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /开源许可/ }));
    expect(screen.getByText(/本应用使用的部分开源软件及其许可证/)).toBeInTheDocument();
    // 精选许可条目
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Tauri')).toBeInTheDocument();
  });

  it('switches to components section with frontend/rust tabs', async () => {
    const user = userEvent.setup();
    render(<AboutDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /开源组件/ }));
    expect(screen.getByText(/前端 .* \+ Rust .* 个/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /前端依赖/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Rust 依赖/ })).toBeInTheDocument();
    // 默认展示前端依赖
    expect(screen.getByText('react')).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when clicking close button', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<AboutDialog open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: /关闭关于/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

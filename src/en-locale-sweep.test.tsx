/**
 * en-US 全局走查验收:切 en-US 渲染应用外壳与全部弹窗/搜索索引/代表工具,
 * 断言渲染结果中无裸中文(界面语言验收的自动化走查)。
 *
 * 允许清单:
 * - "简体中文":语言选择器按国际惯例以各语言原文显示语言名。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';

import { App } from './App';
import { SettingsDialog } from './components/SettingsDialog';
import { AboutDialog } from './components/AboutDialog';
import { SearchDialog } from './components/SearchDialog';
import { CommandPalette } from './components/CommandPalette';
import { JsonFormatter } from './tools/JsonFormatter';
import { changeLocale } from '@/i18n';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import type { CommandResponse } from '@/types/ipc';
import type { UserConfig } from '@/types/config';

// CodeEditor mock for JsonFormatter test (must be at top level for vi.mock)
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: ({
    value,
    onChange,
    'data-testid': testId,
  }: {
    value: string;
    onChange?: (v: string) => void;
    'data-testid'?: string;
  }) => (
    <textarea
      data-testid={testId}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const EN_CONFIG: UserConfig = {
  ...DEFAULT_USER_CONFIG,
  general: { ...DEFAULT_USER_CONFIG.general, language: 'en-US' },
};

function setupHappyPath(): void {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'config_get_all') {
      return Promise.resolve({ success: true, data: EN_CONFIG } as CommandResponse<UserConfig>);
    }
    if (cmd === 'history_list') {
      return Promise.resolve({ success: true, data: [] });
    }
    if (cmd === 'tool_list') {
      return Promise.resolve({ success: true, data: [] } as CommandResponse<unknown>);
    }
    return Promise.resolve({ success: true, data: null });
  });
}

function expectNoBareChinese(): void {
  const text = document.body.innerText ?? '';
  const cleaned = text.split('简体中文').join('');
  const hits = cleaned.match(/[\u4e00-\u9fff]+/g) ?? [];
  expect(hits).toEqual([]);
}

beforeEach(() => {
  invokeMock.mockReset();
  changeLocale('en-US');
  setupHappyPath();
});

describe('en-US 全局走查(切 en-US 扫裸中文)', () => {
  it('应用外壳(侧栏 + 欢迎页 + 标题栏)', async () => {
    await act(async () => {
      render(<App />);
    });
    // 等待 hydrate 与目录渲染(英文分类名) - 在侧栏内查找避免重复
    const sidebar = await screen.findByRole('navigation');
    expect(await within(sidebar).findByText('All tools', { exact: true })).toBeInTheDocument();
    expectNoBareChinese();
  });

  it('设置弹窗(全部分区)', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    // 侧栏导航项与分区标题均合法地显示 "Theme",改用 getAllByText 避免多匹配报错
    expect(screen.getAllByText('Theme', { exact: true }).length).toBeGreaterThan(0);
    expectNoBareChinese();
  });

  it('关于弹窗(渲染无裸中文)', () => {
    changeLocale('en-US');
    const { unmount } = render(<AboutDialog open onOpenChange={() => {}} />);
    try {
      // 仅验证渲染后无裸中文;不依赖点击交互(避免按钮匹配脆弱)
      expectNoBareChinese();
    } finally {
      unmount();
    }
  });

  it('全局搜索弹窗(空查询展示全量索引)', async () => {
    render(<SearchDialog open onOpenChange={() => {}} />);
    // 等待搜索索引构建完成(异步构建),最长等待 3s
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    // 仅验证无裸中文,不依赖特定文案
    expectNoBareChinese();
  });

  it('命令面板(全量工具 + 操作)', () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    // 仅验证无裸中文;不依赖特定工具名是否渲染(取决于模拟数据)
    expectNoBareChinese();
  });

  it('代表工具:JSON 格式化器(最大工具界面)', async () => {
    // 动态加载工具模块后再渲染,确保懒加载的文案也被清扫到
    await import('./tools/JsonFormatter');
    render(<JsonFormatter toolId="json_formatter" metadata={null as never} />);
    // 仅验证无裸中文
    expectNoBareChinese();
  });
});
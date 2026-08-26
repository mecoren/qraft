import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, value: true }),
  listen: vi.fn().mockResolvedValue(() => {}),
  normalizeIpcError: vi.fn((e: Error) => e.message),
}));

import { GeneralSection } from './SettingsPanel';
import { changeLocale, getLocale } from '@/i18n';
import { useConfigStore } from '@/store/configStore';

function seedConfig(language: string): void {
  useConfigStore.setState({
    config: {
      version: 1,
      general: {
        maxHistory: 100,
        jsonIndent: 2,
        confirmOnClear: true,
        fontSize: 14,
        language,
      },
    } as never,
  });
}

describe('GeneralSection 语言切换', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedConfig('zh-CN');
    // 语言切换测试会把 locale 切到 en-US;每个用例前恢复 zh 桩,
    // 保证依赖中文 label 的查询不受前一用例影响
    changeLocale('zh-CN');
  });

  // 语言下拉的 label 随当前 locale 渲染(zh:「界面语言 / Language」/ en:「Language / 界面语言」),
  // 前序用例经 UI 切换后可能残留 en;查询统一用双语正则,不依赖语言恢复时序
  const languageTrigger = (): HTMLElement => screen.getByLabelText(/界面语言|Language/);

  /** shadcn Select 交互:jsdom 下经键盘开启(Radix 对 ArrowDown 可靠),再点选目标项 */
  const chooseLanguage = async (name: string): Promise<void> => {
    const trigger = languageTrigger();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name }));
  };

  it('渲染语言下拉且默认 zh-CN', () => {
    render(<GeneralSection />);
    expect(languageTrigger()).toHaveTextContent('简体中文');
  });

  it('切换下拉即时预览 i18n locale', async () => {
    render(<GeneralSection />);
    await chooseLanguage('English');
    expect(getLocale()).toBe('en-US');
  });

  it('保存时写入 general.language 配置', async () => {
    const { invokeCommand, safeInvoke } = await import('@/lib/ipc');
    const all = [
      invokeCommand as unknown as ReturnType<typeof vi.fn>,
      safeInvoke as unknown as ReturnType<typeof vi.fn>,
    ];
    for (const m of all) m.mockResolvedValue({ ok: true, value: true });
    render(<GeneralSection />);
    await chooseLanguage('English');
    fireEvent.click(screen.getByRole('button', { name: /保存|Save/ }));
    await waitFor(() => {
      const flat = all.flatMap((m) => m.mock.calls.map((c) => JSON.stringify(c)));
      expect(flat.some((c) => c.includes('general.language') && c.includes('en-US'))).toBe(true);
    });
  });
});

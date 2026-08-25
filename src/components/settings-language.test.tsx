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
import { getLocale } from '@/i18n';
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
  });

  it('渲染语言下拉且默认 zh-CN', () => {
    render(<GeneralSection />);
    const select = screen.getByLabelText('界面语言 / Language') as HTMLSelectElement;
    expect(select.value).toBe('zh-CN');
  });

  it('切换下拉即时预览 i18n locale', async () => {
    render(<GeneralSection />);
    fireEvent.change(screen.getByLabelText('界面语言 / Language'), {
      target: { value: 'en-US' },
    });
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
    fireEvent.change(screen.getByLabelText('界面语言 / Language'), {
      target: { value: 'en-US' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const flat = all.flatMap((m) => m.mock.calls.map((c) => JSON.stringify(c)));
      expect(flat.some((c) => c.includes('general.language') && c.includes('en-US'))).toBe(true);
    });
  });
});

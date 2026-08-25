import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  invokeCommand: vi.fn(),
  safeInvoke: vi.fn(),
}));

import { useConfigStore } from './configStore';
import { getLocale } from '@/i18n';

describe('configStore locale 同步(general.language 激活)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.setState({ config: null, loading: false, error: null });
  });

  it('setConfig("general.language") 同时切换 i18n locale', async () => {
    const { safeInvoke } = await import('@/lib/ipc');
    (safeInvoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, value: true });
    // 先注入一份非空配置使乐观更新分支生效
    useConfigStore.setState({
      config: {
        general: {
          maxHistory: 100,
          jsonIndent: 2,
          confirmOnClear: true,
          language: 'zh-CN',
        },
      } as never,
    });
    await useConfigStore.getState().setConfig('general.language', 'en-US');
    expect(getLocale()).toBe('en-US');
    await useConfigStore.getState().setConfig('general.language', 'zh-CN');
    expect(getLocale()).toBe('zh-CN');
  });

  it('loadConfig 加载的配置携带语言时同步 i18n', async () => {
    const { safeInvoke } = await import('@/lib/ipc');
    (safeInvoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        general: {
          language: 'en-US',
          maxHistory: 100,
          jsonIndent: 2,
          confirmOnClear: true,
        },
      },
    });
    await useConfigStore.getState().loadConfig();
    expect(getLocale()).toBe('en-US');
  });
});

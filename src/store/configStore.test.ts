import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useConfigStore } from './configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import type { CommandResponse, ConfigChangedPayload } from '@/types/ipc';
import type { UserConfig } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  // 重置 store 至初始状态
  useConfigStore.setState({
    config: null,
    loading: false,
    error: null,
  });
});

describe('configStore.loadConfig', () => {
  it('sets config from config_get_all success response', async () => {
    const cfg: UserConfig = { ...DEFAULT_USER_CONFIG, version: 7 };
    invokeMock.mockResolvedValueOnce({
      success: true,
      data: cfg,
    } satisfies CommandResponse<UserConfig>);

    await useConfigStore.getState().loadConfig();

    expect(useConfigStore.getState().config?.version).toBe(7);
    expect(useConfigStore.getState().loading).toBe(false);
    expect(useConfigStore.getState().error).toBeNull();
  });

  it('sets error message when response.success is false', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_CONFIG_IO', message: 'disk full' },
    } satisfies CommandResponse<UserConfig>);

    await useConfigStore.getState().loadConfig();

    expect(useConfigStore.getState().config).toBeNull();
    expect(useConfigStore.getState().error).toBe('disk full');
  });

  it('sets error when invoke throws', async () => {
    invokeMock.mockRejectedValueOnce(new Error('tauri down'));
    await useConfigStore.getState().loadConfig();
    expect(useConfigStore.getState().error).toContain('tauri down');
  });
});

describe('configStore.setConfig', () => {
  it('calls config_set with key and value', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    await useConfigStore.getState().setConfig('theme.mode', 'dark');
    expect(invokeMock).toHaveBeenCalledWith('config_set', {
      key: 'theme.mode',
      value: 'dark',
    });
  });

  it('optimistically updates nested config when loaded', async () => {
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG } });
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    await useConfigStore.getState().setConfig('general.fontSize', 18);
    expect(useConfigStore.getState().config?.general.fontSize).toBe(18);
  });

  it('returns error info on failure without throwing', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_CONFIG_IO', message: 'read only' },
    });
    const r = await useConfigStore.getState().setConfig('x', 1);
    expect(r.ok).toBe(false);
  });
});

describe('configStore.applyConfigChanged', () => {
  it('updates nested key via dot path', () => {
    useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG } });
    const p: ConfigChangedPayload = {
      key: 'theme.mode',
      oldValue: 'dark',
      newValue: 'light',
    };
    useConfigStore.getState().applyConfigChanged(p);
    expect(useConfigStore.getState().config?.theme.mode).toBe('light');
  });
});

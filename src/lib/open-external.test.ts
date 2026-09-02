import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ipc', () => ({
  invokeCommand: vi.fn(),
}));

import { invokeCommand } from './ipc';
import { openExternal } from './open-external';

const invokeCommandMock = invokeCommand as unknown as ReturnType<typeof vi.fn>;

function enableTauri(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
    writable: true,
  });
}

function disableTauri(): void {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

beforeEach(() => {
  disableTauri();
  invokeCommandMock.mockReset();
});

afterEach(() => {
  disableTauri();
  vi.restoreAllMocks();
});

describe('openExternal', () => {
  it('Tauri 环境经 app_open_external 打开 http/https 链接', async () => {
    enableTauri();
    invokeCommandMock.mockResolvedValueOnce(undefined);

    await expect(openExternal('https://example.com')).resolves.toBe(true);

    expect(invokeCommandMock).toHaveBeenCalledWith('app_open_external', {
      url: 'https://example.com',
    });
  });

  it('Web 环境使用 window.open 且带 noopener/noreferrer', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(openExternal('http://example.com')).resolves.toBe(true);

    expect(open).toHaveBeenCalledWith('http://example.com', '_blank', 'noopener,noreferrer');
  });

  it('拒绝非 http/https URL 且不调用任何打开入口', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(openExternal('file:///C:/secret.txt')).resolves.toBe(false);

    expect(invokeCommandMock).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

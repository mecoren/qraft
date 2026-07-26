import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useClipboard } from './useClipboard';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
});

describe('useClipboard', () => {
  it('read returns text on success', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: 'clip-text' });
    const { result } = renderHook(() => useClipboard());
    let value = '';
    await act(async () => {
      value = await result.current.read();
    });
    expect(value).toBe('clip-text');
    expect(invokeMock).toHaveBeenCalledWith('clipboard_read_text', {});
  });

  it('read returns empty string on failure', async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR_CLIPBOARD_UNAVAILABLE', message: 'no clipboard' },
    });
    const { result } = renderHook(() => useClipboard());
    let value = 'sentinel';
    await act(async () => {
      value = await result.current.read();
    });
    expect(value).toBe('');
  });

  it('write calls clipboard_write_text with text', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, data: true });
    const { result } = renderHook(() => useClipboard());
    let ok = false;
    await act(async () => {
      ok = await result.current.write('hello');
    });
    expect(ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('clipboard_write_text', {
      text: 'hello',
    });
  });

  it('canRead flag defaults to true', () => {
    const { result } = renderHook(() => useClipboard());
    expect(result.current.canRead).toBe(true);
  });
});

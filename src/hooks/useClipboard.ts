import { useCallback, useState } from 'react';
import { safeInvoke } from '@/lib/ipc';

export interface UseClipboardResult {
  canRead: boolean;
  read: () => Promise<string>;
  write: (text: string) => Promise<boolean>;
}

/**
 * 剪贴板 Hook,所有读写均通过 Rust 侧命令,不在 JS 直接访问 navigator.clipboard,
 * 以便统一权限与跨平台行为(见 13-security.md)。
 */
export function useClipboard(): UseClipboardResult {
  // MVP 默认可读;若 Rust 报 ERR_CLIPBOARD_UNAVAILABLE,UI 可降级
  const [canRead] = useState(true);

  const read = useCallback(async () => {
    const r = await safeInvoke<string>('clipboard_read_text', {});
    return r.ok ? r.value : '';
  }, []);

  const write = useCallback(async (text: string) => {
    const r = await safeInvoke<boolean>('clipboard_write_text', { text });
    return r.ok ? r.value : false;
  }, []);

  return { canRead, read, write };
}

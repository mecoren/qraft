/**
 * 剪贴板辅助(带降级链)
 *
 * 读取优先级:
 * 1. navigator.clipboard(浏览器 / dev 环境直接可用)
 * 2. Tauri IPC clipboard_read_text(生产环境,经 Rust 统一权限)
 *
 * 写入优先级同理。全部失败时返回空串 / false,由调用方提示。
 */

import { safeInvoke } from '@/lib/ipc';

/** 读取剪贴板文本,失败返回空字符串 */
export async function readClipboardText(): Promise<string> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      return text;
    }
  } catch {
    // 权限拒绝或非安全上下文,继续尝试 IPC
  }
  const r = await safeInvoke<string>('clipboard_read_text', {});
  return r.ok ? r.value : '';
}

/** 写入剪贴板文本,成功返回 true */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续尝试 IPC
  }
  const r = await safeInvoke<boolean>('clipboard_write_text', { text });
  return r.ok ? r.value : false;
}

/**
 * 写入富文本(HTML + 纯文本降级),供「复制为富文本」使用。
 *
 * 优先 ClipboardItem(navigator.clipboard.write);失败时回退到
 * 隐藏 contenteditable 选区 + execCommand('copy')(WebView2 兼容路径)。
 */
export async function writeClipboardRichText(html: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof ClipboardItem !== 'undefined'
    ) {
      const plain = html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    // 继续走 execCommand 降级
  }
  try {
    const container = document.createElement('div');
    container.setAttribute('contenteditable', 'true');
    container.style.position = 'fixed';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.innerHTML = html;
    document.body.appendChild(container);
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const ok = document.execCommand('copy');
    selection?.removeAllRanges();
    container.remove();
    return ok;
  } catch {
    return false;
  }
}

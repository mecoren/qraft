import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternal } from './open-external';
import { installGlobalLinkHandler } from './global-link-handler';

vi.mock('./open-external', () => ({
  openExternal: vi.fn().mockResolvedValue(true),
}));

let removeHandler: (() => void) | undefined;

beforeEach(() => {
  removeHandler = installGlobalLinkHandler();
  vi.mocked(openExternal).mockClear();
});

afterEach(() => {
  removeHandler?.();
  removeHandler = undefined;
  document.body.innerHTML = '';
});

function createLink(href: string, download = false): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = href;
  if (download) anchor.download = 'result.txt';
  document.body.appendChild(anchor);
  return anchor;
}

function clickLink(
  anchor: HTMLAnchorElement,
  init: MouseEventInit,
): { event: MouseEvent; listener: ReturnType<typeof vi.fn> } {
  const listener = vi.fn();
  anchor.addEventListener('click', listener);
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  anchor.dispatchEvent(event);
  return { event, listener };
}

describe('installGlobalLinkHandler', () => {
  it('Ctrl+左键打开 http 链接并阻止既有点击处理', () => {
    const anchor = createLink('http://example.com');
    const result = clickLink(anchor, { button: 0, ctrlKey: true });

    expect(result.event.defaultPrevented).toBe(true);
    expect(result.listener).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('http://example.com');
  });

  it('Cmd+左键同样打开 https 链接', () => {
    const anchor = createLink('https://example.com');
    clickLink(anchor, { button: 0, metaKey: true });

    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('普通点击、右键和组合修饰键不触发外部打开', () => {
    const anchor = createLink('https://example.com');

    clickLink(anchor, { button: 0 });
    clickLink(anchor, { button: 2, ctrlKey: true });
    clickLink(anchor, { button: 0, ctrlKey: true, shiftKey: true });
    clickLink(anchor, { button: 0, ctrlKey: true, altKey: true });

    expect(openExternal).not.toHaveBeenCalled();
  });

  it('非 http/https 链接和下载链接不触发外部打开', () => {
    const mailto = createLink('mailto:a@b.com');
    const hash = createLink('#section');
    const download = createLink('https://example.com/result.txt', true);

    clickLink(mailto, { button: 0, ctrlKey: true });
    clickLink(hash, { button: 0, ctrlKey: true });
    clickLink(download, { button: 0, ctrlKey: true });

    expect(openExternal).not.toHaveBeenCalled();
  });
});

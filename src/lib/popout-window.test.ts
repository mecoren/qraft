import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { toast } from 'sonner';

/**
 * popout-window 单元测试:覆盖 Tauri 模式(查重聚焦/建窗参数/失败 toast)
 * 与 Web 模式(成功 open/被拦截 toast)两条路径。
 */

interface OnceCall {
  event: string;
  cb: (e: { payload?: unknown }) => void;
}

const stubs = vi.hoisted(() => {
  const instances: WebviewWindowStub[] = [];
  class WebviewWindowStub {
    static getByLabel = vi.fn<(label: string) => Promise<WebviewWindowStub | null>>();
    label: string;
    options: Record<string, unknown>;
    onceCalls: OnceCall[] = [];
    constructor(label: string, options: Record<string, unknown>) {
      this.label = label;
      this.options = options;
      instances.push(this);
    }
    once(event: string, cb: (e: { payload?: unknown }) => void): Promise<() => void> {
      this.onceCalls.push({ event, cb });
      return Promise.resolve(() => {});
    }
    emit(event: string, payload?: unknown): void {
      for (const call of this.onceCalls) {
        if (call.event === event) call.cb({ payload });
      }
    }
  }
  return { instances, WebviewWindowStub };
});

class WebviewWindowStub extends stubs.WebviewWindowStub {}

vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: WebviewWindowStub }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

import {
  DEFAULT_POPOUT_HEIGHT,
  DEFAULT_POPOUT_WIDTH,
  POPOUT_QUERY_KEY,
  getPopoutUrl,
  isPopoutSupported,
  openToolInNewWindow,
  popoutWindowLabel,
} from './popout-window';

type ExistingWindowStub = {
  unminimize: ReturnType<typeof vi.fn>;
  setFocus: ReturnType<typeof vi.fn>;
};

/** jsdom 下模拟 Tauri 运行时标记 */
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
  stubs.instances.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  disableTauri();
  vi.restoreAllMocks();
});

describe('popout-window 基础工具函数', () => {
  it('popoutWindowLabel 生成每工具唯一 label', () => {
    expect(popoutWindowLabel('base64_codec')).toBe('popout-base64_codec');
  });

  it('getPopoutUrl 携带 popout 查询参数并编码 toolId', () => {
    expect(getPopoutUrl('base64_codec')).toBe(`index.html?${POPOUT_QUERY_KEY}=base64_codec`);
  });

  it('isPopoutSupported:普通工具允许,应用内特殊页面不允许', () => {
    expect(isPopoutSupported('base64_codec')).toBe(true);
    expect(isPopoutSupported('settings')).toBe(false);
    expect(isPopoutSupported('not_exist')).toBe(false);
  });
});

describe('openToolInNewWindow —— Tauri 模式', () => {
  it('已有同 label 窗口时聚焦复用,不重复创建', async () => {
    enableTauri();
    const existing = {
      unminimize: vi.fn(),
      setFocus: vi.fn(),
    } as unknown as ExistingWindowStub;
    WebviewWindowStub.getByLabel.mockResolvedValue(existing as never);

    await openToolInNewWindow('base64_codec');

    expect(existing.unminimize).toHaveBeenCalledTimes(1);
    expect(existing.setFocus).toHaveBeenCalledTimes(1);
    expect(stubs.instances).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('无既有窗口时按目录尺寸创建 WebviewWindow', async () => {
    enableTauri();
    WebviewWindowStub.getByLabel.mockResolvedValue(null);

    const pending = openToolInNewWindow('text_compare');
    // 动态 import + getByLabel 属异步链,等建窗实例出现后再确认结果事件
    await waitFor(() => expect(stubs.instances.length).toBe(1));
    stubs.instances[0]!.emit('tauri://created');
    await pending;

    expect(stubs.instances).toHaveLength(1);
    const win = stubs.instances[0]!;
    expect(win.label).toBe('popout-text_compare');
    expect(win.options.url).toBe(`index.html?${POPOUT_QUERY_KEY}=text_compare`);
    // text_compare 在目录中配置了 1100×720 的大窗口
    expect(win.options.width).toBe(1100);
    expect(win.options.height).toBe(720);
    expect(win.options.minWidth).toBe(480);
    expect(win.options.minHeight).toBe(360);
    expect(win.options.decorations).toBe(false);
    expect(win.options.resizable).toBe(true);
    expect(String(win.options.title)).toContain('文本比较');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('目录未配置尺寸时使用默认 900×640', async () => {
    enableTauri();
    WebviewWindowStub.getByLabel.mockResolvedValue(null);

    const pending = openToolInNewWindow('base64_codec');
    await waitFor(() => expect(stubs.instances.length).toBe(1));
    stubs.instances[0]!.emit('tauri://created');
    await pending;

    expect(stubs.instances[0]?.options.width).toBe(DEFAULT_POPOUT_WIDTH);
    expect(stubs.instances[0]?.options.height).toBe(DEFAULT_POPOUT_HEIGHT);
  });

  it('创建失败(tauri://error)时 toast.error 反馈', async () => {
    enableTauri();
    WebviewWindowStub.getByLabel.mockResolvedValue(null);

    const pending = openToolInNewWindow('base64_codec');
    await waitFor(() => expect(stubs.instances.length).toBe(1));
    stubs.instances[0]!.emit('tauri://error', new Error('denied'));
    await pending;

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('特殊页面与未知工具不触发任何窗口操作', async () => {
    enableTauri();
    await openToolInNewWindow('settings');
    await openToolInNewWindow('not_exist');
    expect(WebviewWindowStub.getByLabel).not.toHaveBeenCalled();
    expect(stubs.instances).toHaveLength(0);
  });
});

describe('openToolInNewWindow —— Web 模式', () => {
  it('window.open 成功时以带尺寸的 popup 特性打开,无 toast', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(window as never);
    disableTauri();

    await openToolInNewWindow('base64_codec');

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0] as unknown as [string, string, string];
    expect(url).toContain(`${POPOUT_QUERY_KEY}=base64_codec`);
    expect(target).toBe('_blank');
    expect(features).toContain(`width=${DEFAULT_POPOUT_WIDTH}`);
    expect(features).toContain(`height=${DEFAULT_POPOUT_HEIGHT}`);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('window.open 返回 null(被浏览器拦截)时 toast.warning 提示', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    disableTauri();

    await openToolInNewWindow('base64_codec');

    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

import 'reflect-metadata';
import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import React from 'react';
import { cleanup } from '@testing-library/react';

// jsdom 在 about:blank URL 下不提供 localStorage,且 Node 22+ 的实验性 localStorage
// 全局会与之冲突(输出 "localStorage is not available")。
// 这里注入一个内存版 Storage,供 zustand persist / color-theme 等模块在测试中使用。
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}
vi.stubGlobal('localStorage', new MemoryStorage());
vi.stubGlobal('sessionStorage', new MemoryStorage());

// 每个测试后清理 DOM,避免状态泄漏
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // 清空 localStorage,避免 zustand persist 持久化数据跨测试泄漏
  localStorage.clear();
  sessionStorage.clear();
});

// Mock @tauri-apps/api/core 的 invoke,避免 jsdom 调用真实 IPC
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @monaco-editor/react:jsdom 无法加载真实 Monaco(依赖 web worker 与丰富 DOM API)
// 将 Editor 渲染为受控 textarea、DiffEditor 渲染为两个 textarea,
// 保留 value/onChange 等关键 props,使工具测试可以用 fireEvent.change 触发输入
vi.mock('@monaco-editor/react', () => ({
  default: function MockMonacoEditor(props: {
    value?: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
  }) {
    return React.createElement('textarea', {
      value: props.value ?? '',
      readOnly: props.readOnly,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange?.(e.target.value),
    });
  },
  DiffEditor: function MockMonacoDiffEditor(props: {
    original?: string;
    modified?: string;
    readOnly?: boolean;
  }) {
    return React.createElement(
      'div',
      { 'data-testid': 'monaco-diff-editor' },
      React.createElement('textarea', {
        value: props.original ?? '',
        readOnly: props.readOnly,
      }),
      React.createElement('textarea', {
        value: props.modified ?? '',
        readOnly: props.readOnly,
      }),
    );
  },
}));

// Mock @tauri-apps/api/event 的 listen,返回空 unlisten
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock @tauri-apps/api/window:jsdom 无真实窗口,模拟窗口控制 API
// 供自定义标题栏(WindowControls / useMaximized)在测试中调用不报错
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    show: vi.fn().mockResolvedValue(undefined),
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
  }),
}));

// jsdom 不提供 ResizeObserver,Radix ScrollArea / Select / @tanstack/react-virtual 依赖它
// observe 时立即触发一次回调,给出非零尺寸,使虚拟列表能渲染可见行
class ResizeObserverMock {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    // 补充 borderBoxSize/contentBoxSize:react-resizable-panels 会读取
    // entry.borderBoxSize[0].inlineSize 来计算面板尺寸,缺失会导致运行时崩溃
    this.cb(
      [
        {
          target,
          contentRect: {
            width: 800,
            height: 600,
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 800,
            bottom: 600,
          },
          borderBoxSize: [{ inlineSize: 800, blockSize: 600 }],
          contentBoxSize: [{ inlineSize: 800, blockSize: 600 }],
        },
      ] as unknown as ResizeObserverEntry[],
      this,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

// jsdom 不提供 DOMMatrix,部分 Radix 浮层依赖
class DOMMatrixReadOnlyMock {
  constructor() {}
  static fromRect(): DOMMatrixReadOnlyMock {
    return new DOMMatrixReadOnlyMock();
  }
}
vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixReadOnlyMock);

// jsdom 不实现 Element.scrollIntoView,cmdk/Radix 选中项滚动依赖它
Element.prototype.scrollIntoView = () => {};

// jsdom 默认 getBoundingClientRect 返回全 0,@tanstack/react-virtual 据此计算可见行
// 这里覆盖为非零尺寸,使虚拟列表在测试中能渲染可见行
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  // 仅对显式调用者返回非零尺寸,保留原始行为用于其他场景
  const original = originalGetBoundingClientRect.call(this);
  if (original.width === 0 && original.height === 0) {
    return {
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      toJSON: () => ({}),
    };
  }
  return original;
};

// 虚拟列表通过 scrollElement.clientHeight/offsetHeight 判断可视区高度
// jsdom 中这些属性定义在 HTMLElement.prototype 上,需在该层级覆盖
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return 600;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return 600;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return 800;
  },
});

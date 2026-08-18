/**
 * EditorTabsBar 单元测试 —— 对比差异 Tab
 *
 * 验证:
 * - 对比项渲染为 Tab(标题 a.ts ⟷ b.ts,带对比图标)
 * - 点击对比 Tab 分发 onSelectCompare 并激活
 * - 关闭按钮分发 onCloseCompare,且不触发切换
 * - 无对比项时不渲染对比 Tab
 * - 仅有对比项时不再显示「无打开的编辑器」空态
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorTabsBar, type EditorTabsBarProps } from './EditorTabsBar';
import type { ComparePair, EditorTab } from './schema';

const tabs: EditorTab[] = [
  {
    id: 't1',
    title: 'a.ts',
    path: 'C:/dev/a.ts',
    language: 'typescript',
    content: 'a',
    savedContent: 'a',
    pinned: false,
  },
  {
    id: 't2',
    title: 'b.ts',
    path: 'C:/dev/b.ts',
    language: 'typescript',
    content: 'b',
    savedContent: 'b',
    pinned: false,
  },
];

const compare: ComparePair = {
  id: 'c1',
  leftTabId: 't1',
  rightTabId: 't2',
};

function setup(props: Partial<EditorTabsBarProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onSelectCompare: vi.fn(),
    onCloseCompare: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseRight: vi.fn(),
    onCloseSaved: vi.fn(),
    onCloseAll: vi.fn(),
    onTogglePin: vi.fn(),
    onReorder: vi.fn(),
    onSave: vi.fn(),
    onRevealInExplorer: vi.fn(),
    onCopyPath: vi.fn(),
  };
  render(
    <EditorTabsBar
      tabs={tabs}
      activeTabId="t1"
      compares={[compare]}
      {...handlers}
      {...props}
      data-testid="tabs"
    />,
  );
  return handlers;
}

describe('EditorTabsBar 对比差异 Tab', () => {
  it('对比项渲染为 Tab,显示标题与对比图标', () => {
    setup();

    const tab = screen.getByTestId('tabs-compare-tab-c1');
    expect(tab).toHaveTextContent('a.ts ⟷ b.ts');
    expect(screen.getByTestId('tabs-compare-icon-c1')).toBeInTheDocument();
  });

  it('点击对比 Tab 分发 onSelectCompare', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tabs-compare-tab-c1'));

    expect(handlers.onSelectCompare).toHaveBeenCalledWith('c1');
  });

  it('激活的对比 Tab 标记 aria-selected', () => {
    setup({ activeCompareId: 'c1' });

    expect(screen.getByTestId('tabs-compare-tab-c1')).toHaveAttribute('aria-selected', 'true');
  });

  it('点击关闭按钮分发 onCloseCompare,且不触发切换', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tabs-compare-close-c1'));

    expect(handlers.onCloseCompare).toHaveBeenCalledWith('c1');
    expect(handlers.onSelectCompare).not.toHaveBeenCalled();
  });

  it('无对比项时不渲染对比 Tab', () => {
    setup({ compares: [] });

    expect(screen.queryByTestId('tabs-compare-tab-c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('tabs-tab-a.ts')).toBeInTheDocument();
  });

  it('仅有对比项且无普通 Tab 时,不显示空态', () => {
    setup({ tabs: [], compares: [compare], activeTabId: null });

    expect(screen.queryByTestId('tabs-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('tabs-compare-tab-c1')).toBeInTheDocument();
  });

  it('普通 Tab 与对比 Tab 可共存', () => {
    setup();

    expect(screen.getByTestId('tabs-tab-a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-tab-b.ts')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-compare-tab-c1')).toBeInTheDocument();
  });
});

describe('EditorTabsBar Tab 拖拽排序', () => {
  afterEach(() => {
    // 还原本 describe 内 spyOn 的 getBoundingClientRect
    vi.restoreAllMocks();
  });

  /**
   * 全局伪造 getBoundingClientRect:按 data-testid 返回稳定布局。
   * 不直接 mock 某个节点引用,因为拖拽触发的重渲染可能产生新的 DOM 节点,
   * 而每次查询都是「当前 DOM 中的节点」,按 testid 匹配最可靠。
   */
  function mockRects() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const testid = this.getAttribute('data-testid') ?? '';
      // b.ts 从 x=100 开始,其余从 x=0 开始,宽度均为 120
      const left = testid === 'tabs-tab-b.ts' ? 100 : 0;
      return {
        left,
        top: 0,
        right: left + 120,
        bottom: 36,
        width: 120,
        height: 36,
        x: left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  }

  /**
   * 手动分发 Pointer 事件。
   * jsdom 的 Event 构造器不支持 button / clientX / clientY 选项,
   * 需要以 defineProperty 写入事件对象,React 合成事件才能读到。
   */
  function dispatchPointer(
    type: string,
    el: HTMLElement,
    opts: { clientX?: number; clientY?: number; button?: number } = {},
  ) {
    // act 包裹:dispatchEvent 触发的事件处理器可能引起 React 状态更新(如 dragId/dropBeforeId)
    act(() => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'button', { value: opts.button ?? 0, configurable: true });
      Object.defineProperty(event, 'clientX', { value: opts.clientX ?? 0, configurable: true });
      Object.defineProperty(event, 'clientY', { value: opts.clientY ?? 0, configurable: true });
      el.dispatchEvent(event);
    });
  }

  /** 完整拖拽序列:按下(原点)→ 移动(越过阈值)→ 松手 */
  function dragSequence(src: HTMLElement, x: number) {
    dispatchPointer('pointerdown', src, { clientX: 0, clientY: 0 });
    dispatchPointer('pointermove', src, { clientX: x, clientY: 0 });
    dispatchPointer('pointerup', src, { clientX: x, clientY: 0 });
  }

  it('拖到目标 Tab 左半区:onReorder 以该 Tab 为 beforeTabId', () => {
    mockRects();
    const handlers = setup();
    const src = screen.getByTestId('tabs-tab-a.ts');

    dragSequence(src, 130); // b.ts 左半(阈值 160)

    expect(handlers.onReorder).toHaveBeenCalledWith('t1', 't2');
  });

  it('拖到目标 Tab 右半区且是最后一个 Tab:onReorder 以 null 表示末尾', () => {
    mockRects();
    const handlers = setup();
    const src = screen.getByTestId('tabs-tab-a.ts');

    dragSequence(src, 200); // b.ts 右半(阈值 160)

    expect(handlers.onReorder).toHaveBeenCalledWith('t1', null);
  });

  it('拖拽中在目标 Tab 左侧显示插入指示线', async () => {
    mockRects();
    setup();
    const src = screen.getByTestId('tabs-tab-a.ts');

    dispatchPointer('pointerdown', src, { clientX: 0, clientY: 0 });
    dispatchPointer('pointermove', src, { clientX: 130, clientY: 0 });

    // setDropBeforeId 异步生效,等待重渲染后检查指示线
    await waitFor(() => expect(screen.getByTestId('tabs-drop-before-b.ts')).toBeInTheDocument());
  });

  it('被拖拽 Tab 添加半透明样式', async () => {
    setup();
    const src = screen.getByTestId('tabs-tab-a.ts');

    dispatchPointer('pointerdown', src, { clientX: 0, clientY: 0 });
    dispatchPointer('pointermove', src, { clientX: 130, clientY: 0 });

    // setDragId 异步生效,等待重渲染后检查样式
    await waitFor(() => expect(src.className).toContain('opacity-40'));
  });

  it('拖到容器空白区域(所有 Tab 右侧):onReorder 以 null 表示末尾', () => {
    mockRects();
    const handlers = setup();
    const src = screen.getByTestId('tabs-tab-a.ts');

    dragSequence(src, 400);

    expect(handlers.onReorder).toHaveBeenCalledWith('t1', null);
  });

  it('未传入 onReorder 时,拖拽序列不触发排序', () => {
    const handlers = setup({ onReorder: undefined });
    const src = screen.getByTestId('tabs-tab-a.ts');

    dragSequence(src, 130);

    expect(handlers.onReorder).not.toHaveBeenCalled();
  });

  it('普通点击(未越过阈值)不触发排序,仅切换 Tab', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tabs-tab-a.ts'));

    expect(handlers.onReorder).not.toHaveBeenCalled();
    expect(handlers.onSelect).toHaveBeenCalledWith('t1');
  });
});

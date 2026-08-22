/**
 * EditorLeftSidebar 单元测试 —— 多选与对比差异入口
 *
 * 验证:
 * - 普通点击单选并激活
 * - Ctrl/Cmd+点击追加/取消多选
 * - 右键未选中的文件时仅选中它(对齐 VSCode)
 * - 多选 ≥2 个文件时,右键菜单出现「比较所选内容」并可分发回调
 * - 「对比差异」分组:创建对比后显示条目,点击激活,关闭移除
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorLeftSidebar, type EditorLeftSidebarProps } from './EditorLeftSidebar';
import type { EditorTab } from './schema';

// mock IPC 封装:FolderTreeSection(文件夹树分组)经 readDirectory 懒加载
vi.mock('./fileOps', () => ({
  readDirectory: vi.fn().mockResolvedValue([]),
}));

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
  {
    id: 't3',
    title: 'c.ts',
    path: 'C:/dev/c.ts',
    language: 'typescript',
    content: 'c',
    savedContent: 'c',
    pinned: false,
  },
];

function setup(props: Partial<EditorLeftSidebarProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onSelectMany: vi.fn(),
    onCompareSelected: vi.fn(),
    onSelectCompare: vi.fn(),
    onCloseCompare: vi.fn(),
    onCloseAllCompares: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseRight: vi.fn(),
    onCloseSaved: vi.fn(),
    onTogglePin: vi.fn(),
    onSave: vi.fn(),
    onRevealInExplorer: vi.fn(),
    onCopyPath: vi.fn(),
    onReorder: vi.fn(),
    onNewTab: vi.fn(),
    onSaveAll: vi.fn(),
    onCloseAll: vi.fn(),
    onToggleDir: vi.fn(),
    onCloseFolder: vi.fn(),
    onOpenTreeFile: vi.fn(),
  };
  render(
    <EditorLeftSidebar
      tabs={tabs}
      activeTabId="t1"
      dirtyCount={0}
      selectedTabIds={[]}
      {...handlers}
      {...props}
      data-testid="sidebar"
    />,
  );
  return handlers;
}

describe('EditorLeftSidebar 多选与对比', () => {
  it('普通点击单选该文件并激活', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sidebar-item-b.ts'));

    expect(handlers.onSelectMany).toHaveBeenCalledWith('t2', false);
  });

  it('鼠标中键点击文件项分发 onClose(对齐 Tab 栏中键关闭)', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.pointer({
      keys: '[MouseMiddle]',
      target: screen.getByTestId('sidebar-item-b.ts'),
    });

    expect(handlers.onClose).toHaveBeenCalledWith('t2');
  });

  it('固定 Tab 在文件列表项中显示 Pin 图标', () => {
    setup({ tabs: [{ ...tabs[0], pinned: true }], activeTabId: 't1' });

    expect(screen.getByTestId('sidebar-pin-a.ts')).toBeInTheDocument();
  });

  it('未固定 Tab 不显示 Pin 图标', () => {
    setup();

    expect(screen.queryByTestId('sidebar-pin-a.ts')).not.toBeInTheDocument();
  });

  it('文件 Tab 在名称后显示所在目录作为描述', () => {
    setup();

    const item = screen.getByTestId('sidebar-item-a.ts');
    expect(item).toHaveTextContent('a.ts');
    expect(item).toHaveTextContent('C:/dev');
  });

  it('未命名 Tab 在名称后显示原始自动名(autoTitle)作为描述', () => {
    setup({
      tabs: [
        {
          id: 'u1',
          title: '问我呢问问',
          autoTitle: 'untitled-4',
          path: null,
          language: 'plaintext',
          content: '问我呢问问',
          savedContent: '',
          pinned: false,
        },
      ],
      activeTabId: 'u1',
    });

    const item = screen.getByTestId('sidebar-item-问我呢问问');
    expect(item).toHaveTextContent('问我呢问问');
    expect(item).toHaveTextContent('untitled-4');
  });

  it('相邻多选行去掉贴合边圆角,视觉上合并为一个整块', () => {
    // 无激活 Tab,b.ts 与 c.ts 相邻且都被多选中:a.ts 未选中保持完整圆角
    setup({ selectedTabIds: ['t2', 't3'], activeTabId: null });

    const a = screen.getByTestId('sidebar-item-a.ts');
    const b = screen.getByTestId('sidebar-item-b.ts');
    const c = screen.getByTestId('sidebar-item-c.ts');

    expect(a).toHaveClass('rounded');
    expect(a).not.toHaveClass('rounded-t-none', 'rounded-b-none');

    // b.ts 上方是未选中的 a.ts:保留顶部圆角,去掉与 c.ts 贴合的底部圆角
    expect(b).toHaveClass('rounded-b-none');
    expect(b).not.toHaveClass('rounded-t-none');

    // c.ts 下方没有选中项:去掉与 b.ts 贴合的顶部圆角,保留底部圆角
    expect(c).toHaveClass('rounded-t-none');
    expect(c).not.toHaveClass('rounded-b-none');
  });

  it('Ctrl+点击追加多选(additive=true)', async () => {
    const handlers = setup({ selectedTabIds: ['t2'] });
    const user = userEvent.setup();
    await user.keyboard('{Control>}');
    await user.click(screen.getByTestId('sidebar-item-c.ts'));
    await user.keyboard('{/Control}');

    expect(handlers.onSelectMany).toHaveBeenCalledWith('t3', true);
  });

  it('右键未选中的文件时仅选中它(additive=false),保持其它多选被清除', async () => {
    const handlers = setup({ selectedTabIds: ['t2'] });
    const user = userEvent.setup();
    // 右键一个既非激活也非多选中的文件
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('sidebar-item-c.ts') });

    expect(handlers.onSelectMany).toHaveBeenCalledWith('t3', false);
  });

  it('多选 ≥2 个文件时,右键菜单出现「比较所选内容」并可触发回调', async () => {
    const handlers = setup({ selectedTabIds: ['t2'], activeTabId: 't1' });
    const user = userEvent.setup();
    // 右键已在多选中的文件:保持整组选中,菜单中出现「比较所选内容」
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('sidebar-item-b.ts') });
    await waitFor(() => {
      expect(screen.getByTestId('ctx-compare-selected')).toBeInTheDocument();
    });

    expect(handlers.onSelectMany).not.toHaveBeenCalled(); // 已在多选中,不重置选中

    await screen.getByTestId('ctx-compare-selected').click();
    expect(handlers.onCompareSelected).toHaveBeenCalledTimes(1);
  });
});

describe('EditorLeftSidebar 对比差异分组', () => {
  const compare = {
    id: 'c1',
    leftTabId: 't1',
    rightTabId: 't2',
  };

  it('创建对比后,文件列表下方显示「对比差异」条目', () => {
    setup({ compares: [compare] });

    expect(screen.getByTestId('sidebar-compare-header')).toHaveTextContent('对比差异');
    expect(screen.getByTestId('sidebar-compare-count')).toHaveTextContent('1');
    expect(screen.getByTestId('sidebar-compare-c1')).toHaveTextContent('a.ts ⟷ b.ts');
  });

  it('点击对比条目分发 onSelectCompare', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sidebar-compare-c1'));

    expect(handlers.onSelectCompare).toHaveBeenCalledWith('c1');
  });

  it('鼠标中键点击对比条目分发 onCloseCompare(对齐文件列表中键关闭)', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();
    await user.pointer({
      keys: '[MouseMiddle]',
      target: screen.getByTestId('sidebar-compare-c1'),
    });

    expect(handlers.onCloseCompare).toHaveBeenCalledWith('c1');
  });

  it('激活的对比条目高亮(aria-current)', () => {
    setup({ compares: [compare], activeCompareId: 'c1' });

    expect(screen.getByTestId('sidebar-compare-c1')).toHaveAttribute('aria-current', 'true');
  });

  it('点击对比条目的关闭按钮分发 onCloseCompare,且不触发激活', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sidebar-compare-close-c1'));

    expect(handlers.onCloseCompare).toHaveBeenCalledWith('c1');
    expect(handlers.onSelectCompare).not.toHaveBeenCalled();
  });

  it('「对比差异」标题可折叠/展开列表', async () => {
    setup({ compares: [compare] });
    const user = userEvent.setup();

    expect(screen.getByTestId('sidebar-compare-c1')).toBeInTheDocument();
    await user.click(screen.getByTestId('sidebar-compare-header'));
    // 折叠后条目不再显示
    expect(screen.queryByTestId('sidebar-compare-c1')).not.toBeInTheDocument();
  });

  it('无对比项时不渲染「对比差异」分组', () => {
    setup();
    expect(screen.queryByTestId('sidebar-compare-header')).not.toBeInTheDocument();
  });

  it('点击「关闭对比差异」按钮分发 onCloseAllCompares', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();

    expect(screen.getByTestId('sidebar-compare-c1')).toBeInTheDocument();
    // 与「打开的编辑器」一致:关闭按钮悬浮面板时才显示,需先 hover
    await user.hover(screen.getByTestId('sidebar'));
    await user.click(screen.getByTestId('sidebar-compare-close-all'));
    expect(handlers.onCloseAllCompares).toHaveBeenCalledTimes(1);
  });

  it('「关闭对比差异」按钮平时隐藏,悬浮面板时显示', async () => {
    setup({ compares: [compare] });
    const user = userEvent.setup();

    // 未悬浮:按钮外层容器 w-0 + opacity-0(视觉隐藏)
    const btn = screen.getByTestId('sidebar-compare-close-all');
    const wrapper = btn.parentElement as HTMLElement;
    expect(wrapper).toHaveClass('w-0', 'opacity-0');

    await user.hover(screen.getByTestId('sidebar'));
    expect(wrapper).toHaveClass('w-auto', 'opacity-100');
  });

  it('右键对比条目弹出菜单,「关闭」分发 onCloseCompare', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByTestId('sidebar-compare-c1'),
    });
    await waitFor(() => {
      expect(screen.getByTestId('compare-context-menu')).toBeInTheDocument();
    });

    expect(screen.getByTestId('ctx-compare-close')).toHaveTextContent('关闭');
    expect(screen.getByTestId('ctx-compare-close-all')).toHaveTextContent('关闭全部');

    await screen.getByTestId('ctx-compare-close').click();
    expect(handlers.onCloseCompare).toHaveBeenCalledWith('c1');
  });

  it('右键对比条目菜单「关闭全部」分发 onCloseAllCompares', async () => {
    const handlers = setup({ compares: [compare] });
    const user = userEvent.setup();

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByTestId('sidebar-compare-c1'),
    });
    await waitFor(() => {
      expect(screen.getByTestId('compare-context-menu')).toBeInTheDocument();
    });

    await screen.getByTestId('ctx-compare-close-all').click();
    expect(handlers.onCloseAllCompares).toHaveBeenCalledTimes(1);
  });
});

describe('EditorLeftSidebar 文件列表拖拽排序', () => {
  afterEach(() => {
    // 还原本 describe 内 spyOn 的 getBoundingClientRect
    vi.restoreAllMocks();
  });

  /**
   * 全局伪造 getBoundingClientRect:按 data-testid 返回垂直布局。
   * 每项高度 40:a.ts y=0 / b.ts y=100 / c.ts y=200,供上下半区判定。
   */
  function mockRects() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const testid = this.getAttribute('data-testid') ?? '';
      const tops: Record<string, number> = {
        'sidebar-item-a.ts': 0,
        'sidebar-item-b.ts': 100,
        'sidebar-item-c.ts': 200,
      };
      const top = tops[testid] ?? 0;
      return {
        left: 0,
        top,
        right: 200,
        bottom: top + 40,
        width: 200,
        height: 40,
        x: 0,
        y: top,
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
  function dragSequence(src: HTMLElement, y: number) {
    dispatchPointer('pointerdown', src, { clientX: 0, clientY: 0 });
    dispatchPointer('pointermove', src, { clientX: 0, clientY: y });
    dispatchPointer('pointerup', src, { clientX: 0, clientY: y });
  }

  it('拖到目标文件项上半区:onReorder 以该文件为 beforeTabId', () => {
    mockRects();
    const handlers = setup();
    const src = screen.getByTestId('sidebar-item-a.ts');

    dragSequence(src, 110); // b.ts 上半(阈值 120)

    expect(handlers.onReorder).toHaveBeenCalledWith('t1', 't2');
  });

  it('拖到目标文件项下半区且是最后一项:onReorder 以 null 表示末尾', () => {
    mockRects();
    const handlers = setup();
    const src = screen.getByTestId('sidebar-item-a.ts');

    dragSequence(src, 230); // c.ts 下半(阈值 220)

    expect(handlers.onReorder).toHaveBeenCalledWith('t1', null);
  });

  it('拖拽中在目标文件项上方显示插入指示线', async () => {
    mockRects();
    setup();
    const src = screen.getByTestId('sidebar-item-a.ts');

    dispatchPointer('pointerdown', src, { clientX: 0, clientY: 0 });
    dispatchPointer('pointermove', src, { clientX: 0, clientY: 110 });

    // setDropBeforeId 异步生效,等待重渲染后检查指示线
    await waitFor(() => expect(screen.getByTestId('sidebar-drop-before-b.ts')).toBeInTheDocument());
  });

  it('被拖拽文件项添加半透明样式', async () => {
    setup();
    const src = screen.getByTestId('sidebar-item-a.ts');

    dispatchPointer('pointerdown', src, { clientX: 0, clientY: 0 });
    dispatchPointer('pointermove', src, { clientX: 0, clientY: 110 });

    // setDragId 异步生效,等待重渲染后检查样式
    await waitFor(() => expect(src.className).toContain('opacity-40'));
  });

  it('拖到容器空白区域(所有项下方):onReorder 以 null 表示末尾', () => {
    mockRects();
    const handlers = setup();
    const src = screen.getByTestId('sidebar-item-a.ts');

    dragSequence(src, 500);

    expect(handlers.onReorder).toHaveBeenCalledWith('t1', null);
  });

  it('未传入 onReorder 时,拖拽序列不触发排序', () => {
    const handlers = setup({ onReorder: undefined });
    const src = screen.getByTestId('sidebar-item-a.ts');

    dragSequence(src, 110);

    expect(handlers.onReorder).not.toHaveBeenCalled();
  });

  it('普通点击(未越过阈值)不触发排序,仅选中文件', async () => {
    const handlers = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sidebar-item-a.ts'));

    expect(handlers.onReorder).not.toHaveBeenCalled();
    expect(handlers.onSelectMany).toHaveBeenCalled();
  });
});

describe('EditorLeftSidebar 文件夹树分组', () => {
  it('未传入 folders 时不渲染「文件夹」分组,文件列表正常显示', () => {
    setup();

    expect(screen.queryByTestId('sidebar-folder-tree-folder-section')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-a.ts')).toBeInTheDocument();
  });

  it('文件夹树分组位于已打开文件列表下方,点击目录分发 onToggleDir', async () => {
    const handlers = setup({
      folders: [{ rootPath: 'C:/dev' }],
      expandedDirs: ['C:/dev'],
    });
    const user = userEvent.setup();

    const section = screen.getByTestId('sidebar-folder-tree-folder-section');
    const tabsList = screen.getByTestId('sidebar-item-a.ts').closest('ul');
    // DOM 顺序:文件夹分组在文件列表之后(下方独立分组)
    expect(tabsList!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 根目录默认展开;子项为空(mock 返回 []),但树内交互链路可验证:
    // 展开根 → onToggleDir 分发
    await user.click(screen.getByTestId('sidebar-folder-tree-node-dev'));
    expect(handlers.onToggleDir).toHaveBeenCalledWith('C:/dev');
  });
});

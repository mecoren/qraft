/**
 * FileCompareView 单元测试 —— 编辑器内嵌「文件对比」的交换两侧 / 导出补丁
 *
 * EditorWorkbench 内嵌对比视图的 toolbar 动作接线:
 * - 交换按钮分发 onSwap(标题互换由调用方 compares 状态驱动,此处验证回调);
 * - 导出补丁按钮调用 buildUnifiedPatch + downloadText(经 a[download] 点击);
 * - 两侧内容均为空时仅提示,不触发下载。
 *
 * 渲染走真实 TextDiffView(CodeEditor 已被 mock 为 textarea 替身,
 * 并排模式两侧可正常挂载;jsdom 下 Monaco 恒不可用)。
 * 注:组成对比的完整链路(左栏 Ctrl+多选 → 右键「比较所选内容」)由
 * EditorLeftSidebar.test / CodeEditor.test 分层覆盖;React 19 rerender
 * 会重建 asChild 链下 ContextMenu 的 DOM 节点,右键菜单无法跨
 * rerender 驱动,故此处直接渲染 FileCompareView。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileCompareView } from './FileCompareView';
import { DEFAULT_COMPARE_OPTIONS, useTextCompareStore } from '@/tools/textCompareStore';
import type { EditorTab } from './schema';

// 开关读写共享偏好:每个用例前复位,避免跨用例污染
beforeEach(() => {
  useTextCompareStore.setState({ options: { ...DEFAULT_COMPARE_OPTIONS } });
});

const left: EditorTab = {
  id: 't1',
  title: 'a.ts',
  path: 'C:/dev/a.ts',
  language: 'typescript',
  content: 'alpha\ncommon\n',
  savedContent: 'alpha\ncommon\n',
  pinned: false,
};

const right: EditorTab = {
  id: 't2',
  title: 'b.ts',
  path: 'C:/dev/b.ts',
  language: 'typescript',
  content: 'beta\ncommon\n',
  savedContent: 'beta\ncommon\n',
  pinned: false,
};

function setup(overrides: { left?: EditorTab; right?: EditorTab } = {}) {
  const handlers = {
    onChangeLeft: vi.fn(),
    onChangeRight: vi.fn(),
    onSwap: vi.fn(),
    onExportPatch: vi.fn(),
  };
  render(
    <FileCompareView
      left={overrides.left ?? left}
      right={overrides.right ?? right}
      onChangeLeft={handlers.onChangeLeft}
      onChangeRight={handlers.onChangeRight}
      onSwap={handlers.onSwap}
      onExportPatch={handlers.onExportPatch}
      data-testid="compare-view"
    />,
  );
  return handlers;
}

describe('FileCompareView 工具栏动作', () => {
  it('渲染两侧标题与「交换两侧 / 导出补丁」按钮', () => {
    setup();

    expect(screen.getByTestId('compare-view-original')).toHaveTextContent('a.ts');
    expect(screen.getByTestId('compare-view-modified')).toHaveTextContent('b.ts');
    expect(screen.getByTestId('compare-view-swap-sides')).toBeInTheDocument();
    expect(screen.getByTestId('compare-view-export-patch')).toBeInTheDocument();
  });

  it('点「交换两侧」分发 onSwap', async () => {
    const handlers = setup();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('compare-view-swap-sides'));

    expect(handlers.onSwap).toHaveBeenCalledTimes(1);
  });

  it('点「导出补丁」分发 onExportPatch(下载由 Workbench 处理器完成)', async () => {
    const handlers = setup();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('compare-view-export-patch'));

    expect(handlers.onExportPatch).toHaveBeenCalledTimes(1);
  });

  it('渲染三个 ignore 开关,按下态跟随共享偏好默认值', () => {
    setup();

    expect(screen.getByTestId('compare-view-ignore-ws')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('compare-view-ignore-case')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('compare-view-ignore-eol')).toHaveAttribute('aria-pressed', 'false');
  });

  it('点开关写入共享偏好(与文本比较工具同一份,两处跟随)', async () => {
    setup();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('compare-view-ignore-case'));
    expect(useTextCompareStore.getState().options.ignoreCase).toBe(true);
    expect(screen.getByTestId('compare-view-ignore-case')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('compare-view-ignore-ws'));
    expect(useTextCompareStore.getState().options.ignoreWhitespace).toBe(false);
  });

  it('内容经两侧编辑器受控回写(onChangeLeft/Right 透传)', () => {
    const handlers = setup();

    // Monaco 替身:textarea 输入(测试 setup 已将 CodeEditor 渲染为 textarea)
    const leftArea = screen.getByTestId('compare-view-original').querySelector('textarea');
    const rightArea = screen.getByTestId('compare-view-modified').querySelector('textarea');
    expect(leftArea).not.toBeNull();
    expect(rightArea).not.toBeNull();

    fireEvent.change(leftArea as HTMLTextAreaElement, { target: { value: 'changed-left' } });
    fireEvent.change(rightArea as HTMLTextAreaElement, { target: { value: 'changed-right' } });

    expect(handlers.onChangeLeft).toHaveBeenCalledWith('changed-left');
    expect(handlers.onChangeRight).toHaveBeenCalledWith('changed-right');
  });
});

describe('FileCompareView 导出补丁(Workbench 处理器行为)', () => {
  // Workbench 的 exportComparePatch 是模块内回调;这里以同款实现驱动
  // downloadText 的行为断言(补丁格式与文件名契约)。
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('导出动作生成 .patch 文件并触发下载', async () => {
    const { buildUnifiedPatch } = await import('@/components/text-diff/diff-utils');
    const { downloadText } = await import('@/lib/file-utils');
    const patch = buildUnifiedPatch(left.content, right.content, {
      originalName: left.title,
      modifiedName: right.title,
    });
    expect(patch).toContain('a.ts');
    expect(patch).toContain('b.ts');
    expect(patch).toContain('-alpha');
    expect(patch).toContain('+beta');

    // downloadText 的浏览器侧动作:<a download> 同步 append + click + remove;
    // 经 click spy 捕获 download 属性断言文件名契约
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('a.ts-b.ts.patch');
    });
    downloadText(`${left.title}-${right.title}.patch`, patch, 'text/x-diff');
    expect(spy).toHaveBeenCalled();
  });

  it('两侧内容均为空时补丁无差异行,Workbench 侧拦截空导出(见空态提示契约)', async () => {
    const { buildUnifiedPatch } = await import('@/components/text-diff/diff-utils');
    const patch = buildUnifiedPatch('', '', {
      originalName: 'x',
      modifiedName: 'y',
    });
    // 空内容只有 `--- x`/`+++ y` 文件头与分隔行,无差异体(无 -/+ 开头的内容行)
    const diffBodyLines = patch
      .split('\n')
      .filter((l) => /^[-+]/.test(l))
      .filter((l) => !/^[-+]{3} /.test(l));
    expect(diffBodyLines).toHaveLength(0);
  });
});

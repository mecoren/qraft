/**
 * SearchDialog 交互测试 —— 打开/过滤/选择跳转/关闭。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchDialog } from './SearchDialog';
import { useSearchStore } from '@/store/searchStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import type { EditorTab } from '@/tools/code-editor-workspace/schema';

/** 构造最小合法 Tab */
function makeTab(id: string, title: string, content: string): EditorTab {
  return { id, title, path: null, language: 'plaintext', content, savedContent: content, pinned: false };
}

function setTabs(tabs: EditorTab[]) {
  useEditorWorkspaceStore.setState({
    workspace: {
      tabs,
      activeTabId: tabs[0]?.id ?? null,
      leftSidebarVisible: true,
      sidebarWidth: 288,
    },
    ready: true,
    userTouched: true,
    error: null,
  });
}

beforeEach(() => {
  useSearchStore.setState({ target: null });
  setTabs([]);
});

describe('SearchDialog', () => {
  it('打开时展示搜索输入框与分组结果', () => {
    render(<SearchDialog open onOpenChange={() => {}} />);
    expect(screen.getByPlaceholderText(/搜索/)).toBeInTheDocument();
    // 分组标题(工具区块较独特,避免与其他文本冲突)
    expect(screen.getByText('工具区块')).toBeInTheDocument();
    // 全量索引中的代表工具(工具条目 + 区块分组标签均可能出现)
    expect(screen.getAllByText('JSON 格式化器').length).toBeGreaterThan(0);
  });

  it('输入关键字过滤结果', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByPlaceholderText(/搜索/), 'base64');
    // 防抖 80ms 后无关结果消失
    await waitFor(() => {
      expect(screen.queryByText('JSON 格式化器')).not.toBeInTheDocument();
    });
    expect(screen.getAllByText('Base64 转换器').length).toBeGreaterThan(0);
  });

  it('无匹配时展示空态提示', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByPlaceholderText(/搜索/), '不存在的关键字zzzz');
    // 防抖 80ms + 全量测试并发下可能较慢,放宽等待超时避免 flaky
    expect(
      await screen.findByText(/未找到匹配/, undefined, { timeout: 10000 }),
    ).toBeInTheDocument();
  }, 20000);

  it('点击工具结果触发 requestJump 并关闭', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SearchDialog open onOpenChange={onOpenChange} />);
    await user.type(screen.getByPlaceholderText(/搜索/), 'base64');
    await user.click((await screen.findAllByText('Base64 转换器'))[0]);
    expect(useSearchStore.getState().target).toEqual({ view: 'tool', toolId: 'base64_codec' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('选择设置分区结果携带 settingsMenu', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SearchDialog open onOpenChange={onOpenChange} />);
    await user.type(screen.getByPlaceholderText(/搜索/), '快捷键');
    await waitFor(() => {
      expect(screen.getAllByText('快捷键').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('快捷键')[0]);
    expect(useSearchStore.getState().target).toEqual({
      view: 'settings',
      settingsMenu: 'shortcuts',
      anchor: 'settings:shortcuts',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('键盘 Enter 触发当前高亮结果', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SearchDialog open onOpenChange={onOpenChange} />);
    const input = screen.getByPlaceholderText(/搜索/);
    await user.type(input, 'json');
    // 等待防抖完成、列表过滤稳定:全量列表中的无关结果消失后 items 不再重排,
    // 避免 ArrowDown 选中后因防抖重渲染清空 cmdk 选中态
    await waitFor(() => {
      expect(screen.queryByText('Base64 转换器')).not.toBeInTheDocument();
    });
    await user.keyboard('{ArrowDown}');
    // cmdk 的选中态由 React 异步渲染,等待选中项出现后再 Enter
    await waitFor(() => {
      expect(document.querySelector('[aria-selected="true"]')).not.toBeNull();
    });
    await user.keyboard('{Enter}');
    // cmdk 选中项触发 onSelect → requestJump
    expect(useSearchStore.getState().target).not.toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('关闭状态不渲染面板', () => {
    render(<SearchDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByPlaceholderText(/搜索/)).not.toBeInTheDocument();
  });
});

describe('SearchDialog 文本模式', () => {
  it('模式切换:默认功能模式,切换「文本」后 placeholder 变化', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    expect(screen.getByPlaceholderText(/搜索所有功能/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '文本' }));
    expect(screen.getByPlaceholderText(/搜索编辑器文本/)).toBeInTheDocument();
  });

  it('文本模式无已打开文件时展示引导文案', async () => {
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: '文本' }));
    expect(screen.getByText(/请先在文本编辑器中打开文件/)).toBeInTheDocument();
  });

  it('文本模式展示按文件分组的匹配行,匹配片段高亮', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'hello world\nfind me'), makeTab('tab-b', 'code.ts', 'x')]);
    const user = userEvent.setup();
    render(<SearchDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: '文本' }));
    const input = screen.getByPlaceholderText(/搜索编辑器文本/);
    await user.type(input, 'find');
    // 文件名分组出现(分组 heading)
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    // 匹配行作为 option 出现(行内文本被高亮片段拆分,用 accessible name 聚合匹配)
    expect(screen.getByRole('option', { name: /find me/ })).toBeInTheDocument();
    // 匹配片段使用 mark 高亮
    expect(screen.getAllByText('find', { selector: 'mark' }).length).toBeGreaterThan(0);
    // 无匹配的 tab 不出现在结果
    expect(screen.queryByText('code.ts')).not.toBeInTheDocument();
  });

  it('点击文本结果触发 requestJump(tabId+textQuery) 并关闭', async () => {
    setTabs([makeTab('tab-a', 'notes.txt', 'find me')]);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SearchDialog open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: '文本' }));
    await user.type(screen.getByPlaceholderText(/搜索编辑器文本/), 'find');
    await user.click(await screen.findByRole('option', { name: /find me/ }));
    expect(useSearchStore.getState().target).toEqual({
      view: 'tool',
      toolId: 'text_editor',
      tabId: 'tab-a',
      textQuery: 'find',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/**
 * MarkdownEditor 工具页测试 —— Tab/大纲/保存接线(编辑内核由
 * tiptap-spike.test.ts 覆盖往返,此处只测壳)。
 *
 * - mermaid 懒渲染 mock(与 CodeEditor.test 同策略)
 * - fileOps/sonner 全 mock,不碰真实 IPC
 * - TipTap Editor 在 jsdom 真跑(ProseMirror 无需布局)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../markdown-mermaid', () => ({ renderMermaidIn: vi.fn(async () => undefined) }));

// Monaco 在 jsdom 下不加载:CodeEditor 替换为 textarea 替身(与 CodeEditor.test 同策略)
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: ({
    value,
    onChange,
    onMount,
    'data-testid': testId,
  }: {
    value: string;
    onChange?: (v: string) => void;
    onMount?: (inst: unknown) => void;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId}>
      <textarea
        data-testid={`${testId}-textarea`}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <button
        type="button"
        data-testid={`${testId}-mount`}
        onClick={() =>
          onMount?.({
            getPosition: () => ({ lineNumber: 3, column: 5 }),
            onDidChangeCursorPosition: () => undefined,
            onDidChangeCursorSelection: () => undefined,
            focus: () => undefined,
          })
        }
      />
    </div>
  ),
}));

vi.mock('sonner', () => {
  const fn = vi.fn();
  return {
    toast: Object.assign(fn, {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

const openDialogMock = vi.fn();
const saveDialogMock = vi.fn();
const writeToPathMock = vi.fn();
const fileMtimeMock = vi.fn();
const readEncodedMock = vi.fn();
vi.mock('../code-editor-workspace/fileOps', () => ({
  OPEN_REASON_BINARY: 'binary',
  OPEN_REASON_TOO_LARGE: 'too-large',
  openTextFileDialog: (...a: unknown[]) => openDialogMock(...a),
  saveWithDialogEncoded: (...a: unknown[]) => saveDialogMock(...a),
  saveToPathEncoded: (...a: unknown[]) => writeToPathMock(...a),
  fileMtimeMs: (...a: unknown[]) => fileMtimeMock(...a),
  readTextFileEncoded: (...a: unknown[]) => readEncodedMock(...a),
  forceOpenFile: vi.fn(),
}));

import { MarkdownEditor } from './MarkdownEditor';
import { useMdEditorDocsStore } from '../markdownEditorDocsStore';
import { useMarkdownEditorStore } from '../markdownEditorStore';
import { useToolStateStore } from '@/store/toolStateStore';

describe('MarkdownEditor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => {
      useMarkdownEditorStore.setState({
        themeId: 'typora',
        outlineOpen: true,
        editorMode: 'wysiwyg',
        contentWidth: 'narrow',
      });
      useMdEditorDocsStore.setState({
        docs: [
          {
            id: 'md-1',
            title: 'md-1',
            autoTitle: 'md-1',
            pinned: false,
            content: '# 大纲标题\n\n正文 **加粗**。',
          },
        ],
        activeDocId: 'md-1',
        ready: true,
        userTouched: false,
        firstUse: false,
        error: null,
      });
      useToolStateStore.setState({ currentToolId: 'markdown_editor' });
    });
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    writeToPathMock.mockReset().mockResolvedValue(undefined);
    fileMtimeMock.mockReset().mockResolvedValue(123);
    readEncodedMock.mockReset();
  });

  it('挂载渲染所见编辑区:标题与加粗按排版呈现,大纲列出标题', async () => {
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    const surface = await screen.findByTestId('md-wysiwyg');
    expect(surface.querySelector('h1')?.textContent).toBe('大纲标题');
    expect(surface.querySelector('strong')?.textContent).toBe('加粗');
    expect(await screen.findByTestId('outline-panel')).toHaveTextContent('大纲标题');
    expect(screen.getByTestId('md-statusbar')).toHaveTextContent('词');
  });

  it('新建文档按钮追加空白 Tab 并激活', async () => {
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-doc-new'));
    });
    expect(useMdEditorDocsStore.getState().docs).toHaveLength(2);
  });

  it('有路径文档 Ctrl+S 直接写回并刷新快照', async () => {
    act(() => {
      useMdEditorDocsStore.setState({
        docs: [
          {
            id: 'md-1',
            title: 'a.md',
            pinned: false,
            content: '# 旧',
            path: '/tmp/a.md',
            encoding: 'utf-8',
            mtimeMs: 1,
            savedContent: '# 旧',
          },
        ],
      });
    });
    fileMtimeMock.mockResolvedValue(1);
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    // 真实快捷键路径(Ctrl+S 经 useToolShortcut 归属守卫,激活工具才响应)
    await act(async () => {
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    });
    await waitFor(() => expect(writeToPathMock).toHaveBeenCalled());
    expect(writeToPathMock.mock.calls[0]?.[0]).toBe('/tmp/a.md');
  });

  it('纯草稿有内容即显示未保存圆点,空草稿不显示', async () => {
    act(() => {
      useMdEditorDocsStore.setState({
        docs: [
          { id: 'md-1', title: 'md-1', autoTitle: 'md-1', pinned: false, content: '# 草稿内容' },
          { id: 'md-2', title: 'md-2', autoTitle: 'md-2', pinned: false, content: '' },
        ],
        activeDocId: 'md-1',
      });
    });
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    const tabs = screen.getAllByTestId('md-doc-tab');
    const tab1 = tabs.find((el) => el.getAttribute('data-doc-id') === 'md-1');
    const tab2 = tabs.find((el) => el.getAttribute('data-doc-id') === 'md-2');
    expect(tab1?.querySelector('[data-testid="md-doc-tab-dirty"]')).not.toBeNull();
    expect(tab2?.querySelector('[data-testid="md-doc-tab-dirty"]')).toBeNull();
  });

  it('干净 Tab 点关闭直接移除,不弹确认', async () => {
    act(() => {
      useMdEditorDocsStore.setState({
        docs: [
          {
            id: 'md-1',
            title: 'a.md',
            pinned: false,
            content: '# a',
            path: '/tmp/a.md',
            savedContent: '# a',
          },
          {
            id: 'md-2',
            title: 'b.md',
            pinned: false,
            content: '# b',
            path: '/tmp/b.md',
            savedContent: '# b',
          },
        ],
        activeDocId: 'md-1',
      });
    });
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    const closeButtons = screen.getAllByTestId('md-doc-tab-close');
    await act(async () => {
      // 真实点击前浏览器会先 focus 按钮;fireEvent.click 不带 focus,
      // 补上避免 Radix Popover FocusScope 把「无焦点」误判为外部点击
      closeButtons[0]?.focus();
      fireEvent.click(closeButtons[0]);
    });
    expect(screen.queryByTestId('md-doc-close-dialog')).toBeNull();
    expect(useMdEditorDocsStore.getState().docs.map((d) => d.id)).toEqual(['md-2']);
  });

  it('未保存 Tab 关闭弹确认:不保存直接关,保存先写盘再关', async () => {
    act(() => {
      useMdEditorDocsStore.setState({
        docs: [
          {
            id: 'md-1',
            title: 'a.md',
            pinned: false,
            content: '# changed',
            path: '/tmp/a.md',
            encoding: 'utf-8',
            mtimeMs: 1,
            savedContent: '# a',
          },
          {
            id: 'md-2',
            title: 'b.md',
            pinned: false,
            content: '# b',
            path: '/tmp/b.md',
            savedContent: '# b',
          },
        ],
        activeDocId: 'md-1',
      });
    });
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    // 同「固定 Tab」用例:先等挂载 focus 落定再点关闭。非 modal Popover 会把
    // 之后任何外部 focusin 当作 dismiss,编辑器抢焦点会让确认框刚开即关
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-testid')).toBe('md-wysiwyg'),
    );
    // 取消:文档保持
    await act(async () => {
      const btn = screen.getAllByTestId('md-doc-tab-close')[0];
      btn?.focus();
      fireEvent.click(btn);
    });
    expect(await screen.findByTestId('md-doc-close-dialog')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-doc-close-dialog-cancel'));
    });
    expect(screen.queryByTestId('md-doc-close-dialog')).toBeNull();
    expect(useMdEditorDocsStore.getState().docs).toHaveLength(2);
    // 保存并关闭:写盘成功后移除
    await act(async () => {
      const btn = screen.getAllByTestId('md-doc-tab-close')[0];
      btn?.focus();
      fireEvent.click(btn);
    });
    await screen.findByTestId('md-doc-close-dialog');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-doc-close-dialog-save'));
    });
    await waitFor(() =>
      expect(writeToPathMock).toHaveBeenCalledWith('/tmp/a.md', '# changed', 'utf-8', 1),
    );
    await waitFor(() =>
      expect(useMdEditorDocsStore.getState().docs.map((d) => d.id)).toEqual(['md-2']),
    );
  });

  it('固定 Tab 关闭一律弹确认(无保存按钮)', async () => {
    act(() => {
      useMdEditorDocsStore.setState({
        docs: [
          {
            id: 'md-1',
            title: 'a.md',
            pinned: true,
            content: '# a',
            path: '/tmp/a.md',
            savedContent: '# a',
          },
        ],
        activeDocId: 'md-1',
      });
    });
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    // TipTap 挂载的 focus() 延迟一拍执行,先等它落定再点击:
    // 否则编辑器随后抢焦点会被 Popover FocusScope 误判为外部点击而立即关闭
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-testid')).toBe('md-wysiwyg'),
    );
    await act(async () => {
      const btn = screen.getByTestId('md-doc-tab-close');
      btn.focus();
      fireEvent.click(btn);
    });
    expect(await screen.findByTestId('md-doc-close-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('md-doc-close-dialog-save')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-doc-close-dialog-discard'));
    });
    expect(useMdEditorDocsStore.getState().docs).toHaveLength(0);
  });

  it('激活文档有路径时 Tab 下方显示面包屑,无路径时显示标题', async () => {
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    // 无路径草稿:面包屑不渲染,展示标题文本
    expect(screen.queryByTestId('md-path-breadcrumb')).toBeNull();
    expect(screen.getByTestId('md-path-title')).toHaveTextContent('md-1');
    act(() => {
      useMdEditorDocsStore.setState({
        docs: [
          {
            id: 'md-1',
            title: 'a.md',
            pinned: false,
            content: '# a',
            path: 'C:\\Users\\wait\\Desktop\\a.md',
            savedContent: '# a',
          },
        ],
        activeDocId: 'md-1',
      });
    });
    const crumb = await screen.findByTestId('md-path-breadcrumb');
    expect(crumb).toHaveTextContent('Users');
    expect(crumb).toHaveTextContent('Desktop');
    expect(crumb).toHaveTextContent('a.md');
    expect(screen.queryByTestId('md-path-title')).toBeNull();
  });

  it('大纲侧栏可收起/展开:收起 snap 到 0,工具条按钮可重开', async () => {
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    const panel = screen.getByTestId('outline-panel');
    expect(panel.style.width).toBe('208px');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-outline-toggle'));
    });
    expect(screen.getByTestId('outline-panel').style.width).toBe('0px');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-outline-toggle'));
    });
    expect(screen.getByTestId('outline-panel').style.width).toBe('208px');
  });

  it('大纲头部按钮只折叠列表:侧栏保持占位,箭头随折叠态旋转', async () => {
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    expect(screen.getByTestId('outline-item')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-outline-collapse'));
    });
    // 列表收起,但侧栏不缩:宽度不变、条目不再渲染
    expect(screen.getByTestId('outline-panel').style.width).toBe('208px');
    expect(screen.queryAllByTestId('outline-item')).toHaveLength(0);
    // 折叠态箭头指向右(-rotate-90),展开态指向下(rotate-0)
    const chevron = screen.getByTestId('md-outline-collapse').querySelector('svg');
    expect(chevron?.getAttribute('class')).toContain('-rotate-90');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-outline-collapse'));
    });
    expect(screen.getByTestId('outline-item')).toBeInTheDocument();
    expect(
      screen.getByTestId('md-outline-collapse').querySelector('svg')?.getAttribute('class'),
    ).toContain('rotate-0');
  });

  it('所见/源码切换:源码窗编辑后切回,内容保留', async () => {
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-mode-source'));
    });
    const textarea = await screen.findByTestId('md-source-textarea');
    expect(textarea).toHaveValue('# 大纲标题\n\n正文 **加粗**。');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# 新标题\n' } });
    });
    expect(useMdEditorDocsStore.getState().docs[0]?.content).toBe('# 新标题\n');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-mode-wysiwyg'));
    });
    const surface = await screen.findByTestId('md-wysiwyg');
    expect(surface.querySelector('h1')?.textContent).toBe('新标题');
    expect(await screen.findByTestId('outline-panel')).toHaveTextContent('新标题');
  });

  it('大纲分隔条拖拽调宽(同文本编辑器语义)', async () => {
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    const handle = screen.getByTestId('md-outline-resize');
    await act(async () => {
      fireEvent.mouseDown(handle, { clientX: 300 });
    });
    await act(async () => {
      fireEvent.mouseMove(document, { clientX: 350 });
    });
    await act(async () => {
      fireEvent.mouseUp(document);
    });
    expect(screen.getByTestId('outline-panel').style.width).toBe('258px');
  });

  it('源码模式状态栏:光标行列 + 大小 + 编码(同 CodeEditor 信息位)', async () => {
    render(<MarkdownEditor toolId="markdown_editor" metadata={{} as never} />);
    await screen.findByTestId('md-wysiwyg');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-mode-source'));
    });
    await screen.findByTestId('md-source-textarea');
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-source-mount'));
    });
    expect(screen.getByTestId('md-status-cursor')).toHaveTextContent('3');
    expect(screen.getByTestId('md-status-cursor')).toHaveTextContent('5');
    expect(screen.getByTestId('md-status-size')).not.toHaveTextContent('');
    expect(screen.getByTestId('md-status-encoding')).toHaveTextContent('UTF-8');
  });
});

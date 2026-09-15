/**
 * useToolShortcut 守卫契约测试 —— keepalive 下工具级快捷键的激活归属
 *
 * 核心场景:两个常驻工具(EditorWorkbench / MarkdownPreview)都注册
 * save_file 等 window 捕获阶段监听。守卫必须保证:
 * - 激活工具是归属工具 → handler 执行,事件被消费(preventDefault)
 * - 激活工具是其它工具 → handler 不执行,事件放行(返回 false 语义,
 *   激活侧的同名绑定接管消费)
 * - popout 弹窗窗口视同激活(单工具独占视口)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { useToolShortcut } from '@/hooks/useShortcut';
import { useToolStateStore } from '@/store/toolStateStore';

/** 挂载两个工具的快捷键注册(镜像 keepalive 下双工具常驻的真实拓扑) */
function DualShortcutHarness(): null {
  useToolShortcut('text_editor', 'save_file', () => undefined, []);
  useToolShortcut('markdown_preview', 'save_file', () => undefined, []);
  return null;
}

describe('useToolShortcut 激活守卫', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('激活编辑器时 Ctrl+S 只进编辑器侧,Markdown 侧不触发', () => {
    const editorHandler = vi.fn();
    const mdHandler = vi.fn();
    function Harness(): null {
      useToolShortcut('text_editor', 'save_file', editorHandler, [editorHandler]);
      useToolShortcut('markdown_preview', 'save_file', mdHandler, [mdHandler]);
      return null;
    }
    act(() => {
      useToolStateStore.setState({ currentToolId: 'text_editor' });
    });
    const { unmount } = render(<Harness />);

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(editorHandler).toHaveBeenCalledTimes(1);
    expect(mdHandler).not.toHaveBeenCalled();
    unmount();
  });

  it('激活切到 Markdown 后 Ctrl+S 只进 Markdown 侧(双向切换)', () => {
    const editorHandler = vi.fn();
    const mdHandler = vi.fn();
    function Harness(): null {
      useToolShortcut('text_editor', 'save_file', editorHandler, [editorHandler]);
      useToolShortcut('markdown_preview', 'save_file', mdHandler, [mdHandler]);
      return null;
    }
    act(() => {
      useToolStateStore.setState({ currentToolId: 'markdown_preview' });
    });
    const { unmount } = render(<Harness />);

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(mdHandler).toHaveBeenCalledTimes(1);
    expect(editorHandler).not.toHaveBeenCalled();
    unmount();
  });

  it('守卫放行事件:激活侧非归属时不 preventDefault(事件可达深层 DOM)', () => {
    const otherToolHandler = vi.fn();
    function Harness(): null {
      useToolShortcut('text_editor', 'save_file', otherToolHandler, [otherToolHandler]);
      return null;
    }
    // 激活的是别的工具:本监听应放行事件
    act(() => {
      useToolStateStore.setState({ currentToolId: 'base64_codec' });
    });
    const { unmount } = render(<Harness />);

    const deep = document.createElement('div');
    const deepSpy = vi.fn();
    deep.addEventListener('keydown', deepSpy);
    document.body.appendChild(deep);

    fireEvent.keyDown(deep, { key: 's', ctrlKey: true });

    expect(otherToolHandler).not.toHaveBeenCalled();
    // 深层 DOM 收到未消费的事件(capture 监听放行 → 冒泡可达)
    expect(deepSpy).toHaveBeenCalled();
    unmount();
  });

  it('激活侧归属时事件被消费:preventDefault 生效', () => {
    const handler = vi.fn();
    function Harness(): null {
      useToolShortcut('text_editor', 'save_file', handler, [handler]);
      return null;
    }
    act(() => {
      useToolStateStore.setState({ currentToolId: 'text_editor' });
    });
    const { unmount } = render(<Harness />);

    const deep = document.createElement('div');
    const deepSpy = vi.fn();
    deep.addEventListener('keydown', deepSpy);
    document.body.appendChild(deep);

    fireEvent.keyDown(deep, { key: 's', ctrlKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
    // 消费语义:stopPropagation 拦截,深层不再收到
    expect(deepSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('popout 弹窗窗口视同激活:守卫不依赖 currentToolId', () => {
    const handler = vi.fn();
    function Harness(): null {
      useToolShortcut('markdown_preview', 'save_file', handler, [handler]);
      return null;
    }
    // popout 窗口下 currentToolId 是独立实例的默认值(文本编辑器),仍应响应
    const originalUrl = window.location.href;
    act(() => {
      useToolStateStore.setState({ currentToolId: 'text_editor' });
    });
    window.history.replaceState(null, '', '/?popout=markdown_preview');
    const { unmount } = render(<Harness />);

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
    unmount();
    window.history.replaceState(null, '', originalUrl);
  });

  it('双工具同时挂载(keepalive 拓扑):同一次按键只有激活侧执行', () => {
    const spy: string[] = [];
    function Harness(): null {
      useToolShortcut(
        'text_editor',
        'save_file',
        () => {
          spy.push('editor');
        },
        [],
      );
      useToolShortcut(
        'markdown_preview',
        'save_file',
        () => {
          spy.push('md');
        },
        [],
      );
      return null;
    }
    act(() => {
      useToolStateStore.setState({ currentToolId: 'markdown_preview' });
    });
    const { unmount } = render(<DualShortcutHarness key="topology" />);
    // 用 spy 版本重挂(替换 handler 引用)
    unmount();
    const { unmount: unmount2 } = render(<Harness />);

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(spy).toEqual(['md']);
    unmount2();
  });
});

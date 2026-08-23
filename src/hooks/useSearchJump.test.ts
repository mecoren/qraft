/**
 * useSearchJump 单元测试 —— 跳转信令的视图切换、锚点定位与高亮。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchJump, scheduleHighlight, HIGHLIGHT_MS } from './useSearchJump';
import { useSearchStore } from '@/store/searchStore';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import {
  registerTabEditor,
  unregisterTabEditor,
  clearTabEditors,
} from '@/lib/editor-search-registry';
import type { EditorTab } from '@/tools/code-editor-workspace/schema';
import type { editor } from 'monaco-editor';

/** 构造最小合法 Tab */
function makeTab(id: string, content = ''): EditorTab {
  return {
    id,
    title: id,
    path: null,
    language: 'plaintext',
    content,
    savedContent: content,
    pinned: false,
  };
}

/** 构造 fake Monaco 编辑器(供文本跳转分支测试) */
function fakeEditor(): editor.IStandaloneCodeEditor {
  return {
    getModel: () => ({}) as unknown as editor.ITextModel,
    deltaDecorations: vi.fn(() => ['dec-1']),
    revealRangeInCenter: vi.fn(),
    setSelection: vi.fn(),
    focus: vi.fn(),
  } as unknown as editor.IStandaloneCodeEditor;
}

beforeEach(() => {
  clearTabEditors();
  useSearchStore.setState({ target: null });
  useUiStore.setState({
    view: 'welcome',
    sidebarCollapsed: false,
    favorites: [],
    recents: [],
    expandedCategories: [],
  });
  useToolStateStore.setState({ currentToolId: null });
  document.body.innerHTML = '';
});

describe('useSearchJump', () => {
  it('tool 目标切换视图并打开工具', () => {
    renderHook(() => useSearchJump());
    act(() => {
      useSearchStore.getState().requestJump({ view: 'tool', toolId: 'json_formatter' });
    });
    expect(useUiStore.getState().view).toBe('tool');
    expect(useToolStateStore.getState().currentToolId).toBe('json_formatter');
  });

  it('welcome 目标回到欢迎页', () => {
    renderHook(() => useSearchJump());
    act(() => {
      useSearchStore.getState().requestJump({ view: 'welcome' });
    });
    expect(useUiStore.getState().view).toBe('welcome');
    expect(useToolStateStore.getState().currentToolId).toBeNull();
  });

  it('history / about 目标切换视图', () => {
    renderHook(() => useSearchJump());
    act(() => {
      useSearchStore.getState().requestJump({ view: 'history' });
    });
    expect(useUiStore.getState().view).toBe('history');
  });

  it('settings 目标切换设置视图并保留 target 供 SettingsDialog 消费', () => {
    renderHook(() => useSearchJump());
    act(() => {
      useSearchStore.getState().requestJump({ view: 'settings', settingsMenu: 'shortcuts' });
    });
    expect(useUiStore.getState().view).toBe('settings');
    // target 不应被 useSearchJump 消费,由 SettingsDialog 处理
    expect(useSearchStore.getState().target).not.toBeNull();
  });

  it('tool 目标携带 anchor 时定位并高亮 DOM 元素', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-search-anchor', 'json_formatter:input');
    document.body.appendChild(el);

    renderHook(() => useSearchJump());
    act(() => {
      useSearchStore.getState().requestJump({
        view: 'tool',
        toolId: 'json_formatter',
        anchor: 'json_formatter:input',
      });
    });

    // 等待重试调度
    await new Promise((r) => setTimeout(r, 150));
    expect(el.classList.contains('search-anchor-highlight')).toBe(true);

    // 高亮自动消退
    await new Promise((r) => setTimeout(r, HIGHLIGHT_MS + 300));
    expect(el.classList.contains('search-anchor-highlight')).toBe(false);
  });

  it('文本目标:打开文本编辑器 + 切换 tab + 高亮 decoration + 定位', async () => {
    const ed = fakeEditor();
    registerTabEditor('tab-1', ed);
    useEditorWorkspaceStore.setState({
      workspace: {
        tabs: [makeTab('tab-2'), makeTab('tab-1', 'foo hello\nbar foo')],
        activeTabId: 'tab-2',
        leftSidebarVisible: true,
        sidebarWidth: 288,
        folders: [],
        expandedDirs: [],
      },
      ready: true,
      userTouched: true,
      error: null,
    });

    renderHook(() => useSearchJump());
    act(() => {
      useSearchStore.getState().requestJump({
        view: 'tool',
        toolId: 'text_editor',
        tabId: 'tab-1',
        textQuery: 'foo',
      });
    });

    expect(useUiStore.getState().view).toBe('tool');
    expect(useToolStateStore.getState().currentToolId).toBe('text_editor');
    expect(useEditorWorkspaceStore.getState().workspace.activeTabId).toBe('tab-1');

    // 等待重试调度找到编辑器实例
    await new Promise((r) => setTimeout(r, 200));
    expect(ed.deltaDecorations).toHaveBeenCalled();
    expect(ed.revealRangeInCenter).toHaveBeenCalled();
    expect(ed.setSelection).toHaveBeenCalled();
    expect(ed.focus).toHaveBeenCalled();
    expect(useSearchStore.getState().target).toBeNull();
    unregisterTabEditor('tab-1', ed);
  });

  it('文本目标:连续跳转不同 tab 时不清空其他实例的 decoration', async () => {
    const edA = fakeEditor();
    const edB = fakeEditor();
    registerTabEditor('tab-a', edA);
    registerTabEditor('tab-b', edB);
    useEditorWorkspaceStore.setState({
      workspace: {
        tabs: [makeTab('tab-a', 'foo a'), makeTab('tab-b', 'foo b')],
        activeTabId: 'tab-a',
        leftSidebarVisible: true,
        sidebarWidth: 288,
        folders: [],
        expandedDirs: [],
      },
      ready: true,
      userTouched: true,
      error: null,
    });

    renderHook(() => useSearchJump());
    // 跳转到 tab-a
    act(() => {
      useSearchStore.getState().requestJump({
        view: 'tool',
        toolId: 'text_editor',
        tabId: 'tab-a',
        textQuery: 'foo',
      });
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(edA.deltaDecorations).toHaveBeenCalledTimes(1);

    // 跳转到 tab-b:清理只作用于同一实例,不调用 edA 的清理
    act(() => {
      useSearchStore.getState().requestJump({
        view: 'tool',
        toolId: 'text_editor',
        tabId: 'tab-b',
        textQuery: 'foo',
      });
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(edB.deltaDecorations).toHaveBeenCalledTimes(1);
    // edA 只被应用过一次(未收到跨实例清理调用)
    expect(edA.deltaDecorations).toHaveBeenCalledTimes(1);
    unregisterTabEditor('tab-a', edA);
    unregisterTabEditor('tab-b', edB);
  });

  it('文本目标:tab 已关闭时静默降级(仅切工具不定位)', async () => {
    renderHook(() => useSearchJump());
    act(() => {
      useSearchStore.getState().requestJump({
        view: 'tool',
        toolId: 'text_editor',
        tabId: 'gone',
        textQuery: 'foo',
      });
    });
    expect(useToolStateStore.getState().currentToolId).toBe('text_editor');
    await new Promise((r) => setTimeout(r, 200));
    // 未注册编辑器实例 → 不抛错,静默降级
    expect(useSearchStore.getState().target).toBeNull();
  });

  it('consumes target 防止重复触发', () => {
    renderHook(() => useSearchJump());
    act(() => {
      useSearchStore.getState().requestJump({ view: 'welcome' });
    });
    expect(useSearchStore.getState().target).toBeNull();
  });
});

describe('scheduleHighlight', () => {
  it('锚点不存在时静默降级(不抛错)', async () => {
    expect(() => scheduleHighlight('not:exists')).not.toThrow();
    await new Promise((r) => setTimeout(r, 300));
  });

  it('延迟出现的目标最终被定位', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-search-anchor', 'lazy:anchor');
    setTimeout(() => document.body.appendChild(el), 250);

    scheduleHighlight('lazy:anchor');
    await new Promise((r) => setTimeout(r, 500));
    expect(el.classList.contains('search-anchor-highlight')).toBe(true);
  });
});

/**
 * toolMenubarStore keepalive 行为测试 —— 注册重放 / 归属清理
 *
 * 场景(keepalive 架构下):
 * - 两工具先后挂载,后者的 setMenus 覆盖 store 展示;先挂载的工具切回
 *   时不会重新挂载(组件常驻),菜单栏因此丢失 —— 由 currentToolId 订阅
 *   把归属工具的最近注册重放回去
 * - 工具卸载(LRU 淘汰)带 toolId 调 clear:只清自己的注册,不误伤
 *   当前归属工具的展示
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToolMenusStore } from './toolMenubarStore';
import { useToolStateStore } from './toolStateStore';
import type { ToolMenu } from '@/types/tool-menu';

function fakeMenus(label: string): ToolMenu[] {
  return [
    {
      id: 'file',
      label,
      groups: [{ items: [{ id: 'open', label: '打开', onSelect: vi.fn() }] }],
    },
  ];
}

function resetStores(currentToolId: string | null): void {
  useToolMenusStore.getState().clear();
  useToolStateStore.setState({ currentToolId });
}

describe('toolMenubarStore(keepalive 注册重放)', () => {
  beforeEach(() => {
    resetStores(null);
  });

  it('后挂载工具覆盖菜单后,切回先挂载工具时其注册被重放', () => {
    // 编辑器先挂载(默认启动工具)
    const editorMenus = fakeMenus('编辑器菜单');
    useToolMenusStore.getState().setMenus('text_editor', editorMenus);
    useToolStateStore.setState({ currentToolId: 'text_editor' });
    expect(useToolMenusStore.getState().ownerToolId).toBe('text_editor');

    // Markdown 后挂载:菜单展示被覆盖(keepalive 下编辑器组件不卸载)
    const mdMenus = fakeMenus('Markdown 菜单');
    useToolMenusStore.getState().setMenus('markdown_preview', mdMenus);
    useToolStateStore.setState({ currentToolId: 'markdown_preview' });
    expect(useToolMenusStore.getState().menus).toBe(mdMenus);

    // 切回编辑器:编辑器组件不重新挂载,订阅重放其注册
    useToolStateStore.setState({ currentToolId: 'text_editor' });
    expect(useToolMenusStore.getState().ownerToolId).toBe('text_editor');
    expect(useToolMenusStore.getState().menus).toBe(editorMenus);

    // 再切回 Markdown:同样重放
    useToolStateStore.setState({ currentToolId: 'markdown_preview' });
    expect(useToolMenusStore.getState().menus).toBe(mdMenus);
  });

  it('激活未注册菜单的工具:清掉展示(Titlebar 归属校验同效,store 保持一致)', () => {
    useToolMenusStore.getState().setMenus('text_editor', fakeMenus('编辑器'));
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    const s = useToolMenusStore.getState();
    expect(s.ownerToolId).toBeNull();
    expect(s.menus).toHaveLength(0);
  });

  it('带 toolId 的 clear 只清自己的注册:不误伤当前归属展示', () => {
    const editorMenus = fakeMenus('编辑器');
    const mdMenus = fakeMenus('Markdown');
    useToolMenusStore.getState().setMenus('text_editor', editorMenus);
    useToolMenusStore.getState().setMenus('markdown_preview', mdMenus);
    useToolStateStore.setState({ currentToolId: 'markdown_preview' });

    // 编辑器被 LRU 淘汰卸载:带自己的 id 清理
    useToolMenusStore.getState().clear('text_editor');
    // Markdown 的展示不受影响
    expect(useToolMenusStore.getState().menus).toBe(mdMenus);
    expect(useToolMenusStore.getState().ownerToolId).toBe('markdown_preview');
    // 切回编辑器:注册已清,不再重放
    useToolStateStore.setState({ currentToolId: 'text_editor' });
    expect(useToolMenusStore.getState().ownerToolId).toBeNull();
  });

  it('归属工具自己卸载:清掉展示', () => {
    useToolMenusStore.getState().setMenus('text_editor', fakeMenus('编辑器'));
    useToolStateStore.setState({ currentToolId: 'text_editor' });
    useToolMenusStore.getState().clear('text_editor');
    expect(useToolMenusStore.getState().ownerToolId).toBeNull();
    expect(useToolMenusStore.getState().menus).toHaveLength(0);
  });

  it('无条件 clear(旧调用形态/测试隔离):展示与注册表一起重置', () => {
    useToolMenusStore.getState().setMenus('a', fakeMenus('A'));
    useToolMenusStore.getState().setMenus('b', fakeMenus('B'));
    useToolMenusStore.getState().clear();
    const s = useToolMenusStore.getState();
    expect(s.ownerToolId).toBeNull();
    expect(s.menus).toHaveLength(0);
    expect(s.registry.size).toBe(0);
    // 重置后激活任何工具都不再重放
    useToolStateStore.setState({ currentToolId: 'a' });
    expect(useToolMenusStore.getState().menus).toHaveLength(0);
  });
});

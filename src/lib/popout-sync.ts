/**
 * 弹出窗口 ↔ 主窗口 状态回写同步
 *
 * 快照式模型的补充语义(详见 prd/tool-popout-window/design.md §关闭时回写):
 * - 弹窗侧:Rust 拦截弹窗关闭并 emit_to 定向发送 `app:popout-close-requested`,
 *   PopoutApp 收到后调用 flushPopoutToolState 冲刷该工具 store 中防抖窗口内
 *   尚未落盘的数据,再自行 destroy;
 * - 主窗口侧:Rust 在弹窗 Destroyed 时广播 `app:popout-closed`(载荷为窗口
 *   label),App 收到后调用 rehydrateToolStateFromPopout 把该工具持久化状态
 *   重新读入内存 store,弹窗中的编辑即回写可见。
 * 仍不做打开期间的实时双向同步。
 *
 * 实现说明:store 模块经动态 import 引入——这些模块原本位于懒加载的工具
 * chunk 中,静态引入会把它们拉进主窗口首屏包。
 */

import { POPOUT_LABEL_PREFIX } from '@/lib/popout-window';

/** 从窗口 label(`popout-<toolId>`)解析 toolId;非弹窗 label 返回 null */
export function getPopoutToolIdFromLabel(label: string): string | null {
  return label.startsWith(POPOUT_LABEL_PREFIX) ? label.slice(POPOUT_LABEL_PREFIX.length) : null;
}

/**
 * 弹窗关闭前冲刷该工具 store 的待落盘数据(防抖兜底)。
 * markdown_preview 的草稿由组件在弹窗模式下改为即时直写(见 MarkdownPreview),
 * 偏好走 zustand persist 同步写,均无需此处处理。
 */
export async function flushPopoutToolState(toolId: string): Promise<void> {
  switch (toolId) {
    case 'text_compare':
      await (await import('@/tools/textCompareStore')).useTextCompareStore.getState().persistDocs();
      return;
    case 'text_editor':
      await (
        await import('@/tools/code-editor-workspace/useEditorWorkspaceStore')
      ).useEditorWorkspaceStore
        .getState()
        .persist();
      return;
    case 'json_formatter': {
      const { useJsonFormatterStore } = await import('@/tools/jsonFormatterStore');
      await useJsonFormatterStore.getState().persistDocs();
      await useJsonFormatterStore.getState().persistHistory();
      return;
    }
    default:
      return;
  }
}

/** 主窗口在弹窗关闭后,把该工具持久化状态强制重读进内存 store(回写可见) */
export async function rehydrateToolStateFromPopout(toolId: string): Promise<void> {
  switch (toolId) {
    case 'text_compare':
      await (await import('@/tools/textCompareStore')).useTextCompareStore.getState().hydrate(true);
      return;
    case 'text_editor':
      await (
        await import('@/tools/code-editor-workspace/useEditorWorkspaceStore')
      ).useEditorWorkspaceStore
        .getState()
        .hydrate(true);
      return;
    case 'json_formatter':
      await (
        await import('@/tools/jsonFormatterStore')
      ).useJsonFormatterStore
        .getState()
        .hydrate(true);
      return;
    case 'markdown_preview':
      await (
        await import('@/tools/markdownPreviewStore')
      ).useMarkdownPreviewStore.persist.rehydrate();
      return;
    default:
      return;
  }
}

/**
 * 工作区持久化生命周期 —— hydrate 还原、防抖落盘、关闭/卸载冲刷
 *
 * 从 EditorWorkbench 拆出:这四段效果共用同一个防抖定时器句柄,关心的是
 * 「workspace 何时写进 Rust config」而不是编辑器行为,与 UI 无耦合。
 *
 * 约束:
 * - ready 之前 persist 是 no-op(避免用空工作区覆盖已存数据);
 * - 落盘是整份 config 的全量重写,故防抖窗口按内容总长度自适应;
 * - 窗口关闭走后端拦截 + 前端立即冲刷,不弹「未保存更改」确认框。
 */
import { useEffect, useRef } from 'react';
import { listen, safeInvoke } from '@/lib/ipc';
import { persistDelayFor } from '@/lib/persist-debounce';
import { windowCloseReady } from './fileOps';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import type { Workspace } from './schema';

export function useWorkspacePersistence({
  workspace,
  ready,
  hydrate,
}: {
  /** 当前工作区(变化即触发一次防抖落盘) */
  workspace: Workspace;
  /** hydrate 是否完成(未完成时不写盘) */
  ready: boolean;
  /** 从 Rust config 还原工作区 */
  hydrate: (force?: boolean) => Promise<void>;
}): void {
  /** workspace 变更防抖持久化的定时器句柄;同时给窗口关闭守卫复用 */
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 首次挂载从 Rust config 还原工作区
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /**
   * 窗口关闭守卫:工作区内容已通过防抖 effect 实时写入 Rust config 缓存
   * (`tool_prefs.editor_workspace_v1`),再次启动会自动还原,因此不再弹
   * 「未保存更改」确认框。后端拦截关闭后,前端只需立即冲刷待落盘数据
   * 并退出,避免防抖窗口尚未到点时的最后改动丢失。
   *
   * 仅在 Tauri 运行时生效(浏览器 dev / 测试环境跳过)。
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    void windowCloseReady();
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen('app:close-requested', async () => {
          // 取消待执行的防抖 persist,立即写一次最新工作区到缓存
          if (persistTimer.current) {
            clearTimeout(persistTimer.current);
            persistTimer.current = null;
          }
          try {
            await useEditorWorkspaceStore.getState().persist();
          } catch {
            // 持久化异常不影响退出,避免阻塞关闭流程
          }
          void safeInvoke('app_quit');
        });
      } catch {
        // 非 Tauri 环境或事件系统不可用:不拦截窗口关闭
      }
    })();
    return () => unlisten?.();
  }, []);

  // workspace 变更 → 防抖持久化(ready 前 persist 为 no-op,不会覆盖已存数据)。
  // 防抖窗口按各 Tab 内容总长度自适应:工作区落盘是整份 config 的全量重写,
  // 数 MB 载荷下固定短窗口会在每次打字停顿处重写整份文件,拉长窗口把连续
  // 编辑合并为一次磁盘写(关闭与卸载仍有立即冲刷兜底,不丢最后一次改动)
  useEffect(() => {
    if (!ready) return;
    let totalChars = 0;
    for (const t of workspace.tabs) totalChars += t.content.length;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      void useEditorWorkspaceStore.getState().persist();
    }, persistDelayFor(totalChars));
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [workspace, ready]);

  // 卸载时(切换工具/关闭面板)立即写入未落盘的改动,避免防抖窗口内数据丢失;
  // 空依赖数组的 cleanup 仅在组件真正卸载时执行
  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
        void useEditorWorkspaceStore.getState().persist();
      }
    };
  }, []);
}

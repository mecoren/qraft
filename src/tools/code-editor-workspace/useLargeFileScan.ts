/**
 * 大文件 Tab 的索引扫描触发器 —— EditorWorkbench 挂载给 largeFile Tab 用
 *
 * 职责:
 * - Tab 无 largeFileInfo(打开/还原后首次激活)时调用 `fs_large_file_info`
 *   发起行索引扫描,完成写入 store(setLargeFileInfo),失败写入错误
 * - 订阅 `app:large-file-progress` 事件,把扫描进度写入对应 Tab
 *   (0-100;事件迟到于完成时被 store 的 setLargeFileProgress 忽略)
 * - 重扫去重:同 Tab 的 in-flight 扫描期间不重复发起(关闭 Tab 再开
 *   或激活另一 largeFile Tab 不受影响)
 * - Tab 关闭即取消该 Tab 的在飞扫描(10GB 索引可达数秒,不该为已关的
 *   Tab 继续读盘);切换 Tab 不取消 —— 结果对仍打开的 Tab 有用
 */
import { useEffect, useRef } from 'react';
import { listen } from '@/lib/ipc';
import type { EditorTab } from './schema';
import {
  cancelLargeFileScan,
  largeFileInfo,
  newLargeFileScanId,
  type LargeFileProgressPayload,
} from './fileOps';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';

export function useLargeFileScan(activeTab: EditorTab | null): void {
  // in-flight 扫描:Tab id → 本次扫描的取消标识
  const scanningRef = useRef<Map<string, string>>(new Map());
  const tabs = useEditorWorkspaceStore((state) => state.workspace.tabs);

  // 激活的 largeFile Tab 缺元数据(未扫/重开)→ 发起扫描
  useEffect(() => {
    if (!activeTab?.largeFile || !activeTab.path) return;
    // 已有元数据 / 已失败:不重复扫描(错误态由用户关闭 Tab 重开重试)
    if (activeTab.largeFileInfo !== undefined || activeTab.largeFileError != null) return;
    if (scanningRef.current.has(activeTab.id)) return;
    const tabId = activeTab.id;
    const path = activeTab.path;
    const scanId = newLargeFileScanId();
    scanningRef.current.set(tabId, scanId);
    void largeFileInfo(path, scanId)
      .then((meta) => {
        useEditorWorkspaceStore.getState().setLargeFileInfo(tabId, meta);
      })
      .catch((e) => {
        useEditorWorkspaceStore
          .getState()
          .setLargeFileError(tabId, e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        // 只清自己这次:被关闭时 cancel 效应已移除条目,勿误删重开后的新扫描
        if (scanningRef.current.get(tabId) === scanId) scanningRef.current.delete(tabId);
      });
  }, [activeTab]);

  // Tab 从工作区消失 → 取消仍在飞的扫描(覆盖 closeTab / 批量关闭等所有关闭路径)
  useEffect(() => {
    const alive = new Set(tabs.map((tab) => tab.id));
    for (const [tabId, scanId] of scanningRef.current) {
      if (alive.has(tabId)) continue;
      scanningRef.current.delete(tabId);
      void cancelLargeFileScan(scanId);
    }
  }, [tabs]);

  // 进度事件:按路径匹配 Tab(事件载荷只带路径,不带 Tab id)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<LargeFileProgressPayload>('app:large-file-progress', (p) => {
          if (!p?.path) return;
          const state = useEditorWorkspaceStore.getState();
          const tab = state.workspace.tabs.find(
            (t) => t.largeFile && t.path === p.path && t.largeFileInfo === undefined,
          );
          if (!tab) return;
          const percent = p.total > 0 ? (p.scanned / p.total) * 100 : 0;
          state.setLargeFileProgress(tab.id, percent);
        });
      } catch {
        // 非 Tauri 环境无事件通道:静默(测试环境)
      }
    })();
    return () => unlisten?.();
  }, []);
}

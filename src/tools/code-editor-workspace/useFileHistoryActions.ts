/**
 * 「历史版本」对话框状态 —— 保存前快照的列表 / 对比 / 恢复 / 清空
 *
 * 从 EditorWorkbench 拆出:对话框生命周期(打开即拉取、关闭即卸载重拉)自成
 * 闭环,只有「对比当前」需要与工作区的对比状态握手,故经 compareWithLatestTab
 * 注入,不反向依赖编辑器实例或保存逻辑。
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  clearFileHistory,
  listFileHistory,
  readFileHistorySnapshot,
  type FileSnapshotMeta,
} from './fileOps';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';

/** 历史对话框当前指向的 Tab(必带磁盘路径) */
type HistoryTarget = { id: string; path: string; title: string };

export function useFileHistoryActions({
  compareWithLatestTab,
}: {
  /** 把刚追加到末尾的快照 Tab 与指定 Tab 组成对比并激活 */
  compareWithLatestTab: (leftTabId: string) => void;
}): {
  /** 历史对话框目标 Tab id(null = 关闭) */
  historyTabId: string | null;
  /** 历史快照元数据(null = 加载中) */
  historySnapshots: FileSnapshotMeta[] | null;
  historySelectedId: string | null;
  setHistorySelectedId: (id: string | null) => void;
  handleOpenHistory: (tabId: string) => void;
  handleHistoryCancel: () => void;
  handleHistoryCompare: (snapshotId: string) => void;
  handleHistoryRestore: (snapshotId: string) => void;
  handleHistoryClear: () => void;
} {
  const { t } = useTranslation();
  /**
   * 「历史版本」对话框:目标 Tab id(打开即非 null,条件渲染挂载;
   * 关闭即卸载,下次打开重新拉取快照列表)。
   */
  const [historyTabId, setHistoryTabId] = useState<string | null>(null);
  /** 历史快照元数据(打开对话框时拉取;null = 加载中) */
  const [historySnapshots, setHistorySnapshots] = useState<FileSnapshotMeta[] | null>(null);
  /** 当前选中的历史版本 id(缺省自动选最新) */
  const [historySelectedId, setHistorySelectedId] = useState<string | null>(null);

  /** 按 id 取对话框目标 Tab;无路径的 Tab(untitled / 快照)没有历史 */
  const findTarget = useCallback((tabId: string): HistoryTarget | null => {
    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === tabId);
    return tab?.path ? { id: tab.id, path: tab.path, title: tab.title } : null;
  }, []);

  /** 关闭历史对话框(遮罩 / Esc / 取消):清空选中与列表,下次打开重拉 */
  const handleHistoryCancel = useCallback(() => {
    setHistoryTabId(null);
    setHistorySnapshots(null);
    setHistorySelectedId(null);
  }, []);

  /**
   * 打开「历史版本」对话框(Tab 右键菜单触发)并拉取该文件全部本地快照
   * (保存前快照,新 → 旧);加载失败以空列表呈现(空态文案),不阻塞打开。
   */
  const handleOpenHistory = useCallback(
    (tabId: string) => {
      const target = findTarget(tabId);
      if (!target) return;
      setHistoryTabId(target.id);
      setHistorySnapshots(null);
      setHistorySelectedId(null);
      void (async () => {
        try {
          const snapshots = await listFileHistory(target.path);
          setHistorySnapshots(snapshots);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t('tools.text_editor.history_load_error'));
          setHistorySnapshots([]);
        }
      })();
    },
    [findTarget, t],
  );

  /** 当前对话框指向的 Tab(null = 对话框未打开或文件已关闭) */
  const currentTarget = useCallback((): HistoryTarget | null => {
    return historyTabId ? findTarget(historyTabId) : null;
  }, [findTarget, historyTabId]);

  /** 把选中快照读成「历史快照 Tab」(无路径,标题标注版本时间) */
  const openSnapshotTab = useCallback(
    async (target: HistoryTarget, snapshotId: string) => {
      const content = await readFileHistorySnapshot(target.path, snapshotId);
      const time = new Date(Number(snapshotId)).toLocaleTimeString();
      useEditorWorkspaceStore
        .getState()
        .openDroppedText(
          t('tools.text_editor.history_snapshot_title', { name: target.title, time }),
          content,
        );
    },
    [t],
  );

  /**
   * 「对比当前」:快照读成历史 Tab 后与当前编辑 Tab 组成对比并激活
   * (与外部修改冲突的「对比」同款动线),随后关闭对话框。
   */
  const handleHistoryCompare = useCallback(
    (snapshotId: string) => {
      const target = currentTarget();
      if (!target) return;
      void (async () => {
        try {
          await openSnapshotTab(target, snapshotId);
          compareWithLatestTab(target.id);
          handleHistoryCancel();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t('tools.text_editor.history_load_error'));
        }
      })();
    },
    [currentTarget, openSnapshotTab, compareWithLatestTab, handleHistoryCancel, t],
  );

  /**
   * 「恢复内容」:把历史内容读进一个新 Tab(不动原文件;
   * 用户确认后再自行保存,避免一键覆盖磁盘)。
   */
  const handleHistoryRestore = useCallback(
    (snapshotId: string) => {
      const target = currentTarget();
      if (!target) return;
      void (async () => {
        try {
          await openSnapshotTab(target, snapshotId);
          handleHistoryCancel();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t('tools.text_editor.history_load_error'));
        }
      })();
    },
    [currentTarget, openSnapshotTab, handleHistoryCancel, t],
  );

  /** 「清空历史」:删除该文件全部快照(确认后执行,列表回到空态) */
  const handleHistoryClear = useCallback(() => {
    const target = currentTarget();
    if (!target) return;
    void (async () => {
      try {
        await clearFileHistory(target.path);
        setHistorySnapshots([]);
        setHistorySelectedId(null);
        toast.success(t('tools.text_editor.history_cleared'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.history_load_error'));
      }
    })();
  }, [currentTarget, t]);

  return {
    historyTabId,
    historySnapshots,
    historySelectedId,
    setHistorySelectedId,
    handleOpenHistory,
    handleHistoryCancel,
    handleHistoryCompare,
    handleHistoryRestore,
    handleHistoryClear,
  };
}

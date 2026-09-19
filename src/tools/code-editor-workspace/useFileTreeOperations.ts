/**
 * 文件树三操作 —— 左栏「文件夹」树的新建 / 重命名 / 删除
 *
 * 从 EditorWorkbench 拆出:三动作都是「对话框收集名称 → IPC 落盘 → 回写工作区
 * 引用 → 让树重读缓存」的同一条链路,且只依赖 store 动作(toggleDirExpanded /
 * retargetTabPath / closeTabsUnderPath 等),不触碰编辑器实例。
 *
 * 约束:
 * - 树是按目录缓存懒加载的,落盘成功后必须换 `treeRefreshKey` 才看得到新条目;
 * - 删除影响磁盘且无回收站兜底,一律走确认对话框;
 * - 重命名/删除要同步已打开 Tab 的路径引用,否则保存会写回旧路径。
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CommandError } from '@/lib/ipc';
import { createTreeEntry, deleteTreeEntry, renameTreeEntry, type DirEntry } from './fileOps';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';

/** 树操作名称输入对话框(新建:目标目录 + 类型;重命名:原路径 + 当前名) */
export type TreeOpDialog =
  | { mode: 'create'; dirPath: string; isDir: boolean }
  | { mode: 'rename'; oldPath: string; name: string; isDir: boolean };

export function useFileTreeOperations(): {
  /** 树缓存刷新信号:任一操作落盘成功后递增,FolderTreeSection 清缓存重载 */
  treeRefreshKey: number;
  /** 名称输入对话框状态(null = 关闭) */
  treeOp: TreeOpDialog | null;
  /** 删除确认对话框目标(null = 关闭) */
  treeDelete: DirEntry | null;
  openTreeCreate: (dirPath: string, isDir: boolean) => void;
  openTreeRename: (entry: DirEntry) => void;
  openTreeDelete: (entry: DirEntry) => void;
  closeTreeOp: () => void;
  closeTreeDelete: () => void;
  handleTreeCreate: (name: string) => void;
  handleTreeRename: (name: string) => void;
  handleTreeDeleteConfirmed: () => void;
} {
  const { t } = useTranslation();
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [treeOp, setTreeOp] = useState<TreeOpDialog | null>(null);
  const [treeDelete, setTreeDelete] = useState<DirEntry | null>(null);

  const refreshTree = useCallback(() => {
    setTreeRefreshKey((k) => k + 1);
  }, []);
  const closeTreeOp = useCallback(() => setTreeOp(null), []);
  const closeTreeDelete = useCallback(() => setTreeDelete(null), []);
  const openTreeCreate = useCallback(
    (dirPath: string, isDir: boolean) => setTreeOp({ mode: 'create', dirPath, isDir }),
    [],
  );
  const openTreeRename = useCallback(
    (entry: DirEntry) =>
      setTreeOp({ mode: 'rename', oldPath: entry.path, name: entry.name, isDir: entry.isDir }),
    [],
  );
  const openTreeDelete = useCallback((entry: DirEntry) => setTreeDelete(entry), []);

  /** 统一错误提示:重名冲突给专门文案,其余透传 CommandError message */
  const reportTreeOpError = useCallback(
    (e: unknown, kind: 'create' | 'rename' | 'delete') => {
      if (e instanceof CommandError && e.code === 'ERR_ALREADY_EXISTS') {
        toast.error(t('tools.text_editor.tree_err_exists'));
        return;
      }
      if (
        e instanceof CommandError &&
        e.code === 'ERR_FILE_UNSUPPORTED' &&
        String(e.message).includes('not empty')
      ) {
        toast.error(t('tools.text_editor.tree_err_dir_not_empty'));
        return;
      }
      const key =
        kind === 'create'
          ? 'tools.text_editor.tree_err_create'
          : kind === 'rename'
            ? 'tools.text_editor.tree_err_rename'
            : 'tools.text_editor.tree_err_delete';
      toast.error(e instanceof Error ? e.message : t(key));
    },
    [t],
  );

  /** 创建条目(名称对话框确认后):拼路径 → IPC → 展开父目录并刷新树 */
  const handleTreeCreate = useCallback(
    (name: string) => {
      const op = treeOp;
      setTreeOp(null);
      if (op?.mode !== 'create') return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const sep = op.dirPath.includes('\\') && !op.dirPath.includes('/') ? '\\' : '/';
      const target = `${op.dirPath}${sep}${trimmed}`;
      void createTreeEntry(target, op.isDir)
        .then(() => {
          // 父目录若未展开则展开(新条目立即可见),再刷新缓存
          useEditorWorkspaceStore.getState().toggleDirExpanded(op.dirPath);
          refreshTree();
          toast.success(
            op.isDir
              ? t('tools.text_editor.tree_created_folder', { name: trimmed })
              : t('tools.text_editor.tree_created_file', { name: trimmed }),
          );
        })
        .catch((e) => reportTreeOpError(e, 'create'));
    },
    [treeOp, refreshTree, reportTreeOpError, t],
  );

  /** 重命名条目(名称对话框确认后):拼新路径 → IPC → Tab 路径重定向 + 刷新树 */
  const handleTreeRename = useCallback(
    (name: string) => {
      const op = treeOp;
      setTreeOp(null);
      if (op?.mode !== 'rename') return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === op.name) return;
      const sep = op.oldPath.includes('\\') && !op.oldPath.includes('/') ? '\\' : '/';
      const parent = op.oldPath.slice(0, op.oldPath.lastIndexOf(sep));
      const newPath = `${parent}${sep}${trimmed}`;
      void renameTreeEntry(op.oldPath, newPath)
        .then(() => {
          // 已打开 Tab 的路径随迁移(目录重命名时子树内全部 Tab),
          // 内容与 dirty 状态原样保留
          useEditorWorkspaceStore.getState().retargetTabPath(op.oldPath, newPath);
          refreshTree();
          toast.success(t('tools.text_editor.tree_renamed', { name: trimmed }));
        })
        .catch((e) => reportTreeOpError(e, 'rename'));
    },
    [treeOp, refreshTree, reportTreeOpError, t],
  );

  /** 确认删除(对话框确认后):IPC → 关联 Tab/展开状态清理 + 刷新树 */
  const handleTreeDeleteConfirmed = useCallback(() => {
    const entry = treeDelete;
    setTreeDelete(null);
    if (!entry) return;
    void deleteTreeEntry(entry.path)
      .then(() => {
        const store = useEditorWorkspaceStore.getState();
        if (entry.isDir) {
          // 子树内 Tab 关闭(数量提示);展开状态清理;工作区引用的对比项不动
          const closed = store.closeTabsUnderPath(entry.path);
          store.pruneExpandedDirs(entry.path);
          if (closed > 0) {
            toast.success(
              t('tools.text_editor.tree_deleted_dir_tabs', {
                name: entry.name,
                count: closed,
              }),
            );
          } else {
            toast.success(t('tools.text_editor.tree_deleted', { name: entry.name }));
          }
        } else {
          store.closeTabByPath(entry.path);
          toast.success(t('tools.text_editor.tree_deleted', { name: entry.name }));
        }
        refreshTree();
      })
      .catch((e) => reportTreeOpError(e, 'delete'));
  }, [treeDelete, refreshTree, reportTreeOpError, t]);

  return {
    treeRefreshKey,
    treeOp,
    treeDelete,
    openTreeCreate,
    openTreeRename,
    openTreeDelete,
    closeTreeOp,
    closeTreeDelete,
    handleTreeCreate,
    handleTreeRename,
    handleTreeDeleteConfirmed,
  };
}

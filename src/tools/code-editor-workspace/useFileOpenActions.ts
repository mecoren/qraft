/**
 * 打开文件 / 打开文件夹 —— 对话框、文件树节点、失败分流
 *
 * 从 EditorWorkbench 拆出:这条链路只处理「磁盘 → 工作区 Tab」的载入语义。
 * 失败分流是它存在的理由:二进制可「仍要打开」,超限转大文件只读视图,
 * 其余错误展示后端真实消息 —— 三处入口(对话框 / 树节点 / 强制打开)共用。
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CommandError } from '@/lib/ipc';
import { formatBytes } from '@/lib/file-utils';
import { folderNameFromPath, useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import { fileNameFromPath } from './languageMap';
import {
  OPEN_REASON_BINARY,
  OPEN_REASON_TOO_LARGE,
  forceOpenFile,
  openFolderDialog,
  openTextFileDialog,
  readTextFileEncoded,
  type OpenFileFailure,
} from './fileOps';

export function useFileOpenActions({
  clearActiveCompare,
}: {
  /** 载入新文件后退出对比视图(与打开/切换文件的既有行为一致) */
  clearActiveCompare: () => void;
}): {
  handleOpen: () => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  handleOpenTreeFile: (path: string) => Promise<void>;
} {
  const { t } = useTranslation();

  /**
   * 打开文件失败的统一提示(仿 VSCode 二进制文件占位编辑器):
   * - `binary`:可恢复,toast 带「仍要打开」动作按钮,点击经 `forceOpenFile`
   *   按探测编码有损解码打开(VSCode Open Anyway)
   * - `too-large`:不可恢复,仅提示文件大小与上限
   * - 其余读取错误:展示后端真实错误消息
   */
  const showOpenFailure = useCallback(
    (failure: OpenFileFailure | { path: string; reason?: undefined }) => {
      const name = fileNameFromPath(failure.path);
      if ('reason' in failure && failure.reason === OPEN_REASON_TOO_LARGE) {
        // 超限文件切换到大文件只读查看模式(fs_large_file_info 流式打开)
        useEditorWorkspaceStore.getState().openLargeFile(failure.path);
        toast.info(
          t('tools.text_editor.toast_large_opened', { name, size: formatBytes(failure.size ?? 0) }),
        );
        return;
      }
      if ('reason' in failure && failure.reason === OPEN_REASON_BINARY) {
        toast.error(t('tools.text_editor.err_file_binary', { name }), {
          duration: 10_000,
          action: {
            label: t('tools.text_editor.open_anyway'),
            onClick: () => {
              void forceOpenFile(failure.path)
                .then((result) => {
                  useEditorWorkspaceStore
                    .getState()
                    .openLocalFile(result.path, result.content, result.encoding, result.mtimeMs);
                  clearActiveCompare();
                })
                .catch((e) => {
                  toast.error(
                    e instanceof Error ? e.message : t('tools.text_editor.err_open_file'),
                  );
                });
            },
          },
        });
        return;
      }
      toast.error(t('tools.text_editor.err_open_file'));
    },
    [clearActiveCompare, t],
  );

  /** 打开本地文件对话框并载入(或激活已打开的同路径 Tab);编码随文件探测结果记录 */
  const handleOpen = useCallback(async () => {
    try {
      const result = await openTextFileDialog();
      if (result?.file) {
        useEditorWorkspaceStore
          .getState()
          .openLocalFile(
            result.file.path,
            result.file.content,
            result.file.encoding,
            result.file.mtimeMs,
          );
        clearActiveCompare();
      } else if (result?.failed) {
        showOpenFailure(result.failed);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_file'));
    }
  }, [clearActiveCompare, showOpenFailure, t]);

  /** 打开文件夹:加入左栏「文件夹」树(多根并存),默认展开根 */
  const handleOpenFolder = useCallback(async () => {
    try {
      const rootPath = await openFolderDialog();
      if (!rootPath) return; // 用户取消:静默
      useEditorWorkspaceStore.getState().openFolder(rootPath);
      toast.success(
        t('tools.text_editor.toast_folder_opened', { name: folderNameFromPath(rootPath) }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_folder'));
    }
  }, [t]);

  /**
   * 点击文件夹树中的文件:
   * - 已有同路径 Tab → 直接激活(不重复读取)
   * - 否则经 `fs_read_text_file_encoded` 读取并载入(编码自动探测);
   *   二进制(ERR_FILE_UNSUPPORTED)→ 弹「仍要打开」提示(仿 VSCode),
   *   超大(ERR_FILE_TOO_LARGE)→ 提示文件过大,
   *   文件节点保留在树中(组件层不做剔除)
   */
  const handleOpenTreeFile = useCallback(
    async (path: string) => {
      const state = useEditorWorkspaceStore.getState();
      const existing = state.workspace.tabs.find((t) => t.path === path);
      if (existing) {
        state.switchTab(existing.id);
        clearActiveCompare();
        return;
      }
      try {
        const result = await readTextFileEncoded(path);
        state.openLocalFile(result.path, result.content, result.encoding, result.mtimeMs);
        clearActiveCompare();
      } catch (e) {
        const name = fileNameFromPath(path);
        if (e instanceof CommandError && e.code === 'ERR_FILE_UNSUPPORTED') {
          showOpenFailure({ path, reason: OPEN_REASON_BINARY });
        } else if (e instanceof CommandError && e.code === 'ERR_FILE_TOO_LARGE') {
          // 超限文件:切换大文件只读查看模式(details 形如 { size, max })
          const detail = e.details as { size?: number; max?: number } | undefined;
          useEditorWorkspaceStore.getState().openLargeFile(path);
          toast.info(
            t('tools.text_editor.toast_large_opened', {
              name,
              size: formatBytes(detail?.size ?? 0),
            }),
          );
        } else {
          // 其余失败(未授权/不存在等):展示后端返回的真实错误信息
          toast.error(
            t('tools.text_editor.err_open_named', {
              name,
              reason: e instanceof Error ? e.message : t('tools.text_editor.err_unknown'),
            }),
          );
        }
      }
    },
    [clearActiveCompare, showOpenFailure, t],
  );

  return { handleOpen, handleOpenFolder, handleOpenTreeFile };
}

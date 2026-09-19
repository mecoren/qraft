/**
 * 保存与外部修改冲突 —— 写盘、编码另存、冲突三选
 *
 * 从 EditorWorkbench 拆出:这条链路只处理「编辑器内容 → 磁盘文件」的写入语义,
 * 与 UI 无耦合;冲突时把工作区对比(快照 vs 当前编辑)作为唯一的外部依赖注入。
 *
 * 乐观并发约定:
 * - Tab 记录了打开时的 mtime,保存带 expectedMtime;
 * - 磁盘已被外部改写(ERR_FILE_MODIFIED)→ 不写盘,交冲突三选对话框;
 * - 文件已被外部删除(ERR_FILE_NOT_FOUND)→ 由 saveToPathEncoded 去掉基准
 *   重试并在原路径重建,提示语换「已重新创建」;
 * - 写盘成功后刷新 mtime 基准,下一次保存以新基准判定。
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CommandError } from '@/lib/ipc';
import {
  fileMtimeMs,
  readTextFileEncoded,
  saveToPathEncoded,
  saveWithDialog,
  saveWithDialogEncoded,
} from './fileOps';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';

export function useFileSaveActions({
  compareWithLatestTab,
}: {
  /** 把刚追加到末尾的快照 Tab 与指定 Tab 组成对比并激活 */
  compareWithLatestTab: (leftTabId: string) => void;
}): {
  /** 冲突目标 Tab id(null = 对话框关闭) */
  modifiedConflict: string | null;
  closeConflict: () => void;
  /** 冲突目标 Tab(用于对话框标题) */
  conflictTab: { title: string } | null;
  /** 保存指定 Tab,返回是否成功(取消另存为 / 失败 / 命中冲突为 false) */
  saveTabById: (id: string, overwrite?: boolean) => Promise<boolean>;
  handleSave: () => void;
  handleSaveAll: () => Promise<void>;
  reopenWithEncoding: (encodingId: string) => Promise<void>;
  saveWithEncoding: (encodingId: string, overwrite?: boolean) => Promise<void>;
  handleConflictOverwrite: () => void;
  handleConflictReload: () => void;
  handleConflictCompare: () => void;
} {
  const { t } = useTranslation();
  /**
   * 保存冲突状态(null = 关闭):保存命中 ERR_FILE_MODIFIED(磁盘文件已被
   * 外部修改)时记录目标 Tab,弹「覆盖 / 对比 / 重新加载」三选。
   */
  const [modifiedConflict, setModifiedConflict] = useState<string | null>(null);
  const closeConflict = useCallback(() => setModifiedConflict(null), []);

  /**
   * 保存指定 Tab:已绑定路径直接写回(按 Tab 记录的编码),untitled 弹「另存为」。
   * `overwrite` 为 true 时跳过 mtime 校验(冲突对话框「覆盖」入口)。
   */
  const saveTabById = useCallback(
    async (id: string, overwrite = false): Promise<boolean> => {
      const state = useEditorWorkspaceStore.getState();
      const tab = state.workspace.tabs.find((t) => t.id === id);
      if (!tab) return false;
      // 大文件 Tab 恒只读:保存是 no-op(菜单项已禁用,防御性守卫)
      if (tab.largeFile) return false;
      try {
        if (tab.path) {
          // 按 Tab 记录的编码写回(状态栏可切换;缺省 UTF-8);带打开时
          // mtime 做外部修改校验(未记录基准或覆盖模式时不校验)
          const expect =
            overwrite || tab.openedMtimeMs === undefined ? undefined : tab.openedMtimeMs;
          const outcome = await saveToPathEncoded(
            tab.path,
            tab.content,
            tab.encoding ?? 'utf-8',
            expect,
          );
          // 传写盘快照而非"此刻内容":await 期间的新输入应保持 dirty
          state.markSaved(id, tab.path, tab.content);
          // 刷新乐观校验基准:下一次保存以新 mtime 判定外部修改
          try {
            state.setTabMtime(id, await fileMtimeMs(tab.path));
          } catch {
            // mtime 刷新失败不阻塞保存成功路径(基准保持旧值,至多下次误报冲突)
          }
          toast.success(
            t(
              outcome === 'recreated'
                ? 'tools.text_editor.toast_recreated'
                : 'tools.text_editor.toast_saved',
              { name: tab.title },
            ),
          );
          return true;
        }
        // 未绑定路径:文件名缺扩展名时补 .txt,供保存对话框使用
        const fileName = tab.title.endsWith('.txt') ? tab.title : `${tab.title}.txt`;
        const path = await saveWithDialog(fileName, tab.content);
        if (path) {
          state.markSaved(id, path, tab.content);
          toast.success(t('tools.text_editor.toast_saved', { name: fileName }));
          return true;
        }
        // 用户取消保存对话框:保持 dirty 状态
        return false;
      } catch (e) {
        if (e instanceof CommandError && e.code === 'ERR_FILE_MODIFIED') {
          // 外部修改冲突:不写盘、不弹错误 toast,交给三选对话框
          setModifiedConflict(id);
          return false;
        }
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_save'));
        return false;
      }
    },
    [t],
  );

  /** 保存激活 Tab(菜单「保存」/ Ctrl+S 快捷键) */
  const handleSave = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    if (!state.workspace.activeTabId) return;
    void saveTabById(state.workspace.activeTabId);
  }, [saveTabById]);

  /**
   * 全部保存:遍历 dirty Tab 逐个保存。
   * - 已绑定路径 → 写回
   * - untitled → 弹另存为,用户取消则跳过该 Tab(保持 dirty 状态)
   * 全部独立执行,单 Tab 失败不影响其它
   */
  const handleSaveAll = useCallback(async () => {
    const state = useEditorWorkspaceStore.getState();
    const dirtyTabs = state.workspace.tabs.filter((t) => t.content !== t.savedContent);
    for (const tab of dirtyTabs) {
      // 跳过用户取消的另存为(返回 false),继续下一个 dirty Tab
      await saveTabById(tab.id);
    }
  }, [saveTabById]);

  /**
   * 通过编码重新打开(仿 VSCode):按所选编码重读磁盘文件并覆盖当前 Tab 内容,
   * 顺带更新 Tab 编码记录并标记已保存(以磁盘为准)。无磁盘路径时为 no-op。
   */
  const reopenWithEncoding = useCallback(
    async (encodingId: string): Promise<void> => {
      const state = useEditorWorkspaceStore.getState();
      const tab = state.workspace.tabs.find((t) => t.id === state.workspace.activeTabId);
      if (!tab?.path) return;
      // 有未保存改动时先确认:重新打开将以磁盘内容覆盖,当前改动会丢失
      if (tab.content !== tab.savedContent) {
        const ok = window.confirm(
          t('tools.text_editor.reopen_discard_confirm', { title: tab.title }),
        );
        if (!ok) return;
      }
      try {
        const result = await readTextFileEncoded(tab.path, encodingId);
        state.setTabContent(tab.id, result.content);
        // 指定编码重读时后端按所选编码解码,编码标识回退用户所选
        state.setTabEncoding(tab.id, result.encoding ?? encodingId);
        // 重读即以磁盘为准:刷新乐观校验基准到当前磁盘 mtime
        state.setTabMtime(tab.id, result.mtimeMs);
        state.markSaved(tab.id, tab.path, result.content);
        toast.success(t('tools.text_editor.toast_reopened', { encoding: result.encoding }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_file'));
      }
    },
    [t],
  );

  /**
   * 通过编码保存(仿 VSCode):记录所选编码后立即写盘。
   * 有路径直接按该编码写回(带 mtime 乐观校验,冲突弹三选);
   * untitled 弹「另存为」并以该编码写入。
   */
  const saveWithEncoding = useCallback(
    async (encodingId: string, overwrite = false): Promise<void> => {
      const state = useEditorWorkspaceStore.getState();
      const tab = state.workspace.tabs.find((t) => t.id === state.workspace.activeTabId);
      if (!tab) return;
      state.setTabEncoding(tab.id, encodingId);
      let recreated = false;
      try {
        if (tab.path) {
          const expect =
            overwrite || tab.openedMtimeMs === undefined ? undefined : tab.openedMtimeMs;
          const outcome = await saveToPathEncoded(tab.path, tab.content, encodingId, expect);
          state.markSaved(tab.id, tab.path, tab.content);
          try {
            state.setTabMtime(tab.id, await fileMtimeMs(tab.path));
          } catch {
            // mtime 刷新失败不阻塞保存成功路径
          }
          recreated = outcome === 'recreated';
        } else {
          const fileName = tab.title.endsWith('.txt') ? tab.title : `${tab.title}.txt`;
          const path = await saveWithDialogEncoded(fileName, tab.content, encodingId);
          // 用户取消另存为:编码已记录,内容保持 dirty
          if (!path) return;
          state.markSaved(tab.id, path, tab.content);
        }
        toast.success(
          t(recreated ? 'tools.text_editor.toast_recreated' : 'tools.text_editor.toast_saved', {
            name: tab.title,
          }),
        );
      } catch (e) {
        if (e instanceof CommandError && e.code === 'ERR_FILE_MODIFIED') {
          if (tab.id) setModifiedConflict(tab.id);
          return;
        }
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_save'));
      }
    },
    [t],
  );

  /** 冲突目标 Tab(null = 关闭对话框时的瞬时读取) */
  const conflictTab = modifiedConflict
    ? (useEditorWorkspaceStore.getState().workspace.tabs.find((tb) => tb.id === modifiedConflict) ??
      null)
    : null;

  /**
   * 「覆盖」:跳过 mtime 校验,以当前编辑内容写盘(丢弃外部修改)。
   * 覆盖前不再刷新基准(若两次操作间文件又被改,下次保存还会拦)。
   */
  const handleConflictOverwrite = useCallback(() => {
    const id = modifiedConflict;
    setModifiedConflict(null);
    if (id) void saveTabById(id, true);
  }, [modifiedConflict, saveTabById]);

  /**
   * 「重新加载」:读磁盘最新内容覆盖编辑器并清 dirty(本地未保存改动丢弃)。
   * 已有 reopenWithEncoding 的「磁盘覆盖」语义,复用其实现(编码按 Tab 记录)。
   */
  const handleConflictReload = useCallback(() => {
    const id = modifiedConflict;
    setModifiedConflict(null);
    if (!id) return;
    const state = useEditorWorkspaceStore.getState();
    const tab = state.workspace.tabs.find((tb) => tb.id === id);
    if (!tab?.path) return;
    const { path, id: tabId } = tab;
    void (async () => {
      try {
        const result = await readTextFileEncoded(path);
        state.setTabContent(tabId, result.content);
        state.setTabEncoding(tabId, result.encoding ?? tab.encoding ?? 'utf-8');
        state.setTabMtime(tabId, result.mtimeMs);
        state.markSaved(tabId, path, result.content);
        toast.success(t('tools.text_editor.toast_reloaded', { name: tab.title }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_file'));
      }
    })();
  }, [modifiedConflict, t]);

  /**
   * 「对比」:读磁盘最新内容生成快照 Tab,与当前编辑 Tab 组成对比视图,
   * 用户看完差异后自行决定去留(快照标题标注来源,不与原文件同路径混淆)。
   */
  const handleConflictCompare = useCallback(() => {
    const id = modifiedConflict;
    setModifiedConflict(null);
    if (!id) return;
    const state = useEditorWorkspaceStore.getState();
    const tab = state.workspace.tabs.find((tb) => tb.id === id);
    if (!tab?.path) return;
    const { path, id: tabId, title } = tab;
    void (async () => {
      try {
        const disk = await readTextFileEncoded(path);
        // 磁盘快照 Tab:无路径(不被当作本地文件),标题标注磁盘来源
        state.openDroppedText(
          t('tools.text_editor.modified_disk_copy', { name: title }),
          disk.content,
        );
        compareWithLatestTab(tabId);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('tools.text_editor.err_open_file'));
      }
    })();
  }, [compareWithLatestTab, modifiedConflict, t]);

  return {
    modifiedConflict,
    closeConflict,
    conflictTab,
    saveTabById,
    handleSave,
    handleSaveAll,
    reopenWithEncoding,
    saveWithEncoding,
    handleConflictOverwrite,
    handleConflictReload,
    handleConflictCompare,
  };
}

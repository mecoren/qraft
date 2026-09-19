/**
 * 文件树操作对话框组 —— 新建 / 重命名的名称输入 + 删除确认
 *
 * 与 useFileTreeOperations 配对:hook 持有「目标条目 + 落盘动作」,本组件只负责
 * 把当前对话框状态渲染出来(名称输入用 RenameDialog 同款交互,删除一律二次确认)。
 */
import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RenameDialog } from '@/components/RenameDialog';
import type { DirEntry } from './fileOps';
import type { TreeOpDialog } from './useFileTreeOperations';

export function TreeOperationDialogs({
  treeOp,
  treeDelete,
  onCreateConfirm,
  onRenameConfirm,
  onDeleteConfirm,
  onCloseOp,
  onCloseDelete,
}: {
  /** 名称输入对话框状态(null = 关闭) */
  treeOp: TreeOpDialog | null;
  /** 删除确认目标(null = 关闭) */
  treeDelete: DirEntry | null;
  onCreateConfirm: (name: string) => void;
  onRenameConfirm: (name: string) => void;
  onDeleteConfirm: () => void;
  onCloseOp: () => void;
  onCloseDelete: () => void;
}): JSX.Element | null {
  const { t } = useTranslation();
  return (
    <>
      {/* 新建文件/文件夹(复用 RenameDialog 的名称输入交互) */}
      {treeOp?.mode === 'create' && (
        <RenameDialog
          open
          title={
            treeOp.isDir
              ? t('tools.text_editor.tree_new_folder')
              : t('tools.text_editor.tree_new_file')
          }
          placeholder={
            treeOp.isDir
              ? t('tools.text_editor.tree_name_placeholder_folder')
              : t('tools.text_editor.tree_name_placeholder_file')
          }
          onConfirm={onCreateConfirm}
          onCancel={onCloseOp}
          data-testid="tree-create-dialog"
        />
      )}
      {treeOp?.mode === 'rename' && (
        <RenameDialog
          open
          title={t('tools.text_editor.rename')}
          initialValue={treeOp.name}
          onConfirm={onRenameConfirm}
          onCancel={onCloseOp}
          data-testid="tree-rename-dialog"
        />
      )}

      {/* 删除确认:影响磁盘且无回收站兜底,一律确认 */}
      {treeDelete && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) onCloseDelete();
          }}
        >
          <DialogContent
            data-testid="tree-delete-dialog"
            className="max-w-sm gap-4 border border-border bg-background p-5 shadow-lg"
          >
            <DialogHeader>
              <DialogTitle>{t('tools.text_editor.tree_delete_confirm_title')}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {treeDelete.isDir
                ? t('tools.text_editor.tree_delete_confirm_dir', { name: treeDelete.name })
                : t('tools.text_editor.tree_delete_confirm_file', { name: treeDelete.name })}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={onCloseDelete}>
                {t('tools.text_editor.tree_delete_cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                data-testid="tree-delete-confirm"
                onClick={onDeleteConfirm}
              >
                {t('tools.text_editor.tree_delete_confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

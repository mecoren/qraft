/**
 * 未保存更改确认对话框 —— shadcn new-york-v4 AlertDialog 风格
 *
 * 四种模式(quit-app 已移除:工作区内容实时持久化到 Rust config 缓存,
 * 退出应用时无需再次确认,详见 EditorWorkbench 的窗口关闭守卫):
 * - close-tab:关闭单个未保存 Tab →「保存 / 不保存 / 取消」
 * - close-pinned:关闭固定 Tab(无论是否未保存) →「关闭 / 取消」
 * - close-all:关闭全部时存在未保存 Tab →「全部不保存 / 取消」
 * - close-batch:批量关闭(关闭其他/关闭右侧)时存在未保存 Tab →「全部不保存 / 取消」
 *
 * 由父组件(EditorWorkbench)持有 open 状态与各回调,本组件只负责展示与按钮分发。
 * 点遮罩 / Esc 均视为取消(AlertDialog 的 Cancel 按钮自动处理)。
 */
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export type UnsavedMode = 'close-tab' | 'close-pinned' | 'close-all' | 'close-batch';

export interface UnsavedDialogProps {
  open: boolean;
  mode: UnsavedMode;
  /** close-tab 模式:目标 Tab 标题(用于文案) */
  tabTitle?: string;
  /** close-all 模式:未保存 Tab 数量 */
  dirtyCount: number;
  /** 是否显示「保存并关闭」(仅 close-tab) */
  canSave: boolean;
  /** 保存并关闭(仅 canSave 时显示) */
  onSave: () => void;
  /** 不保存关闭 / 全部不保存 */
  onDiscard: () => void;
  /** 取消(保持打开) */
  onCancel: () => void;
  /** 测试定位 */
  'data-testid'?: string;
}

export function UnsavedDialog({
  open,
  mode,
  tabTitle,
  dirtyCount,
  canSave,
  onSave,
  onDiscard,
  onCancel,
  'data-testid': dataTestId,
}: UnsavedDialogProps): JSX.Element {
  const { t } = useTranslation();
  const isSingle = mode === 'close-tab';
  const isPinned = mode === 'close-pinned';
  const title = isSingle
    ? t('tools.text_editor.unsaved_title_single', { title: tabTitle ?? '' })
    : isPinned
      ? t('tools.text_editor.unsaved_title_pinned', { title: tabTitle ?? '' })
      : t('tools.text_editor.unsaved_title_multi', { num: dirtyCount });
  const description = isSingle
    ? t('tools.text_editor.unsaved_desc_loss')
    : isPinned
      ? t('tools.text_editor.unsaved_desc_pinned')
      : t('tools.text_editor.unsaved_desc_loss');

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent data-testid={dataTestId} size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* 顺序: 保存 → 不保存/关闭 → 取消 */}
          {isSingle && canSave && (
            <AlertDialogAction onClick={onSave} data-testid={`${dataTestId}-save`}>
              {t('tools.text_editor.save')}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            onClick={onDiscard}
            variant="ghost"
            data-testid={`${dataTestId}-discard`}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {isSingle
              ? t('tools.text_editor.unsaved_discard')
              : isPinned
                ? t('tools.text_editor.close')
                : t('tools.text_editor.unsaved_discard_all')}
          </AlertDialogAction>
          <AlertDialogCancel onClick={onCancel} data-testid={`${dataTestId}-cancel`}>
            {t('tools.text_editor.cancel')}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

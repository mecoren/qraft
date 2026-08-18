/**
 * 未保存更改确认对话框 —— shadcn new-york-v4 AlertDialog 风格
 *
 * 五种模式:
 * - close-tab:关闭单个未保存 Tab →「保存 / 不保存 / 取消」
 * - close-pinned:关闭固定 Tab(无论是否未保存) →「关闭 / 取消」
 * - close-all:关闭全部时存在未保存 Tab →「全部不保存 / 取消」
 * - close-batch:批量关闭(关闭其他/关闭右侧)时存在未保存 Tab →「全部不保存 / 取消」
 * - quit-app:退出应用时存在未保存 Tab →「放弃并退出 / 取消」
 *
 * 由父组件(EditorWorkbench)持有 open 状态与各回调,本组件只负责展示与按钮分发。
 * 点遮罩 / Esc 均视为取消(AlertDialog 的 Cancel 按钮自动处理)。
 */
import type { JSX } from 'react';
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

export type UnsavedMode = 'close-tab' | 'close-pinned' | 'close-all' | 'close-batch' | 'quit-app';

export interface UnsavedDialogProps {
  open: boolean;
  mode: UnsavedMode;
  /** close-tab 模式:目标 Tab 标题(用于文案) */
  tabTitle?: string;
  /** close-all / quit-app 模式:未保存 Tab 数量 */
  dirtyCount: number;
  /** 是否显示「保存并关闭」(仅 close-tab) */
  canSave: boolean;
  /** 保存并关闭(仅 canSave 时显示) */
  onSave: () => void;
  /** 不保存关闭 / 放弃并退出 */
  onDiscard: () => void;
  /** 取消(保持打开 / 留在应用) */
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
  const isSingle = mode === 'close-tab';
  const isPinned = mode === 'close-pinned';
  const title = isSingle
    ? `是否保存对 "${tabTitle ?? ''}" 的更改?`
    : isPinned
      ? `确定要关闭固定的 "${tabTitle ?? ''}" 吗?`
      : `有 ${dirtyCount} 个未保存的更改`;
  const description = isSingle
    ? '如果不保存,你的更改将丢失。'
    : isPinned
      ? '固定 Tab 不会被批量关闭操作影响,确认后仍会关闭。'
      : mode === 'quit-app'
        ? '有未保存的更改,确定要退出 Qraft 吗?如果不保存,你的更改将丢失。'
        : '如果不保存,你的更改将丢失。';

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
              保存
            </AlertDialogAction>
          )}
          <AlertDialogAction
            onClick={onDiscard}
            variant="ghost"
            data-testid={`${dataTestId}-discard`}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {isSingle
              ? '不保存'
              : isPinned
                ? '关闭'
                : mode === 'quit-app'
                  ? '放弃并退出'
                  : '全部不保存'}
          </AlertDialogAction>
          <AlertDialogCancel onClick={onCancel} data-testid={`${dataTestId}-cancel`}>
            取消
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

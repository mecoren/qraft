/**
 * 未保存更改确认 —— 锚定目标 Tab 的小 Popover(与 JSON 格式化器的
 * Tab 关闭确认 / 历史删除确认同款,替代原先的居中 AlertDialog)
 *
 * 四种模式(quit-app 已移除:工作区内容实时持久化到 Rust config 缓存,
 * 退出应用时无需再次确认,详见 EditorWorkbench 的窗口关闭守卫):
 * - close-tab:关闭单个未保存 Tab →「保存 / 不保存 / 取消」
 * - close-pinned:关闭固定 Tab(无论是否未保存) →「关闭 / 取消」
 * - close-all:关闭全部时存在未保存 Tab →「全部不保存 / 取消」
 * - close-batch:批量关闭(关闭其他/关闭右侧)时存在未保存 Tab →「全部不保存 / 取消」
 *
 * 由父组件(EditorWorkbench)持有 open 状态与各回调,本组件只负责展示与按钮分发;
 * 触发元素由 children 传入(EditorTabsBar 中即目标 Tab 自身,确认框锚定其下方)。
 * 点外部 / Esc 均视为取消(Popover onOpenChange(false) 统一走 onCancel)。
 */
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

export type UnsavedMode = 'close-tab' | 'close-pinned' | 'close-all' | 'close-batch';

/** 确认框锚定位置:哪个区域发起的关闭,确认框就锚定在哪个区域的对应条目上 */
export type UnsavedSource = 'tabs' | 'sidebar';

export interface UnsavedPopoverProps {
  open: boolean;
  mode: UnsavedMode;
  /** close-tab / close-pinned 模式:目标 Tab 标题(用于文案) */
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
  /** 触发元素(PopoverTrigger asChild 包住,通常为目标 Tab) */
  children: React.ReactNode;
  /** 测试定位 */
  'data-testid'?: string;
}

export function UnsavedPopover({
  open,
  mode,
  tabTitle,
  dirtyCount,
  canSave,
  onSave,
  onDiscard,
  onCancel,
  children,
  'data-testid': dataTestId,
  // 外层 ContextMenuTrigger asChild 合并下来的 props(onContextMenu / ref 等,
  // React 19 中 ref 作为普通 props 传递)必须继续透传,否则右键菜单与锚点定位失效
  ...triggerProps
}: UnsavedPopoverProps & React.ComponentPropsWithoutRef<typeof PopoverTrigger>): JSX.Element {
  const { t } = useTranslation();
  const isSingle = mode === 'close-tab';
  const isPinned = mode === 'close-pinned';
  const title = isSingle
    ? t('tools.text_editor.unsaved_title_single', { title: tabTitle ?? '' })
    : isPinned
      ? t('tools.text_editor.unsaved_title_pinned', { title: tabTitle ?? '' })
      : t('tools.text_editor.unsaved_title_multi', { num: dirtyCount });
  const description = isPinned
    ? t('tools.text_editor.unsaved_desc_pinned')
    : t('tools.text_editor.unsaved_desc_loss');

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <PopoverTrigger asChild {...triggerProps}>
        {children}
      </PopoverTrigger>
      {/* 确认内容:与历史清空/删除确认同款小框,锚定 Tab 下方 */}
      <PopoverContent align="start" side="bottom" className="w-56 p-3" data-testid={dataTestId}>
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{description}</p>
        <div className="mt-2.5 flex justify-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={onCancel}
            data-testid={`${dataTestId}-cancel`}
          >
            {t('tools.text_editor.cancel')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDiscard}
            data-testid={`${dataTestId}-discard`}
          >
            {isSingle
              ? t('tools.text_editor.unsaved_discard')
              : isPinned
                ? t('tools.text_editor.close')
                : t('tools.text_editor.unsaved_discard_all')}
          </Button>
          {isSingle && canSave && (
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={onSave}
              data-testid={`${dataTestId}-save`}
            >
              {t('tools.text_editor.save')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

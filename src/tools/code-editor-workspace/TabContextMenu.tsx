/**
 * Tab 共享右键菜单 —— shadcn ContextMenu
 *
 * 供顶栏 Tab 栏与左栏「打开的编辑器」列表复用同一套菜单项,
 * 作用于被右键的目标 Tab(与当前激活 Tab 无关)。
 *
 * 菜单项(对齐 VSCode 截图 + MVP 范围):
 * - 重命名(仅改 Tab 显示名;未提供 onRename 时不显示该菜单项)
 * - 比较所选内容(仅在左栏多选 ≥2 个文件时显示,见 onCompareSelectedCount)
 * - 关闭 / 关闭其他 / 关闭右侧 / 关闭已保存 / 全部关闭
 * - 固定(与其它菜单项左对齐;pinned 时在右侧以 ✓ 标记勾选态)
 * - 在文件资源管理器中显示(path 为 null 时禁用)
 * - 复制路径 / 复制相对路径(项目无工作区根目录概念,始终禁用)
 * - 保存(显示真实绑定的 Ctrl+S 快捷键;其余项无真实快捷键不显示伪快捷键)
 *
 * 未实现能力(「重新打开编辑器的方式」「拆分/移动到新窗口」等)一律不显示,
 * 避免出现点了无响应的死菜单。
 */
import type { JSX } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { EditorTab } from './schema';

export interface TabContextMenuProps {
  /** 被右键的目标 Tab */
  tab: EditorTab;
  /** 重命名(仅改显示名;缺省则不显示该菜单项) */
  onRename?: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onCloseSaved: () => void;
  onCloseAll: () => void;
  onTogglePin: () => void;
  onSave: () => void;
  onRevealInExplorer: () => void;
  onCopyPath: () => void;
  /** 比较所选内容(左栏多选 ≥2 个文件时提供);缺省则不显示该菜单项 */
  onCompareSelected?: () => void;
  /** 当前多选文件数(≥2 时启用「比较所选内容」) */
  selectedCount?: number;
  /** 触发元素(ContextMenuTrigger asChild 包住) */
  children: React.ReactNode;
}

export function TabContextMenu({
  tab,
  onRename,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseSaved,
  onCloseAll,
  onTogglePin,
  onSave,
  onRevealInExplorer,
  onCopyPath,
  onCompareSelected,
  selectedCount = 0,
  children,
}: TabContextMenuProps): JSX.Element {
  const { t } = useTranslation();
  const hasPath = tab.path !== null;
  // 左栏多选场景才显示「比较所选内容」;顶栏 Tab 栏不传 onCompareSelected,不显示
  const canCompare = typeof onCompareSelected === 'function' && selectedCount >= 2;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56" data-testid="tab-context-menu">
        {typeof onRename === 'function' && (
          <>
            <ContextMenuItem onSelect={onRename} data-testid="ctx-rename">
              {t('tools.text_editor.rename')}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {canCompare && (
          <>
            <ContextMenuItem onSelect={onCompareSelected} data-testid="ctx-compare-selected">
              {t('tools.text_editor.compare_selected')}
              <ContextMenuShortcut>
                {t('tools.text_editor.compare_selected_num', { num: selectedCount })}
              </ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={onClose} data-testid="ctx-close">
          {t('tools.text_editor.close')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers} data-testid="ctx-close-others">
          {t('tools.text_editor.close_others')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseRight} data-testid="ctx-close-right">
          {t('tools.text_editor.close_right')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseSaved} data-testid="ctx-close-saved">
          {t('tools.text_editor.close_saved')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll} data-testid="ctx-close-all">
          {t('tools.text_editor.close_all')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onTogglePin} data-testid="ctx-toggle-pin">
          {t('tools.text_editor.pin')}
          {tab.pinned && (
            <Check
              aria-label={t('tools.text_editor.pinned_aria')}
              data-testid="ctx-toggle-pin-check"
              className="ml-auto size-3.5 text-primary"
            />
          )}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onRevealInExplorer} disabled={!hasPath} data-testid="ctx-reveal">
          {t('tools.text_editor.reveal_in_explorer')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCopyPath} disabled={!hasPath} data-testid="ctx-copy-path">
          {t('tools.text_editor.copy_path')}
        </ContextMenuItem>
        <ContextMenuItem disabled data-testid="ctx-copy-relative-path">
          {t('tools.text_editor.copy_relative_path')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onSave} data-testid="ctx-save">
          {t('tools.text_editor.save')}
          <ContextMenuShortcut>Ctrl+S</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

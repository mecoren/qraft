/**
 * Tab 共享右键菜单 —— shadcn ContextMenu
 *
 * 供顶栏 Tab 栏与左栏「打开的编辑器」列表复用同一套菜单项,
 * 作用于被右键的目标 Tab(与当前激活 Tab 无关)。
 *
 * 菜单项(对齐 VSCode 截图 + MVP 范围):
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
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onCloseSaved: () => void;
  onCloseAll: () => void;
  onTogglePin: () => void;
  onSave: () => void;
  onRevealInExplorer: () => void;
  onCopyPath: () => void;
  /** 触发元素(ContextMenuTrigger asChild 包住) */
  children: React.ReactNode;
}

export function TabContextMenu({
  tab,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseSaved,
  onCloseAll,
  onTogglePin,
  onSave,
  onRevealInExplorer,
  onCopyPath,
  children,
}: TabContextMenuProps): JSX.Element {
  const hasPath = tab.path !== null;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56" data-testid="tab-context-menu">
        <ContextMenuItem onSelect={onClose} data-testid="ctx-close">
          关闭
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers} data-testid="ctx-close-others">
          关闭其他
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseRight} data-testid="ctx-close-right">
          关闭右侧
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseSaved} data-testid="ctx-close-saved">
          关闭已保存
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll} data-testid="ctx-close-all">
          全部关闭
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onTogglePin}
          data-testid="ctx-toggle-pin"
        >
          固定
          {tab.pinned && (
            <Check
              aria-label="已固定"
              data-testid="ctx-toggle-pin-check"
              className="ml-auto size-3.5 text-primary"
            />
          )}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onRevealInExplorer}
          disabled={!hasPath}
          data-testid="ctx-reveal"
        >
          在文件资源管理器中显示
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={onCopyPath}
          disabled={!hasPath}
          data-testid="ctx-copy-path"
        >
          复制路径
        </ContextMenuItem>
        <ContextMenuItem disabled data-testid="ctx-copy-relative-path">
          复制相对路径
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onSave} data-testid="ctx-save">
          保存
          <ContextMenuShortcut>Ctrl+S</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

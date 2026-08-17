/**
 * 左栏「打开的编辑器」列表 —— VSCode EXPLORER 分组
 *
 * 列表项交互:
 * - 点击文件项 → 切换激活 Tab(单击选中该文件)
 * - Ctrl/Cmd+点击文件项 → 多选切换该文件的选中态,同时激活该 Tab
 * - 右键文件项 → 若文件不在当前多选中则仅选中它(对齐 VSCode),再弹右键菜单
 * - hover 文件项 → 文件图标/dirty 圆点淡出,行尾关闭图标显示
 * - 多选 ≥2 个文件时,右键菜单出现「比较所选内容」项,可并排对比差异
 *
 * 标题区交互(对齐 VSCode 资源管理器标题):
 * - 折叠/展开箭头(点击切换列表显示)
 * - 有未保存时,右侧显示「N 个未保存」徽章(淡蓝底)
 * - 鼠标悬浮在整个面板(标题区或列表区)时,徽章淡出,三个动作图标显示:
 *   新建(空白 Tab) / 全部保存 / 全部关闭
 */
import { useState, type JSX } from 'react';
import {
  ChevronDown,
  FilePlus2,
  FileText,
  Save,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabContextMenu } from './TabContextMenu';
import type { EditorTab } from './schema';

export interface EditorLeftSidebarProps {
  tabs: readonly EditorTab[];
  activeTabId: string | null;
  /** 未保存 Tab 数量,用于标题徽章展示 */
  dirtyCount: number;
  /** 当前多选文件(除激活 Tab 外被 Ctrl+点击选中的 Tab id 集合) */
  selectedTabIds?: readonly string[];
  onSelect: (id: string) => void;
  /** 单击/Ctrl+点击选中处理:additive=true 表示追加切换(Ctrl/Cmd),否则单选 */
  onSelectMany?: (id: string, additive: boolean) => void;
  /** 比较所选内容(多选 ≥2 个文件时可用) */
  onCompareSelected?: () => void;
  /** 关闭单个 Tab(需要未保存确认时由父组件决定是否弹框) */
  onClose?: (id: string) => void;
  /** 右键菜单:关闭其他(保留目标与全部固定 Tab) */
  onCloseOthers?: (id: string) => void;
  /** 右键菜单:关闭目标右侧(保留固定 Tab) */
  onCloseRight?: (id: string) => void;
  /** 右键菜单:关闭全部已保存 Tab */
  onCloseSaved?: () => void;
  /** 右键菜单:切换固定状态 */
  onTogglePin?: (id: string) => void;
  /** 右键菜单:保存指定 Tab */
  onSave?: (id: string) => void;
  /** 右键菜单:在文件资源管理器中显示 */
  onRevealInExplorer?: (id: string) => void;
  /** 右键菜单:复制路径到剪贴板 */
  onCopyPath?: (id: string) => void;
  /** 标题区动作:新建空白 Tab */
  onNewTab?: () => void;
  /** 标题区动作:批量保存所有 dirty Tab */
  onSaveAll?: () => void;
  /** 标题区动作:关闭所有 Tab(已接入未保存确认) */
  onCloseAll?: () => void;
  /** 全部保存按钮禁用条件(无任何 Tab 时禁用) */
  saveAllDisabled?: boolean;
  /** 全部关闭按钮禁用条件(无任何 Tab 时禁用) */
  closeAllDisabled?: boolean;
  /** 测试定位用 */
  'data-testid'?: string;
}

export function EditorLeftSidebar({
  tabs,
  activeTabId,
  dirtyCount,
  selectedTabIds = [],
  onSelect,
  onSelectMany,
  onCompareSelected,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseSaved,
  onTogglePin,
  onSave,
  onRevealInExplorer,
  onCopyPath,
  onNewTab,
  onSaveAll,
  onCloseAll,
  saveAllDisabled,
  closeAllDisabled,
  'data-testid': dataTestId,
}: EditorLeftSidebarProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  /**
   * 鼠标是否悬浮在整个「打开的编辑器」面板(含标题区 + 列表区):
   * 悬浮时标题区右侧的三个动作按钮(新建 / 全部保存 / 全部关闭)显示,徽章淡出。
   * 状态绑定在 aside 上,而非单个标题/列表项,避免在列表空白区域操作时按钮消失。
   */
  const [hovered, setHovered] = useState(false);
  /** 空列表时没有内容可悬浮,动作按钮始终显示,方便用户新建文件 */
  const actionsVisible = hovered || tabs.length === 0;

  return (
    <aside
      data-testid={dataTestId}
      aria-label="打开的编辑器"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex h-full min-w-0 w-full flex-col overflow-hidden text-sidebar-foreground"
    >
      {/* 标题区:点击任意位置切换展开/折叠;面板悬浮时三个动作按钮显示。
          徽章与 3 个动作按钮在 flex 布局中互斥显隐(同一位置最右)。
          用 JS hovered state 控制,与列表项每项独立的 group-hover(关闭图标)互不干扰。 */}
      <div
        data-testid={`${dataTestId}-header`}
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
        className="flex min-w-0 cursor-pointer select-none items-center gap-1 overflow-hidden border-b border-sidebar-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-sidebar-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            collapsed ? '-rotate-90' : 'rotate-0',
          )}
        />
        {/* 标题:占满中间空间 */}
        <h2 className="min-w-0 flex-1 truncate">打开的编辑器</h2>

        {/* dirty 徽章:始终显示在标题右侧;悬浮区域时按钮组在最右展开,把徽章挤到左侧 */}
        {dirtyCount > 0 && (
          <span
            data-testid={`${dataTestId}-dirty-badge`}
            className="shrink-0 overflow-hidden whitespace-nowrap"
          >
            <span className="inline-block rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-primary">
              {dirtyCount} 个未保存
            </span>
          </span>
        )}

        {/* 3 个动作按钮:悬浮文件名时在最右展开可见,否则收缩为 0;
            空列表时始终显示。默认在徽章之后,展开时通过 ml-auto 推到最右,将徽章挤到左侧。
            按钮在正常 flex 布局中,点击区域与视觉一致;按顺序:新建 / 全部保存 / 全部关闭 */}
        <div
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap transition-[width,opacity]',
            actionsVisible ? 'w-auto opacity-100' : 'w-0 opacity-0',
          )}
        >
            <button
              type="button"
              data-testid={`${dataTestId}-action-new`}
              onClick={(e) => {
                e.stopPropagation();
                onNewTab?.();
              }}
              title="新建空白文件"
              aria-label="新建空白文件"
              className="flex size-5 items-center justify-center rounded-sm hover:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <FilePlus2 aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              data-testid={`${dataTestId}-action-save-all`}
              onClick={(e) => {
                e.stopPropagation();
                onSaveAll?.();
              }}
              disabled={saveAllDisabled}
              title="全部保存"
              aria-label="全部保存"
              className="flex size-5 items-center justify-center rounded-sm hover:bg-sidebar-accent/70 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Save aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              data-testid={`${dataTestId}-action-close-all`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseAll?.();
              }}
              disabled={closeAllDisabled}
              title="全部关闭"
              aria-label="全部关闭"
              className="flex size-5 items-center justify-center rounded-sm hover:bg-sidebar-accent/70 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
      </div>

      {/* 列表 */}
      {!collapsed && (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="p-1.5">
          {tabs.length === 0 ? (
            <li
              data-testid={`${dataTestId}-empty`}
              className="px-2 py-3 text-center text-xs text-muted-foreground"
            >
              暂无打开的文件
            </li>
          ) : (
            tabs.map((tab) => {
              const active = tab.id === activeTabId;
              const dirty = tab.content !== tab.savedContent;
              // 是否在 Ctrl+多选中(不含激活 Tab 自身)
              const multiSelected = selectedTabIds.includes(tab.id);
              const selected = active || multiSelected;
              return (
                <li key={tab.id}>
                  <TabContextMenu
                    tab={tab}
                    onCompareSelected={onCompareSelected}
                    selectedCount={selectedTabIds.length + (activeTabId ? 1 : 0)}
                    onClose={() => onClose?.(tab.id)}
                    onCloseOthers={() => onCloseOthers?.(tab.id)}
                    onCloseRight={() => onCloseRight?.(tab.id)}
                    onCloseSaved={() => onCloseSaved?.()}
                    onCloseAll={() => onCloseAll?.()}
                    onTogglePin={() => onTogglePin?.(tab.id)}
                    onSave={() => onSave?.(tab.id)}
                    onRevealInExplorer={() => onRevealInExplorer?.(tab.id)}
                    onCopyPath={() => onCopyPath?.(tab.id)}
                  >
                    <button
                      type="button"
                      data-testid={`${dataTestId}-item-${tab.title}`}
                      aria-current={active ? 'true' : undefined}
                      aria-selected={multiSelected ? 'true' : undefined}
                      onClick={(e) => {
                        // Ctrl/Cmd+点击:追加/取消多选并激活;普通点击:单选并激活
                        if (onSelectMany) {
                          onSelectMany(tab.id, e.ctrlKey || e.metaKey);
                        } else {
                          onSelect(tab.id);
                        }
                      }}
                      onContextMenu={() => {
                        // 右键文件:若不在当前多选中则仅选中它(对齐 VSCode);
                        // 已在多选中则保持整组选中,使「比较所选内容」可用
                        if (!multiSelected && !active && onSelectMany) {
                          onSelectMany(tab.id, false);
                        }
                      }}
                      title={tab.path ?? tab.title}
                    className={cn(
                      // VSCode 行高紧凑,relative 供关闭按钮绝对定位到圆点槽位
                      'group relative flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-sidebar-primary/15 font-medium text-sidebar-primary'
                        : selected
                          ? 'bg-sidebar-primary/10 text-sidebar-primary'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    {/*
                     * 圆点槽位(固定宽度):未悬浮时显示未保存圆点(有 dirty)或留空;
                     * hover 时圆点淡出,关闭按钮在同一位置出现。
                     */}
                    <span className="flex w-3.5 shrink-0 items-center justify-center transition-opacity group-hover:opacity-0">
                      {dirty && (
                        <span
                          aria-label="未保存"
                          data-testid={`${dataTestId}-dirty-${tab.title}`}
                          className="size-2 rounded-full bg-primary"
                        />
                      )}
                    </span>
                    {/* 文件图标:始终显示,不随 hover 消失 */}
                    <FileText aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">{tab.title}</span>
                    {/* 关闭按钮:hover 时在圆点位置出现,替代圆点(通过负 margin 定位到圆点槽位) */}
                    <X
                      aria-label="关闭"
                      role="button"
                      data-testid={`${dataTestId}-close-${tab.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose?.(tab.id);
                      }}
                      className="absolute left-2 z-10 size-3.5 shrink-0 cursor-pointer rounded-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    </button>
                  </TabContextMenu>
                </li>
              );
            })
          )}
          </ul>
        </ScrollArea>
      )}
    </aside>
  );
}
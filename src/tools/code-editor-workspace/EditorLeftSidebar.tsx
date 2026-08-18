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
 * 「对比差异」分组(独立 div,位于文件列表下方,与「打开的编辑器」分离):
 * - 每次「比较所选内容」在此新增一条对比项(如 a.ts ⟷ b.ts)
 * - 点击对比项 → 主区域直接显示该对比的 Diff 视图(不弹窗)
 * - hover 显示关闭按钮,点击移除该对比
 * - 独立布局:不随「打开的编辑器」折叠隐藏,自有折叠状态;列表自带独立滚动(max-h-40)
 * - 标题区对齐「打开的编辑器」:数量徽章 + 悬浮全部关闭按钮均走 flex 布局,
 *   面板拖拽调宽 / 悬浮时位置自动重排(徽章被按钮挤到左侧)
 *
 * 标题区交互(对齐 VSCode 资源管理器标题):
 * - 折叠/展开箭头(点击切换列表显示)
 * - 有未保存时,右侧显示「N 个未保存」徽章(淡蓝底)
 * - 鼠标悬浮在整个面板(标题区或列表区)时,徽章淡出,三个动作图标显示:
 *   新建(空白 Tab) / 全部保存 / 全部关闭
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { ChevronDown, FilePlus2, FileText, GitCompareArrows, Pin, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { TabContextMenu } from './TabContextMenu';
import type { ComparePair, EditorTab } from './schema';

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
  /** 已创建的对比项列表(显示在「对比差异」分组) */
  compares?: readonly ComparePair[];
  /** 当前激活的对比项 id(主区域显示其 diff) */
  activeCompareId?: string | null;
  /** 点击对比项:切换激活该对比 */
  onSelectCompare?: (id: string) => void;
  /** 关闭对比项(移除该对比) */
  onCloseCompare?: (id: string) => void;
  /** 关闭整个「对比差异」分组(清空全部对比项) */
  onCloseAllCompares?: () => void;
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
  /** 拖拽排序:将 dragId 的 Tab 移到 beforeTabId 之前(null 表示移到末尾);固定 Tab 恒在最前 */
  onReorder?: (dragId: string, beforeTabId: string | null) => void;
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
  /**
   * 外部强制动作按钮/徽章显示(拖拽分隔条时):
   * 鼠标从面板移到分隔条上会触发 aside 的 onMouseLeave 导致按钮闪烁,
   * 拖拽分隔条期间由父组件置位此值,保持按钮/徽章状态稳定。
   */
  actionsForced?: boolean;
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
  compares = [],
  activeCompareId = null,
  onSelectCompare,
  onCloseCompare,
  onCloseAllCompares,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseSaved,
  onTogglePin,
  onSave,
  onRevealInExplorer,
  onCopyPath,
  onReorder,
  onNewTab,
  onSaveAll,
  onCloseAll,
  saveAllDisabled,
  closeAllDisabled,
  actionsForced = false,
  'data-testid': dataTestId,
}: EditorLeftSidebarProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  /** 「对比差异」分组是否折叠(独立于上方的文件列表折叠) */
  const [compareCollapsed, setCompareCollapsed] = useState(false);
  /**
   * 鼠标是否悬浮在整个「打开的编辑器」面板(含标题区 + 列表区):
   * 悬浮时标题区右侧的三个动作按钮(新建 / 全部保存 / 全部关闭)显示,徽章淡出。
   * 状态绑定在 aside 上,而非单个标题/列表项,避免在列表空白区域操作时按钮消失。
   *
   * 拖拽分隔条期间(actionsForced=true)也视为悬浮态:
   * 鼠标从面板移到分隔条上会触发 onMouseLeave,若不补偿,
   * 拖拽中按钮组会收缩、徽章恢复,出现"闪烁/固定"的视觉跳动。
   */
  const [hovered, setHovered] = useState(false);
  const effectiveHovered = hovered || actionsForced;
  /** 空列表时没有内容可悬浮,动作按钮始终显示,方便用户新建文件 */
  const actionsVisible = effectiveHovered || tabs.length === 0;

  /**
   * 拖拽排序 —— Pointer Events 自实现
   *
   * 为什么不用 HTML5 DnD:同 EditorTabsBar —— Tauri v2 在 WebView2 上会拦截/破坏
   * 页面内部元素的 HTML5 拖拽事件。Pointer Events 是底层通用事件,不受影响。
   *
   * 机制(与 Tab 栏一致):
   * - 文件项 onPointerDown 记录拖拽起点(仅左键、非关闭按钮)
   * - ul 容器 onPointerMove 超过阈值后进入拖拽,实时计算插入位置
   * - window 级 pointerup/pointercancel 兜底结束并执行排序
   */

  /** 拖拽中:被拖拽的 Tab id(用于半透明视觉反馈) */
  const [dragId, setDragId] = useState<string | null>(null);
  /**
   * 插入位置指示:
   * - undefined:未在拖拽(无指示)
   * - null:拖到末尾(在最后一个文件项下方画指示线)
   * - string:在该 Tab id 上方画指示线
   */
  const [dropBeforeId, setDropBeforeId] = useState<string | null | undefined>(undefined);

  /** 拖拽起点(pointerdown 记录,pointermove/up 读取) */
  const pointerStartRef = useRef<{ id: string; clientX: number; clientY: number } | null>(null);
  /** 是否已越过阈值进入拖拽(同步标记,state 仅用于视觉) */
  const draggingRef = useRef(false);
  /** 被拖 Tab id(同步,供 move/up 读取) */
  const dragIdRef = useRef<string | null>(null);
  /** 当前插入位置(同步,供 up 读取) */
  const dropBeforeIdRef = useRef<string | null | undefined>(undefined);
  /** 拖拽结束后抑制紧随的 click,避免误切换文件 */
  const suppressClickRef = useRef(false);
  /** 拖拽启动阈值(px):未超过视为普通点击 */
  const DRAG_THRESHOLD = 5;

  /** 进入拖拽:标记状态并显示半透明反馈 */
  const beginDrag = (id: string): void => {
    draggingRef.current = true;
    dragIdRef.current = id;
    setDragId(id);
  };

  /** 结束拖拽:清理全部拖拽状态 */
  const endDrag = (): void => {
    pointerStartRef.current = null;
    draggingRef.current = false;
    dragIdRef.current = null;
    dropBeforeIdRef.current = undefined;
    setDragId(null);
    setDropBeforeId(undefined);
  };

  /** 文件项按下:仅左键、非关闭按钮时记录拖拽起点(普通点击不受影响) */
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, tab: EditorTab) => {
    if (e.button !== 0) return;
    // 从关闭按钮按下拖动不应触发拖拽
    if ((e.target as HTMLElement).closest('[data-sidebar-close]')) return;
    pointerStartRef.current = { id: tab.id, clientX: e.clientX, clientY: e.clientY };
  };

  /**
   * 依据鼠标垂直位置计算放置目标(与 store.reorderTabs / Tab 栏固定约束一致):
   * - 鼠标落在某项上半 → 插到该项之前;下半 → 插到下一项之前
   * - 落在所有项下方/空白 → 末尾(null)
   */
  const computeDropBeforeId = (clientY: number, draggingId: string): string | null => {
    const container = ulRef.current;
    if (!container) return null;
    let hitIndex = -1;
    let hitRect: DOMRect | null = null;
    for (let i = 0; i < tabs.length; i++) {
      const el = container.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabs[i].id)}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.bottom) {
        hitIndex = i;
        hitRect = rect;
        break;
      }
    }
    let targetIndex: number;
    if (hitIndex === -1) {
      // 落在所有项下方/空白:末尾
      targetIndex = tabs.length;
    } else if (clientY < (hitRect as DOMRect).top + (hitRect as DOMRect).height / 2) {
      // 上半 → 插到该项之前
      targetIndex = hitIndex;
    } else {
      // 下半 → 插到下一项之前
      targetIndex = hitIndex + 1;
    }
    const dragIndex = tabs.findIndex((t) => t.id === draggingId);
    const dragTab = dragIndex >= 0 ? tabs[dragIndex] : undefined;
    const pinnedCount = tabs.filter((t) => t.pinned).length;
    if (dragTab?.pinned) {
      // 固定 Tab:只能在固定区(0..pinnedCount)内移动
      targetIndex = Math.max(0, Math.min(targetIndex, pinnedCount));
    } else if (dragTab) {
      // 非固定 Tab:不能插入固定区
      targetIndex = Math.max(pinnedCount, Math.min(targetIndex, tabs.length));
    }
    // 目标在 drag 之后时,移除 drag 后的数组索引需 -1,再映射回 Tab id
    if (dragIndex >= 0 && targetIndex > dragIndex) targetIndex -= 1;
    const restTabs = tabs.filter((t) => t.id !== draggingId);
    const target = restTabs[targetIndex];
    return target ? target.id : null;
  };

  /** ul 容器引用:供 computeDropBeforeId 查询文件项位置 */
  const ulRef = useRef<HTMLUListElement>(null);

  /** 容器内移动:越过阈值进入拖拽,实时更新插入位置 */
  const handleContainerPointerMove = (e: React.PointerEvent<HTMLUListElement>) => {
    const start = pointerStartRef.current;
    if (!start) return;
    if (!draggingRef.current) {
      const dx = e.clientX - start.clientX;
      const dy = e.clientY - start.clientY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      beginDrag(start.id);
    }
    e.preventDefault();
    const beforeId = computeDropBeforeId(e.clientY, start.id);
    dropBeforeIdRef.current = beforeId;
    setDropBeforeId(beforeId);
  };

  /** window 级松手/取消:执行排序并清理状态(鼠标拖出容器也能正常结束) */
  useEffect(() => {
    const handleWindowPointerUp = () => {
      const start = pointerStartRef.current;
      if (!start) return;
      if (draggingRef.current) {
        onReorder?.(start.id, dropBeforeIdRef.current ?? null);
        suppressClickRef.current = true;
      }
      endDrag();
    };
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [onReorder]);

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
        className="flex min-w-0 cursor-pointer select-none items-center gap-1 overflow-hidden border-b border-sidebar-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-sidebar-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @max-[240px]/sidebar:gap-0.5 @max-[240px]/sidebar:px-2"
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
            空列表时始终显示;拖拽分隔条时(actionsForced)也保持显示。
            默认在徽章之后,展开时通过 ml-auto 推到最右,将徽章挤到左侧。
            按钮在正常 flex 布局中,点击区域与视觉一致;按顺序:新建 / 全部保存 / 全部关闭 */}
        <div
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap transition-[width,opacity] @max-[240px]/sidebar:gap-0.5',
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

      {/* 文件列表:独立滚动容器;「对比差异」分组为下方独立 div,不随本列表折叠隐藏 */}
      {!collapsed && (
        <ScrollArea className="min-h-0 flex-1">
          {/* 打开的编辑器 分组 */}
          <ul ref={ulRef} className="p-1.5 pb-0" onPointerMove={handleContainerPointerMove}>
            {tabs.length === 0 ? (
              <li
                data-testid={`${dataTestId}-empty`}
                className="px-2 py-3 text-center text-xs text-muted-foreground"
              >
                暂无打开的文件
              </li>
            ) : (
              tabs.map((tab, index) => {
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
                      // 选中数 = selectedTabIds ∪ {activeTabId} 去重后的大小
                      //(激活 Tab 可能已在 selectedTabIds 中,避免重复计数)
                      selectedCount={
                        activeTabId
                          ? new Set([...selectedTabIds, activeTabId]).size
                          : selectedTabIds.length
                      }
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
                        data-tab-id={tab.id}
                        aria-current={active ? 'true' : undefined}
                        aria-selected={multiSelected ? 'true' : undefined}
                        // 拖拽排序:仅传入 onReorder 时启用
                        onPointerDown={(e) => handlePointerDown(e, tab)}
                        onClick={(e) => {
                          // 拖拽结束后抑制紧随的 click,避免误切换文件
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
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
                          // 拖拽中的文件项半透明(仿 VSCode 拖起效果)
                          dragId === tab.id && 'opacity-40',
                        )}
                      >
                        {/* 插入位置指示线:拖拽时在该文件项上方画主色横线 */}
                        {dropBeforeId === tab.id && (
                          <span
                            aria-hidden
                            data-testid={`${dataTestId}-drop-before-${tab.title}`}
                            className="absolute right-2 top-0 left-2 h-0.5 rounded-full bg-primary"
                          />
                        )}
                        {/* 插入位置指示线:拖到末尾时在最后一个文件项下方画横线 */}
                        {dropBeforeId === null && index === tabs.length - 1 && (
                          <span
                            aria-hidden
                            data-testid={`${dataTestId}-drop-end`}
                            className="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-primary"
                          />
                        )}
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
                        {/* 文件名:超出可用空间时显示 ... */}
                        <span className="min-w-0 truncate">{tab.title}</span>
                        {/* 固定图标:ml-auto 锚定在行最右侧(与 Tab 栏/标题区关闭图标一致),
                            随侧边栏宽度变化而移动位置 */}
                        {tab.pinned && (
                          <Pin
                            aria-label="已固定"
                            data-testid={`${dataTestId}-pin-${tab.title}`}
                            className={cn(
                              'ml-auto size-3 shrink-0',
                              active ? 'text-primary' : 'text-muted-foreground/70',
                            )}
                          />
                        )}
                        {/* 关闭按钮:hover 时在圆点位置出现,替代圆点(通过负 margin 定位到圆点槽位) */}
                        <X
                          aria-label="关闭"
                          role="button"
                          data-testid={`${dataTestId}-close-${tab.title}`}
                          // 关闭按钮按下拖动不应触发列表项拖拽(配合 handleDragStart 守卫)
                          data-sidebar-close
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

      {/* 对比差异 分组:独立 div,脱离「打开的编辑器」文件列表 ——
           - 不随文件列表折叠(collapsed)隐藏,自有折叠状态 compareCollapsed
           - 标题栏数量徽章 + 悬浮关闭键拥有独立布局空间,窄侧栏下完整显示不被裁切 */}
      {compares.length > 0 && (
        <section
          aria-label="对比差异"
          data-testid={`${dataTestId}-compare-section`}
          className="flex min-h-0 flex-none flex-col border-t border-sidebar-border"
        >
          <div
            data-testid={`${dataTestId}-compare-header`}
            onClick={() => setCompareCollapsed((c) => !c)}
            role="button"
            tabIndex={0}
            aria-expanded={!compareCollapsed}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCompareCollapsed((c) => !c);
              }
            }}
            // 数量徽章始终显示在标题右侧(外层 `{compares.length > 0}` 已包,
            // 这里无条件渲染),按钮组 ml-auto 推最右,hover 时 w-auto 展开,
            // 徽章被自然挤到左侧(完全对齐「打开的编辑器」)
            className="flex min-w-0 cursor-pointer select-none items-center gap-1 overflow-hidden border-b border-sidebar-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-sidebar-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @max-[240px]/sidebar:gap-0.5 @max-[240px]/sidebar:px-2"
          >
            <ChevronDown
              aria-hidden
              className={cn(
                'size-3.5 shrink-0 transition-transform',
                compareCollapsed ? '-rotate-90' : 'rotate-0',
              )}
            />
            {/* 标题:占满中间空间,窄栏时 truncate 收缩 */}
            <h2 className="min-w-0 flex-1 truncate">对比差异</h2>
            {/* 数量徽章:始终显示在标题右侧,与「打开的编辑器」未保存徽章一致;
                    hover 时被右侧 ml-auto 按钮组自然挤到左侧(位置由 flex 自动重排) */}
            <span
              data-testid={`${dataTestId}-compare-count`}
              className="shrink-0 overflow-hidden whitespace-nowrap"
            >
              <span className="inline-block rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-primary">
                {compares.length}
              </span>
            </span>
            {/* 关闭按钮组:ml-auto 推最右,悬浮面板时 w-auto 展开,
                    数量徽章自动被挤到左侧(与「打开的编辑器」完全一致) */}
            <div
              className={cn(
                'ml-auto flex shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap transition-[width,opacity] @max-[240px]/sidebar:gap-0.5',
                effectiveHovered ? 'w-auto opacity-100' : 'w-0 opacity-0',
              )}
            >
              <button
                type="button"
                data-testid={`${dataTestId}-compare-close-all`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseAllCompares?.();
                }}
                title="关闭对比差异"
                aria-label="关闭对比差异"
                className="flex size-4 items-center justify-center rounded-sm hover:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X aria-hidden className="size-3" />
              </button>
            </div>
          </div>
          {!compareCollapsed && (
            <ScrollArea className="max-h-40 min-h-0 flex-none">
              <ul className="p-1.5 pt-0.5">
                {compares.map((cp) => {
                  const left = tabs.find((t) => t.id === cp.leftTabId);
                  const right = tabs.find((t) => t.id === cp.rightTabId);
                  const label = `${left?.title ?? '?'} ⟷ ${right?.title ?? '?'}`;
                  const isActive = cp.id === activeCompareId;
                  return (
                    <li key={cp.id}>
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            data-testid={`${dataTestId}-compare-${cp.id}`}
                            aria-current={isActive ? 'true' : undefined}
                            onClick={() => onSelectCompare?.(cp.id)}
                            title={label}
                            className={cn(
                              // 与文件列表一致:relative 供关闭按钮绝对定位到图标槽位
                              'group relative flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              isActive
                                ? 'bg-sidebar-primary/15 font-medium text-sidebar-primary'
                                : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                            )}
                          >
                            {/*
                             * 图标槽位(固定宽度 w-3.5):与「打开的编辑器」dirty 圆点槽位同位置 (8, 22),
                             * 对比项无 dirty 概念,留空即可 ——
                             * 留这个槽位是为了让 GitCompareArrows 落在 (30, 44),
                             * 与 FileText 位置完全一致,避免与 hover-X 在 (8, 22) 重叠。
                             */}
                            <span
                              aria-hidden
                              className="flex w-3.5 shrink-0 items-center justify-center"
                            />
                            {/* 对比图标:固定放在 (30, 44) 与 FileText 同一位置,
                                  显式色不依赖 currentColor —— 激活态用 text-primary
                                  与 sidebar-primary/15 背景拉开对比,默认态用 muted-foreground
                                  保证在任何宽度下都清晰可见 */}
                            <GitCompareArrows
                              aria-hidden
                              className={cn(
                                'size-3.5 shrink-0',
                                isActive ? 'text-primary' : 'text-muted-foreground',
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            {/* 关闭按钮:hover 时显示在 (8, 22) 空槽位,替代对比图标(对齐「打开的编辑器」X ↔ dirty 圆点的覆盖关系) */}
                            <X
                              aria-label="关闭对比"
                              role="button"
                              data-testid={`${dataTestId}-compare-close-${cp.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onCloseCompare?.(cp.id);
                              }}
                              className="absolute left-2 z-10 flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-48" data-testid="compare-context-menu">
                          <ContextMenuItem
                            onSelect={() => onCloseCompare?.(cp.id)}
                            data-testid="ctx-compare-close"
                          >
                            关闭
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() => onCloseAllCompares?.()}
                            data-testid="ctx-compare-close-all"
                          >
                            关闭全部
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </section>
      )}
    </aside>
  );
}

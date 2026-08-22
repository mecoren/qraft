/**
 * 顶栏 Tab 栏 —— VSCode 风格多文件切换
 *
 * - 每个 Tab 依次显示:文件图标 → 标题 → 未保存圆点(•)/ 关闭按钮(×)
 *   共用槽位;平时显示圆点(有未保存改动),悬停 Tab 时圆点淡出、
 *   × 在同一位置淡入(仿 VSCode)
 * - 固定(pinned)Tab 用 Pin 图标替代文件图标,始终排在最前
 * - 激活 Tab:顶部 2px 主色条 + 高亮背景
 * - 右键 Tab 弹出共享 ContextMenu(关闭/固定/复制路径/资源管理器等)
 * - 对比差异项也作为 Tab 展示(如 a.ts ⟷ b.ts),点击切换激活对比,
 *   右键/关闭行为与普通 Tab 一致
 * - 横向可滚动;关闭按钮在悬停 Tab 时显示
 * - 横向滚动条复用 @/components/ui/scroll-area(Radix ScrollArea),
 *   与左侧「打开的编辑器」面板是同一个组件:
 *   - 滚动条绝对定位悬浮在内容上,不占布局
 *   - type="hover":平时隐藏,鼠标悬浮 Tab 栏时显现,拖拽中保持显示
 *   - 轨道 14px、滑块 10px(2px 内缩)、全圆角胶囊、--scrollbar-slider-* token
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { FileText, GitCompareArrows, Pin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabContextMenu } from './TabContextMenu';
import type { ComparePair, EditorTab } from './schema';

export interface EditorTabsBarProps {
  tabs: readonly EditorTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** 对比差异项(渲染为 Tab) */
  compares?: readonly ComparePair[];
  /** 当前激活的对比项 id */
  activeCompareId?: string | null;
  /** 点击对比 Tab:切换激活该对比 */
  onSelectCompare?: (id: string) => void;
  /** 关闭对比 Tab(移除该对比) */
  onCloseCompare?: (id: string) => void;
  /** 关闭其他(保留目标与全部固定 Tab) */
  onCloseOthers?: (id: string) => void;
  /** 关闭目标右侧(保留固定 Tab) */
  onCloseRight?: (id: string) => void;
  /** 关闭全部已保存 Tab */
  onCloseSaved?: () => void;
  /** 关闭全部(保留固定 Tab) */
  onCloseAll?: () => void;
  /** 切换固定状态 */
  onTogglePin?: (id: string) => void;
  /** 拖拽排序:将 dragId 的 Tab 移到 beforeTabId 之前(null 表示移到末尾);固定 Tab 恒在最前 */
  onReorder?: (dragId: string, beforeTabId: string | null) => void;
  /** 保存指定 Tab */
  onSave?: (id: string) => void;
  /** 在文件资源管理器中显示 */
  onRevealInExplorer?: (id: string) => void;
  /** 复制路径到剪贴板 */
  onCopyPath?: (id: string) => void;
  /** 测试定位用 */
  'data-testid'?: string;
}

export function EditorTabsBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  compares = [],
  activeCompareId = null,
  onSelectCompare,
  onCloseCompare,
  onCloseOthers,
  onCloseRight,
  onCloseSaved,
  onCloseAll,
  onTogglePin,
  onReorder,
  onSave,
  onRevealInExplorer,
  onCopyPath,
  'data-testid': dataTestId,
}: EditorTabsBarProps): JSX.Element {
  /** 滚动容器:指向 ScrollArea 内部 Viewport(div) */
  const scrollRef = useRef<HTMLDivElement>(null);

  /** 激活 Tab 或激活对比项(id 唯一,不冲突) */
  const activeId = activeCompareId ?? activeTabId;

  /**
   * 激活 Tab/对比项变化时,自动把它滚到可视区域:
   * - 激活项在视口左侧外 → 滚到最左
   * - 激活项在视口右侧外 → 滚到最右
   * - 在视口内 → 不滚动,避免抖动
   *
   * 这是 VSCode 的行为:横向溢出时,切换 Tab 会让激活 Tab 跟着进入视野,
   * 否则用户切到一个被挤出去的 Tab 看不到任何反馈,会以为没切换成功。
   */
  useEffect(() => {
    if (!activeId) return;
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeId)}"][data-active="true"]`,
    );
    if (!active) return;
    const cRect = container.getBoundingClientRect();
    const tRect = active.getBoundingClientRect();
    if (tRect.left < cRect.left) {
      container.scrollTo({ left: active.offsetLeft - 8, behavior: 'smooth' });
    } else if (tRect.right > cRect.right) {
      container.scrollTo({
        left: active.offsetLeft + active.offsetWidth - container.clientWidth + 8,
        behavior: 'smooth',
      });
    }
  }, [activeId, dataTestId]);

  /** 固定 Tab 排在数组最前(稳定排序,不改变同组内相对顺序) */
  const sortedTabs = useMemo(() => {
    if (tabs.length === 0) return tabs;
    return [...tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [tabs]);

  /**
   * 拖拽排序 —— Pointer Events 自实现
   *
   * 为什么不用 HTML5 DnD:Tauri v2 在 Windows WebView2 上会拦截/破坏页面内部
   * 元素的 HTML5 拖拽事件(dragstart/dragover/drop),即使 dragDropEnabled: false
   * 也不可靠。Pointer Events(mousedown/mousemove/mouseup)是底层通用事件,
   * 不受任何窗口级拖放拦截影响,是 Tauri 应用实现内部拖拽的标准做法。
   *
   * 机制:
   * - Tab 的 onPointerDown 记录拖拽起点(仅左键、非关闭按钮)
   * - 容器 onPointerMove 超过阈值(5px)后进入拖拽,实时计算插入位置
   * - window 级 pointerup/pointercancel 兜底结束(鼠标拖出容器也能松手)
   * - 拖拽结束后抑制紧随的 click,避免误切换 Tab
   */

  /** 拖拽中:被拖拽的 Tab id(用于半透明视觉反馈) */
  const [dragId, setDragId] = useState<string | null>(null);
  /**
   * 插入位置指示:
   * - undefined:未在拖拽(无指示)
   * - null:拖到末尾(在最后一个 Tab 右侧画指示线)
   * - string:在该 Tab id 左侧画指示线
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
  /** 拖拽结束后抑制紧随的 click,避免误切换 Tab */
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

  /** Tab 按下:仅左键、非关闭按钮时记录拖拽起点(普通点击不受影响) */
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, tab: EditorTab) => {
    if (e.button !== 0) return;
    // 从关闭按钮按下拖动不应触发 Tab 拖拽
    if ((e.target as HTMLElement).closest('button')) return;
    pointerStartRef.current = { id: tab.id, clientX: e.clientX, clientY: e.clientY };
  };

  /**
   * 依据鼠标水平位置计算放置目标(与 store.reorderTabs 固定约束一致):
   * - 鼠标落在某 Tab 左半 → 插到该 Tab 之前;右半 → 插到下一 Tab 之前
   * - 落在所有 Tab 右侧/空白 → 末尾(null)
   */
  const computeDropBeforeId = (clientX: number, draggingId: string): string | null => {
    const container = scrollRef.current;
    if (!container) return null;
    let hitIndex = -1;
    let hitRect: DOMRect | null = null;
    for (let i = 0; i < sortedTabs.length; i++) {
      const el = container.querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(sortedTabs[i].id)}"]`,
      );
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX < rect.right) {
        hitIndex = i;
        hitRect = rect;
        break;
      }
    }
    let targetIndex: number;
    if (hitIndex === -1) {
      // 落在所有 Tab 右侧/空白:末尾
      targetIndex = sortedTabs.length;
    } else if (clientX < (hitRect as DOMRect).left + (hitRect as DOMRect).width / 2) {
      // 左半 → 插到该 Tab 之前
      targetIndex = hitIndex;
    } else {
      // 右半 → 插到下一 Tab 之前
      targetIndex = hitIndex + 1;
    }
    const dragIndex = sortedTabs.findIndex((t) => t.id === draggingId);
    const dragTab = dragIndex >= 0 ? sortedTabs[dragIndex] : undefined;
    const pinnedCount = sortedTabs.filter((t) => t.pinned).length;
    if (dragTab?.pinned) {
      // 固定 Tab:只能在固定区(0..pinnedCount)内移动
      targetIndex = Math.max(0, Math.min(targetIndex, pinnedCount));
    } else if (dragTab) {
      // 非固定 Tab:不能插入固定区
      targetIndex = Math.max(pinnedCount, Math.min(targetIndex, sortedTabs.length));
    }
    // 目标在 drag 之后时,移除 drag 后的数组索引需 -1,再映射回 Tab id
    if (dragIndex >= 0 && targetIndex > dragIndex) targetIndex -= 1;
    const restTabs = sortedTabs.filter((t) => t.id !== draggingId);
    const target = restTabs[targetIndex];
    return target ? target.id : null;
  };

  /** 容器内移动:越过阈值进入拖拽,实时更新插入位置并自动横向滚动 */
  const handleContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start) return;
    if (!draggingRef.current) {
      const dx = e.clientX - start.clientX;
      const dy = e.clientY - start.clientY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      beginDrag(start.id);
    }
    e.preventDefault();
    const beforeId = computeDropBeforeId(e.clientX, start.id);
    dropBeforeIdRef.current = beforeId;
    setDropBeforeId(beforeId);
    // 拖到左/右边缘自动滚动,便于把 Tab 拖到可视区外
    const container = scrollRef.current;
    if (container) {
      const cRect = container.getBoundingClientRect();
      if (e.clientX < cRect.left + 32) container.scrollLeft -= 12;
      else if (e.clientX > cRect.right - 32) container.scrollLeft += 12;
    }
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
    <div
      data-testid={dataTestId}
      // 顶部圆角:与父容器(右侧主页面卡片,rounded-lg)的顶角对齐,
      // 避免卡片左上/右上圆角处 Tab 栏直角背景直接露出。
      // overflow-hidden 让横滚区域与 Tab 标签的圆角同步(横滑时被圆角裁切)。
      // 高度 h-9(36px):与 Monaco / VSCode 标签栏一致。
      // 滚动条为「悬浮 overlay」方案(与参考图一致):
      // - 标签 row 占满整个 36px,文字垂直居中,不被滚动条影响
      // - ScrollBar 绝对定位悬浮在 Root 底部(absolute bottom:0),不占布局
      // - 平时隐藏(type="hover"),悬浮标签栏时显现;有横向溢出时出现滑块
      // - 轨道 pointer-events-none 鼠标穿透,滑块仅 hover/scroll 时可见
      className="flex h-9 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-background-layer"
      role="tablist"
      aria-label="打开的编辑器"
    >
      <ScrollArea
        viewportRef={scrollRef}
        orientation="horizontal"
        // Monaco 标签栏悬浮滚动条:
        // - 标签 row 占满整个 36px,文字垂直居中(用户要求:占满标题、不被滚动条影响)
        // - ScrollBar 为「细悬浮条」:h-1.5(6px)细滑块,type="hover" 平时完全隐藏,
        //   有横向溢出 + 鼠标悬浮标签栏时才半透明浮现,拖拽中保持显示
        // - 滑块浮在标签底部边缘(absolute bottom:0),因足够细且半透明,
        //   视觉上「悬浮在内容上」,不截断文字、不占布局(Monaco 真实行为)
        type="hover"
        scrollbarClassName="h-1.5 p-0"
        className="h-full min-w-0 flex-1"
      >
        {/* 内层 flex 容器:Tab 横向排布且 min-w-max,触发 Viewport 横向滚动。
         * 占满 Viewport 全高 36px,标签文字 items-center 垂直居中。
         * 容器级 pointermove:拖拽中实时计算插入位置;空白区域视为末尾。 */}
        <div
          className="flex h-full min-w-max items-stretch"
          onPointerMove={handleContainerPointerMove}
        >
          {tabs.length === 0 && compares.length === 0 ? (
            <div
              data-testid={`${dataTestId}-empty`}
              // 用「固定行高 + 固定高度」保证垂直居中,不依赖父级高度链:
              // - Tab 栏容器是 h-9(36px),但它在 ScrollArea 的 Viewport(横向
              //   滚动容器)内部,Viewport 子元素 h-full 不一定拿到 36px
              //   (overflow-x:auto 的滚动容器对子元素高度计算有特殊性)
              // - 直接给空态 div h-9 + leading-none + items-center,任何
              //   情况下文字都精确垂直居中于 36px 内
              className="flex h-9 shrink-0 items-center px-3 text-xs leading-none text-muted-foreground"
            >
              无打开的编辑器
            </div>
          ) : (
            <>
              {sortedTabs.map((tab, index) => {
                const active = tab.id === activeTabId;
                const dirty = tab.content !== tab.savedContent;
                return (
                  <TabContextMenu
                    key={tab.id}
                    tab={tab}
                    onClose={() => onClose(tab.id)}
                    onCloseOthers={() => onCloseOthers?.(tab.id)}
                    onCloseRight={() => onCloseRight?.(tab.id)}
                    onCloseSaved={() => onCloseSaved?.()}
                    onCloseAll={() => onCloseAll?.()}
                    onTogglePin={() => onTogglePin?.(tab.id)}
                    onSave={() => onSave?.(tab.id)}
                    onRevealInExplorer={() => onRevealInExplorer?.(tab.id)}
                    onCopyPath={() => onCopyPath?.(tab.id)}
                  >
                    <div
                      role="tab"
                      aria-selected={active}
                      data-active={active ? 'true' : 'false'}
                      data-tab-id={tab.id}
                      data-testid={`${dataTestId}-tab-${tab.title}`}
                      // 拖拽排序:仅传入 onReorder 时启用(对比 Tab 不参与)
                      onPointerDown={(e) => handlePointerDown(e, tab)}
                      onClick={() => {
                        // 拖拽结束后抑制紧随的 click,避免误切换 Tab
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        onSelect(tab.id);
                      }}
                      // 鼠标中键关闭(仿 VSCode / Chrome 标签页):在 Tab 任意位置
                      // 按下中键即可关闭该 Tab,无需精确点中右上角 × 按钮。
                      // - 使用 onMouseDown 而非 onAuxClick:auxclick 在部分 WebView2
                      //   版本上不触发,而 mousedown 是底层通用事件,且能在浏览器
                      //   默认的「中键自动滚动」发生前用 preventDefault 拦截
                      // - e.button === 1:仅响应中键(左键=0,中键=1,右键=2)
                      // - 左键 / 右键不受影响,仍走 onClick 选中
                      onMouseDown={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          onClose(tab.id);
                        }
                      }}
                      className={cn(
                        // 顶部 2px 主色条:激活时显示,与 VSCode 当前 Tab 顶条一致
                        // shrink-0 + min-w-[120px]:Tab 数量多时不被压缩到几乎不可见,
                        // 让 Viewport 触发横向滚动
                        // h-9(36px)显式高度:点击区域覆盖整个标题栏高度,与
                        // ScrollArea Root 等高,用户点击标签顶部到底部都是热区
                        // items-center 让文字 / 圆点 / 关闭按钮在 36px 内垂直居中
                        'group relative flex h-9 shrink-0 min-w-[120px] max-w-52 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs',
                        active
                          ? 'border-t-2 border-t-primary bg-card text-foreground'
                          : 'border-t-2 border-t-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        // 拖拽中的 Tab 半透明(仿 VSCode 拖起效果)
                        dragId === tab.id && 'opacity-40',
                      )}
                    >
                      {/* 插入位置指示线:拖拽时在该 Tab 左侧画主色竖线 */}
                      {dropBeforeId === tab.id && (
                        <span
                          aria-hidden
                          data-testid={`${dataTestId}-drop-before-${tab.title}`}
                          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"
                        />
                      )}
                      {/* 插入位置指示线:拖到末尾时在最后一个 Tab 右侧画竖线 */}
                      {dropBeforeId === null && index === sortedTabs.length - 1 && (
                        <span
                          aria-hidden
                          data-testid={`${dataTestId}-drop-end`}
                          className="absolute top-1.5 bottom-1.5 right-0 w-0.5 rounded-full bg-primary"
                        />
                      )}
                      {/*
                       * Tab 依次:图标 → 文件名 → 未保存圆点/关闭按钮共用槽位。
                       * 固定 Tab 用 Pin 图标替代文件图标(对齐 VSCode 语义)。
                       */}
                      {tab.pinned ? (
                        <Pin
                          aria-label="已固定"
                          data-testid={`${dataTestId}-pin-${tab.title}`}
                          className={cn(
                            'size-3.5 shrink-0',
                            active ? 'text-primary' : 'text-muted-foreground/70',
                          )}
                        />
                      ) : (
                        <FileText aria-hidden className="size-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 truncate" title={tab.title}>
                        {tab.title}
                      </span>
                      {/*
                       * 未保存圆点 / 关闭按钮 共用槽位(ml-auto 锚定右侧):
                       * 平时显示未保存圆点(有未保存改动时),悬停 Tab 时
                       * 圆点淡出、关闭按钮在同一位置淡入(仿 VSCode)。
                       * 无未保存改动时槽位留空,悬停同样出现关闭按钮。
                       */}
                      <span className="relative ml-auto flex size-4 shrink-0 items-center justify-center">
                        {dirty && (
                          <span
                            aria-label="未保存"
                            data-testid={`${dataTestId}-dirty-${tab.title}`}
                            className="size-2 rounded-full bg-primary transition-opacity group-hover:opacity-0"
                          />
                        )}
                        <button
                          type="button"
                          // 从关闭按钮按下拖动不应触发 Tab 拖拽(见 handlePointerDown 守卫)
                          aria-label={`关闭 ${tab.title}`}
                          data-testid={`${dataTestId}-close-${tab.title}`}
                          onClick={(e) => {
                            // 阻止冒泡,避免同时触发 Tab 切换
                            e.stopPropagation();
                            onClose(tab.id);
                          }}
                          className="absolute inset-0 z-10 flex items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                        >
                          <X aria-hidden className="size-3" />
                        </button>
                      </span>
                    </div>
                  </TabContextMenu>
                );
              })}

              {/* 对比差异 Tab:显示为 a.ts ⟷ b.ts,点击激活对比,× 移除 */}
              {compares.map((cp) => {
                const left = tabs.find((t) => t.id === cp.leftTabId);
                const right = tabs.find((t) => t.id === cp.rightTabId);
                const label = `${left?.title ?? '?'} ⟷ ${right?.title ?? '?'}`;
                const active = cp.id === activeCompareId;
                return (
                  <div
                    key={cp.id}
                    role="tab"
                    aria-selected={active}
                    data-active={active ? 'true' : 'false'}
                    data-tab-id={cp.id}
                    data-testid={`${dataTestId}-compare-tab-${cp.id}`}
                    onClick={() => onSelectCompare?.(cp.id)}
                    onMouseDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        onCloseCompare?.(cp.id);
                      }
                    }}
                    title={label}
                    className={cn(
                      'group relative flex h-9 shrink-0 min-w-[120px] max-w-52 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs',
                      active
                        ? 'border-t-2 border-t-primary bg-card text-foreground'
                        : 'border-t-2 border-t-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    <GitCompareArrows
                      aria-hidden
                      data-testid={`${dataTestId}-compare-icon-${cp.id}`}
                      className={cn(
                        'size-3.5 shrink-0',
                        active ? 'text-primary' : 'text-muted-foreground/70',
                      )}
                    />
                    <span className="min-w-0 truncate">{label}</span>
                    {/* 关闭按钮槽位:与普通 Tab 一致,悬停时在右侧槽位内淡入 */}
                    <span className="relative ml-auto flex size-4 shrink-0 items-center justify-center">
                      <button
                        type="button"
                        aria-label={`关闭对比 ${label}`}
                        data-testid={`${dataTestId}-compare-close-${cp.id}`}
                        onClick={(e) => {
                          // 阻止冒泡,避免同时触发 Tab 切换
                          e.stopPropagation();
                          onCloseCompare?.(cp.id);
                        }}
                        className="absolute inset-0 z-10 flex items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                      >
                        <X aria-hidden className="size-3" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

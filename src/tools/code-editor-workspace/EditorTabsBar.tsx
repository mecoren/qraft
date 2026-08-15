/**
 * 顶栏 Tab 栏 —— VSCode 风格多文件切换
 *
 * - 每个 Tab 显示标题 + 未保存圆点(•)+ 关闭按钮(×)
 * - 固定(pinned)Tab 始终排在最前,显示 Pin 图标(对齐 VSCode 语义)
 * - 激活 Tab:顶部 2px 主色条 + 高亮背景
 * - 右键 Tab 弹出共享 ContextMenu(关闭/固定/复制路径/资源管理器等)
 * - 横向可滚动;关闭按钮在悬停 Tab 时显示
 * - 横向滚动条复用 @/components/ui/scroll-area(Radix ScrollArea),
 *   与左侧「打开的编辑器」面板是同一个组件:
 *   - 滚动条绝对定位悬浮在内容上,不占布局
 *   - type="hover":平时隐藏,鼠标悬浮 Tab 栏时显现,拖拽中保持显示
 *   - 轨道 14px、滑块 10px(2px 内缩)、全圆角胶囊、--scrollbar-slider-* token
 */
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { Pin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabContextMenu } from './TabContextMenu';
import type { EditorTab } from './schema';

export interface EditorTabsBarProps {
  tabs: readonly EditorTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
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
  onCloseOthers,
  onCloseRight,
  onCloseSaved,
  onCloseAll,
  onTogglePin,
  onSave,
  onRevealInExplorer,
  onCopyPath,
  'data-testid': dataTestId,
}: EditorTabsBarProps): JSX.Element {
  /** 滚动容器:指向 ScrollArea 内部 Viewport(div) */
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * 激活 Tab 变化时,自动把它滚到可视区域:
   * - 激活 Tab 在视口左侧外 → 滚到最左
   * - 激活 Tab 在视口右侧外 → 滚到最右
   * - 在视口内 → 不滚动,避免抖动
   *
   * 这是 VSCode 的行为:横向溢出时,切换 Tab 会让激活 Tab 跟着进入视野,
   * 否则用户切到一个被挤出去的 Tab 看不到任何反馈,会以为没切换成功。
   */
  useEffect(() => {
    if (!activeTabId) return;
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeTabId)}"][data-active="true"]`,
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
  }, [activeTabId, dataTestId]);

  /** 固定 Tab 排在数组最前(稳定排序,不改变同组内相对顺序) */
  const sortedTabs = useMemo(() => {
    if (tabs.length === 0) return tabs;
    return [...tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [tabs]);

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
           * 占满 Viewport 全高 36px,标签文字 items-center 垂直居中。 */}
        <div className="flex h-full min-w-max items-stretch">
          {tabs.length === 0 ? (
            <div
              data-testid={`${dataTestId}-empty`}
              className="flex items-center px-3 text-xs text-muted-foreground"
            >
              无打开的编辑器
            </div>
          ) : (
            sortedTabs.map((tab) => {
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
                    onClick={() => onSelect(tab.id)}
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
                    )}
                  >
                    {tab.pinned && (
                      <Pin
                        aria-label="已固定"
                        data-testid={`${dataTestId}-pin-${tab.title}`}
                        className={cn(
                          'size-3 shrink-0',
                          active ? 'text-primary' : 'text-muted-foreground/70',
                        )}
                      />
                    )}
                    {dirty && (
                      <span
                        aria-label="未保存"
                        data-testid={`${dataTestId}-dirty-${tab.title}`}
                        className="size-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                    <span className="truncate" title={tab.title}>
                      {tab.title}
                    </span>
                    <button
                      type="button"
                      aria-label={`关闭 ${tab.title}`}
                      data-testid={`${dataTestId}-close-${tab.title}`}
                      onClick={(e) => {
                        // 阻止冒泡,避免同时触发 Tab 切换
                        e.stopPropagation();
                        onClose(tab.id);
                      }}
                      className={cn(
                        'ml-auto flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                        // 非激活 Tab 的关闭按钮悬停 Tab 时才显示(仿 VSCode)
                        !active && 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <X aria-hidden className="size-3" />
                    </button>
                  </div>
                </TabContextMenu>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

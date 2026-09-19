/**
 * 左栏拖拽分隔条 —— 自管理拖拽 handle
 *
 * 替代 react-resizable-panels 的 ResizablePanelGroup:
 * - mousedown 记录拖拽基准:可见时为「当前宽度+光标X」;隐藏时以侧栏
 *   左缘为零点锚定(startWidth=0)
 * - mousemove 经 resolveSidebarResize 推导动作:夹在 MIN~MAX 之间调宽;
 *   越过「MIN - 隐藏阈值」继续左移 → 隐藏左栏;隐藏中右移 → 先以最小
 *   宽度展示,光标越过「左缘 + MIN」才跟手放宽
 * - hide 时把基准重锚为 -滞回带,防止在阈值附近震荡;show 不动基准
 * - mouseup 结束并隐藏全局光标样式
 * - 拖拽中通过 setSidebarWidth / setLeftSidebarVisible 写入 store,
 *   经 persist 防抖持久化
 *
 * 优势:不受容器宽度百分比 layout 限制,左栏始终有明确的像素宽度。
 *
 * 视觉反馈:
 * - 默认:完全透明 — 两卡片之间只有窄间距,没有分割线
 * - hover/focus/active:显示一条与分割空间同宽(4px)的主色蓝线,
 *   同时出现 grip 图标,用户一眼即可识别「此处可拖动调整宽度」;
 *   左栏隐藏后该反馈保留,提示「右拖可恢复显示」
 */
import { useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import {
  resolveSidebarResize,
  SIDEBAR_HIDE_DELTA,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './schema';

export function SidebarResizeHandle({
  onHoverChange,
  onActiveChange,
}: {
  /** hover 状态变化回调(父组件用于联动侧栏动作按钮显隐) */
  onHoverChange?: (v: boolean) => void;
  /** 拖拽中状态变化回调(同上) */
  onActiveChange?: (v: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const startWidthRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  /** 最小宽度钉住阶段:隐藏态按下,或刚由拖拽恢复、尚未越过最小宽度边界。
   * 此阶段隐藏判定改用左缘零点规则,避免钉住区误触标准隐藏阈值 */
  const pinnedRef = useRef<boolean>(false);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  /** 订阅当前左栏宽度,用于可访问性 aria-valuenow 实时跟随拖拽更新 */
  const sidebarWidth = useEditorWorkspaceStore((s) => s.workspace.sidebarWidth);
  /** 订阅可见性:决定 mousedown 基准宽度与 handle 的提示文案 */
  const sidebarVisible = useEditorWorkspaceStore((s) => s.workspace.leftSidebarVisible);

  /** 统一的 hover 状态更新:内部 state + 外部回调保持同步 */
  const updateHovered = (v: boolean): void => {
    setHovered(v);
    onHoverChange?.(v);
  };
  /** 统一的拖拽中状态更新:内部 state + 外部回调保持同步 */
  const updateActive = (v: boolean): void => {
    setActive(v);
    onActiveChange?.(v);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const { sidebarWidth: width, leftSidebarVisible } =
      useEditorWorkspaceStore.getState().workspace;
    if (leftSidebarVisible) {
      // 可见:从当前宽度起算(夹取防越界),分隔条即侧栏右缘
      startWidthRef.current = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
      startXRef.current = e.clientX;
      pinnedRef.current = false;
    } else {
      // 隐藏:以侧栏左缘为零点锚定(startWidth=0),raw = 光标到左缘距离,
      // 并进入钉住阶段。恢复后光标越过「左缘 + 最小宽度」前 clamp 恒为
      // 最小宽度,越过该边界才跟手放宽
      startWidthRef.current = 0;
      startXRef.current = e.clientX;
      pinnedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = 'col-resize';
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = 'none';
    updateActive(true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  function handleMouseMove(ev: MouseEvent): void {
    const st = useEditorWorkspaceStore.getState();
    const next = resolveSidebarResize(
      startWidthRef.current,
      ev.clientX,
      startXRef.current,
      st.workspace.leftSidebarVisible,
      pinnedRef.current,
    );
    if (next.action === 'resize') {
      st.setSidebarWidth(next.width);
      // 越过最小宽度边界后离开钉住阶段,回归标准隐藏判定
      if (next.width > SIDEBAR_MIN_WIDTH) pinnedRef.current = false;
    } else if (next.action === 'hide') {
      // 仅切换可见性,不覆盖已存宽度:菜单/Ctrl+B 恢复时仍回原宽度。
      // 同时把基准重锚为「-滞回带」:同手势需右移回该带宽(越过零点)
      // 才允许恢复显示,避免在隐藏阈值附近来回震荡
      st.setLeftSidebarVisible(false);
      startWidthRef.current = -SIDEBAR_HIDE_DELTA;
      startXRef.current = ev.clientX;
    } else if (next.action === 'show') {
      // 以最小宽度恢复显示并进入钉住阶段;基准已在按下/hide 时锚定到
      // 侧栏左缘零点,无需重置
      st.setLeftSidebarVisible(true);
      st.setSidebarWidth(SIDEBAR_MIN_WIDTH);
      pinnedRef.current = true;
    }
    // idle:隐藏期间继续左移,不做任何写入
  }

  function handleMouseUp(): void {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    pinnedRef.current = false;
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = '';
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = '';
    updateActive(false);
  }

  const highlighted = hovered || active;

  return (
    <div
      data-testid="editor-split-handle"
      onMouseDown={onMouseDown}
      onMouseEnter={() => updateHovered(true)}
      onMouseLeave={() => updateHovered(false)}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={sidebarVisible ? sidebarWidth : SIDEBAR_MIN_WIDTH}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title={
        sidebarVisible ? t('tools.text_editor.resize_hint') : t('tools.text_editor.restore_hint')
      }
      className={cn(
        // 2px 宽点击区,恰好填满 gap-0.5 分割空间;默认完全透明,悬浮时才高亮
        'group relative flex h-full w-0.5 shrink-0 cursor-col-resize items-center justify-center self-stretch bg-transparent focus-visible:outline-none',
      )}
    >
      {/*
       * 高亮竖线:默认透明(中间无分割线);hover/focus/active 时变为 4px 主色蓝线。
       * 固定 4px 不随分割空间(gap-0.5)变窄,保持易识别的悬浮/拖拽目标;
       * shrink-0 防止被 2px 窄容器压缩,由父级 justify-center 居中向两侧各溢出 1px。
       * rounded-md 对齐项目圆角 token(--radius-md,由 globals.css 的 --radius 派生)。
       */}
      <div
        aria-hidden
        className={cn(
          'h-full w-1 shrink-0 rounded-md transition-colors duration-150 ease-out',
          highlighted ? 'bg-primary' : 'bg-transparent',
        )}
      />
    </div>
  );
}

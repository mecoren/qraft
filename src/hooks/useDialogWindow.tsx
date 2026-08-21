/**
 * useDialogWindow —— 可拖拽/缩放弹窗窗口管理 hook
 *
 * 为 SettingsDialog / AboutDialog 等「视口内自由定位」的弹窗提供:
 * - 初始位置视口居中,拖拽/缩放始终限制在视口内(大屏居中、小屏不溢出)
 * - 标题栏拖拽移动(左键 + 跳过 [data-no-drag] 交互区)
 * - 仅四角缩放手柄缩放(避免边缩放导致的不适配)
 * - 窗口 resize 时自动将弹窗 clamp 回视口内
 *
 * 返回:
 * - rect:      弹窗绝对位置与尺寸
 * - dragEvents: 标题栏拖拽事件
 * - resizeEvents: 四角缩放手柄事件
 * - onMove:    弹窗容器上统一的分发器(拖拽与缩放共用)
 */
'use client';

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { cn } from '@/lib/utils';

export interface DialogRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DialogWindowOptions {
  /** 默认宽度(px) */
  defaultWidth: number;
  /** 默认高度(px) */
  defaultHeight: number;
  /** 最小宽度(px) */
  minWidth: number;
  /** 最小高度(px) */
  minHeight: number;
  /** 边缘留白(px),防止弹窗贴边;默认 16 */
  margin?: number;
}

type ResizeDir = 'ne' | 'nw' | 'se' | 'sw';

export interface PointerEvents {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/** 缩放方向的 cursor 样式 */
export const RESIZE_CURSOR: Record<ResizeDir, string> = {
  ne: 'cursor-ne-resize',
  nw: 'cursor-nw-resize',
  se: 'cursor-se-resize',
  sw: 'cursor-sw-resize',
};

export function useDialogWindow(options: DialogWindowOptions) {
  const { defaultWidth, defaultHeight, minWidth, minHeight, margin = 16 } = options;

  /** 当前视口尺寸 */
  const viewportSize = useCallback(() => {
    if (typeof window === 'undefined') {
      return { width: defaultWidth + margin * 2, height: defaultHeight + margin * 2 };
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }, [defaultWidth, defaultHeight, margin]);

  /** 将尺寸限制在视口内(不超过视口,且不小于最小值) */
  const clampSize = useCallback(
    (width: number, height: number) => {
      const vp = viewportSize();
      return {
        width: Math.min(Math.max(width, minWidth), Math.max(vp.width - margin * 2, minWidth)),
        height: Math.min(Math.max(height, minHeight), Math.max(vp.height - margin * 2, minHeight)),
      };
    },
    [viewportSize, minWidth, minHeight, margin],
  );

  /** 将位置限制在视口内(保证弹窗完全可见) */
  const clampPos = useCallback(
    (x: number, y: number, width: number, height: number) => {
      const vp = viewportSize();
      return {
        x: Math.min(Math.max(x, margin), Math.max(vp.width - width - margin, margin)),
        y: Math.min(Math.max(y, margin), Math.max(vp.height - height - margin, margin)),
      };
    },
    [viewportSize, margin],
  );

  /** 计算初始位置:视口居中,尺寸自适应小屏 */
  const initialRect = useCallback(() => {
    const vp = viewportSize();
    const size = clampSize(defaultWidth, defaultHeight);
    const pos = clampPos(
      Math.round((vp.width - size.width) / 2),
      Math.round((vp.height - size.height) / 2),
      size.width,
      size.height,
    );
    return { ...size, ...pos };
  }, [viewportSize, clampSize, clampPos, defaultWidth, defaultHeight]);

  // ── 弹窗位置与尺寸(绝对坐标,基于窗口视口)──
  // 初始化即视口居中;打开/关闭之间保留用户调整后的位置,体验更好
  const [rect, setRect] = useState<DialogRect>(() => initialRect());

  // 窗口尺寸变化时,将弹窗限制在新视口内
  useEffect(() => {
    const onResize = () => {
      setRect((r) => {
        const size = clampSize(r.width, r.height);
        const pos = clampPos(r.x, r.y, size.width, size.height);
        return { ...size, ...pos };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampSize, clampPos]);

  // ── 拖拽移动 ──
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      // 仅左键、且目标不是交互控件时才启动拖拽
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: rect.x,
        originY: rect.y,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // jsdom / 部分环境不支持指针捕获,忽略
      }
    },
    [rect.x, rect.y],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setRect((r) => {
        const size = clampSize(r.width, r.height);
        const pos = clampPos(
          drag.originX + (e.clientX - drag.startX),
          drag.originY + (e.clientY - drag.startY),
          size.width,
          size.height,
        );
        return { ...size, ...pos };
      });
    },
    [clampSize, clampPos],
  );

  const onDragEnd = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // 未捕获指针(jsdom / 非 PointerEvent 环境)时忽略
    }
  }, []);

  // ── 缩放(仅四角)──
  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    origin: DialogRect;
  } | null>(null);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      const dir = (e.currentTarget as HTMLElement).dataset.dir as ResizeDir;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0) return;
      resizeRef.current = { dir, startX: e.clientX, startY: e.clientY, origin: rect };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // jsdom / 部分环境不支持指针捕获,忽略
      }
    },
    [rect],
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = e.clientX - r.startX;
      const dy = e.clientY - r.startY;

      setRect(() => {
        const vp = viewportSize();
        // 最大尺寸 = 视口 - 留白(且不小于最小值)
        const maxW = Math.max(vp.width - margin * 2, minWidth);
        const maxH = Math.max(vp.height - margin * 2, minHeight);

        // 固定对边(锚点),移动另一边
        const anchorRight = r.origin.x + r.origin.width;
        const anchorBottom = r.origin.y + r.origin.height;
        const moveLeft = r.dir.includes('w');
        const moveTop = r.dir.includes('n');

        const left = moveLeft ? r.origin.x + dx : r.origin.x;
        const top = moveTop ? r.origin.y + dy : r.origin.y;
        const right = moveLeft ? anchorRight : anchorRight + dx;
        const bottom = moveTop ? anchorBottom : anchorBottom + dy;

        const width = Math.min(Math.max(right - left, minWidth), maxW);
        const height = Math.min(Math.max(bottom - top, minHeight), maxH);

        // 移动边时锚定对边;未移动边时保持原位
        const x = moveLeft ? right - width : left;
        const y = moveTop ? bottom - height : top;

        // 最终位置必须落在视口内
        const pos = clampPos(x, y, width, height);
        return { x: pos.x, y: pos.y, width, height };
      });
    },
    [viewportSize, margin, minWidth, minHeight, clampPos],
  );

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    resizeRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // 未捕获指针(jsdom / 非 PointerEvent 环境)时忽略
    }
  }, []);

  /** 拖动与缩放共用的指针移动处理 */
  const onMove = useCallback(
    (e: React.PointerEvent) => {
      onDragMove(e);
      onResizeMove(e);
    },
    [onDragMove, onResizeMove],
  );

  return {
    rect,
    dragEvents: { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd },
    resizeEvents: {
      onPointerDown: onResizeStart,
      onPointerMove: onResizeMove,
      onPointerUp: onResizeEnd,
    },
    onMove,
  };
}

/** 角落缩放手柄:透明热区,悬浮四角触发缩放,方向通过 data-dir 标识 */
export function DialogResizeHandle({
  dir,
  className,
  ...events
}: { dir: ResizeDir; className?: string } & PointerEvents): JSX.Element {
  return (
    <div
      data-no-drag
      data-dir={dir}
      className={cn('absolute z-20', RESIZE_CURSOR[dir], className)}
      {...events}
    />
  );
}

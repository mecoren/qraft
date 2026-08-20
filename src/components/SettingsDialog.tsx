/**
 * SettingsDialog —— 设置弹窗
 *
 * 以可拖拽、可缩放的形式承载设置项:
 * - 左侧为设置菜单(主题 / 字体 / 通用 / 文本编辑器 / 快捷键 / 更新 / 关于),右侧为对应内容页
 * - 标题栏支持拖拽移动弹窗
 * - 仅四角支持放大缩小(避免边缩放导致的不适配)
 * - 初始位置视口居中,拖拽/缩放始终限制在视口内(大屏居中、小屏不溢出)
 * - 基于 Radix Dialog 提供模态、遮罩、Esc 关闭、焦点管理
 */

import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Palette,
  Type,
  SlidersHorizontal,
  Keyboard,
  CloudDownload,
  GripHorizontal,
  X,
  Check,
  FileText,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ThemeSection,
  FontSection,
  GeneralSection,
  ShortcutSection,
  UpdateSection,
  EditorSection,
  AboutSection,
} from '@/components/SettingsPanel';
import { ScrollArea } from '@/components/ui/scroll-area';

/** 默认尺寸(px) */
const DEFAULT_WIDTH = 880;
const DEFAULT_HEIGHT = 620;
/** 最小尺寸(px) */
const MIN_WIDTH = 520;
const MIN_HEIGHT = 400;
/** 边缘留白(px),防止弹窗贴边 */
const MARGIN = 16;

type MenuId = 'theme' | 'font' | 'general' | 'editor' | 'shortcuts' | 'update' | 'about';

interface MenuItem {
  id: MenuId;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ResizeDir = 'ne' | 'nw' | 'se' | 'sw';

interface ResizeEvents {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/** 缩放方向的 cursor 样式 */
const RESIZE_CURSOR: Record<ResizeDir, string> = {
  ne: 'cursor-ne-resize',
  nw: 'cursor-nw-resize',
  se: 'cursor-se-resize',
  sw: 'cursor-sw-resize',
};

/** 当前视口尺寸 */
function viewportSize() {
  if (typeof window === 'undefined') {
    return { width: DEFAULT_WIDTH + MARGIN * 2, height: DEFAULT_HEIGHT + MARGIN * 2 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

/** 将尺寸限制在视口内(不超过视口,且不小于最小值) */
function clampSize(width: number, height: number) {
  const vp = viewportSize();
  return {
    width: Math.min(Math.max(width, MIN_WIDTH), Math.max(vp.width - MARGIN * 2, MIN_WIDTH)),
    height: Math.min(Math.max(height, MIN_HEIGHT), Math.max(vp.height - MARGIN * 2, MIN_HEIGHT)),
  };
}

/** 将位置限制在视口内(保证弹窗完全可见) */
function clampPos(x: number, y: number, width: number, height: number) {
  const vp = viewportSize();
  return {
    x: Math.min(Math.max(x, MARGIN), Math.max(vp.width - width - MARGIN, MARGIN)),
    y: Math.min(Math.max(y, MARGIN), Math.max(vp.height - height - MARGIN, MARGIN)),
  };
}

/** 计算初始位置:视口居中,尺寸自适应小屏 */
function initialRect() {
  const vp = viewportSize();
  const size = clampSize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
  const pos = clampPos(
    Math.round((vp.width - size.width) / 2),
    Math.round((vp.height - size.height) / 2),
    size.width,
    size.height,
  );
  return { ...size, ...pos };
}

/** 角落缩放手柄:透明热区,悬浮四角触发缩放,方向通过 data-dir 标识 */
function ResizeHandle({
  dir,
  className,
  ...events
}: { dir: ResizeDir; className?: string } & ResizeEvents): JSX.Element {
  return (
    <div
      data-no-drag
      data-dir={dir}
      className={cn('absolute z-20', RESIZE_CURSOR[dir], className)}
      {...events}
    />
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): JSX.Element {
  const [active, setActive] = useState<MenuId>('theme');

  // ── 弹窗位置与尺寸(绝对坐标,基于窗口视口)──
  // 初始化即视口居中;打开/关闭之间保留用户调整后的位置,体验更好
  const [rect, setRect] = useState(() => initialRect());

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
  }, []);

  const menuItems: MenuItem[] = [
    {
      id: 'theme',
      label: '主题',
      icon: <Palette className="size-4" />,
      content: <ThemeSection />,
    },
    {
      id: 'font',
      label: '字体',
      icon: <Type className="size-4" />,
      content: <FontSection />,
    },
    {
      id: 'general',
      label: '通用',
      icon: <SlidersHorizontal className="size-4" />,
      content: <GeneralSection />,
    },
    {
      id: 'editor',
      label: '文本编辑器',
      icon: <FileText className="size-4" />,
      content: <EditorSection />,
    },
    {
      id: 'shortcuts',
      label: '快捷键',
      icon: <Keyboard className="size-4" />,
      content: <ShortcutSection />,
    },
    {
      id: 'update',
      label: '更新',
      icon: <CloudDownload className="size-4" />,
      content: <UpdateSection />,
    },
    {
      id: 'about',
      label: '关于',
      icon: <Info className="size-4" />,
      content: <AboutSection />,
    },
  ];

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

  const onDragMove = useCallback((e: React.PointerEvent) => {
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
  }, []);

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
    origin: typeof rect;
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

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;

    setRect(() => {
      const vp = viewportSize();
      // 最大尺寸 = 视口 - 留白(且不小于最小值)
      const maxW = Math.max(vp.width - MARGIN * 2, MIN_WIDTH);
      const maxH = Math.max(vp.height - MARGIN * 2, MIN_HEIGHT);

      // 固定对边(锚点),移动另一边
      const anchorRight = r.origin.x + r.origin.width;
      const anchorBottom = r.origin.y + r.origin.height;
      const moveLeft = r.dir.includes('w');
      const moveTop = r.dir.includes('n');

      const left = moveLeft ? r.origin.x + dx : r.origin.x;
      const top = moveTop ? r.origin.y + dy : r.origin.y;
      const right = moveLeft ? anchorRight : anchorRight + dx;
      const bottom = moveTop ? anchorBottom : anchorBottom + dy;

      const width = Math.min(Math.max(right - left, MIN_WIDTH), maxW);
      const height = Math.min(Math.max(bottom - top, MIN_HEIGHT), maxH);

      // 移动边时锚定对边;未移动边时保持原位
      const x = moveLeft ? right - width : left;
      const y = moveTop ? bottom - height : top;

      // 最终位置必须落在视口内
      const pos = clampPos(x, y, width, height);
      return { x: pos.x, y: pos.y, width, height };
    });
  }, []);

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    resizeRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // 未捕获指针(jsdom / 非 PointerEvent 环境)时忽略
    }
  }, []);

  const activeItem = menuItems.find((m) => m.id === active) ?? menuItems[0];

  /** 拖动与缩放共用的指针移动处理 */
  const onMove = useCallback(
    (e: React.PointerEvent) => {
      onDragMove(e);
      onResizeMove(e);
    },
    [onDragMove, onResizeMove],
  );

  /** 缩放手柄统一事件处理器 */
  const resizeEvents: ResizeEvents = {
    onPointerDown: onResizeStart,
    onPointerMove: onResizeMove,
    onPointerUp: onResizeEnd,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        {/* 使用 DialogPrimitive.Content 而非 DialogContent,完全自定义定位与样式:
           避免 Radix 默认的 left-[50%] top-[50%] translate-[-50%]/animate-in/zoom-in 等
           影响弹窗的最终位置,确保弹窗严格按 rect 渲染 */}
        <DialogPrimitive.Content
          className="z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl outline-none"
          style={{
            position: 'fixed',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            transform: 'none',
          }}
          onPointerMove={onMove}
        >
          {/* 顶部拖拽标题栏(注意不要加 data-no-drag 属性,否则会被 onDragStart 拦截) */}
          <div
            className="flex h-12 shrink-0 cursor-grab select-none items-center gap-2 border-b bg-muted/30 px-4 active:cursor-grabbing"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
          >
            <GripHorizontal className="size-4 text-muted-foreground" />
            <DialogTitle className="text-sm font-semibold">设置</DialogTitle>
            <DialogDescription className="sr-only">应用设置</DialogDescription>
            <div className="flex-1" />
            <button
              data-no-drag
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="关闭设置"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* 主体:左菜单 + 右内容 */}
          <div className="flex min-h-0 flex-1">
            {/* 左侧设置菜单 */}
            <nav className="w-52 shrink-0 border-r bg-muted/30 p-2" data-no-drag>
              <ScrollArea className="h-full">
                <ul className="flex flex-col gap-1">
                  {menuItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setActive(item.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                          active === item.id
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                        {active === item.id && <Check className="ml-auto size-4" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </nav>

            {/* 右侧内容页 */}
            <div className="min-w-0 flex-1" data-no-drag>
              <ScrollArea className="h-full">
                <div className="p-6">{activeItem.content}</div>
              </ScrollArea>
            </div>
          </div>

          {/* 仅四角缩放手柄 */}
          <ResizeHandle dir="se" className="bottom-0 right-0 h-4 w-4" {...resizeEvents} />
          <ResizeHandle dir="sw" className="bottom-0 left-0 h-4 w-4" {...resizeEvents} />
          <ResizeHandle dir="ne" className="right-0 top-0 h-4 w-4" {...resizeEvents} />
          <ResizeHandle dir="nw" className="left-0 top-0 h-4 w-4" {...resizeEvents} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

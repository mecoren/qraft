/**
 * SettingsDialog —— 设置弹窗
 *
 * 以可拖拽、可缩放的形式承载设置项:
 * - 左侧为设置菜单(主题 / 字体 / 通用 / 文本编辑器 / 快捷键 / 更新),右侧为对应内容页
 * - 关于已独立为 AboutDialog,由侧边栏「关于」入口打开,不再属于设置
 * - 标题栏支持拖拽移动弹窗,仅四角支持放大缩小
 * - 拖拽/缩放逻辑由 useDialogWindow hook 提供
 * - 基于 Radix Dialog 提供模态、遮罩、Esc 关闭、焦点管理
 */

import { useEffect, useState, type JSX, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
} from 'lucide-react';
import {
  ThemeSection,
  FontSection,
  GeneralSection,
  ShortcutSection,
  UpdateSection,
  EditorSection,
} from '@/components/SettingsPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useDialogWindow, DialogResizeHandle } from '@/hooks/useDialogWindow';
import { useSearchStore } from '@/store/searchStore';
import { scheduleHighlight } from '@/hooks/useSearchJump';

/** 默认尺寸(px) */
const DEFAULT_WIDTH = 880;
const DEFAULT_HEIGHT = 620;
/** 最小尺寸(px) */
const MIN_WIDTH = 520;
const MIN_HEIGHT = 400;

type MenuId = 'theme' | 'font' | 'general' | 'editor' | 'shortcuts' | 'update';

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

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): JSX.Element {
  const [active, setActive] = useState<MenuId>('theme');

  const { rect, dragEvents, resizeEvents, onMove } = useDialogWindow({
    defaultWidth: DEFAULT_WIDTH,
    defaultHeight: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  });

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
  ];

  const activeItem = menuItems.find((m) => m.id === active) ?? menuItems[0];

  // 全局搜索跳转:目标为设置视图时切换左侧菜单并定位字段高亮。
  // 消费时机只在弹窗打开时(open=true):弹窗未打开时保留 target,
  // 由 useSearchJump 负责 setView('settings') 打开弹窗,本 effect 随 open/target
  // 变化再次触发消费,避免与 useSearchJump 的 effect 竞态导致视图切换丢失。
  const target = useSearchStore((s) => s.target);
  const consume = useSearchStore((s) => s.consume);

  useEffect(() => {
    if (!open) return;
    const t = useSearchStore.getState().target;
    if (!t || t.view !== 'settings') return;
    // 放入宏任务:让菜单 state 更新与高亮定位脱离 effect 同步路径(避免级联渲染)
    window.setTimeout(() => {
      if (t.settingsMenu) setActive(t.settingsMenu);
      // 字段锚点(settings:menu:field)或分区锚点(settings:menu):
      // 等待菜单切换 + 内容渲染后定位高亮(重试机制兜底)
      if (t.anchor?.startsWith('settings:')) {
        scheduleHighlight(t.anchor);
      }
      useSearchStore.getState().consume();
    }, 0);
  }, [open, target, consume]);

  return (
    // modal={false}:关闭 Radix 的 RemoveScroll 滚动锁定。
    // 根因:modal Dialog 的 Overlay 会包裹 react-remove-scroll,其 document 级
    // 非 passive wheel 监听会对「目标不在 dialog 内容/shards 内」的滚轮事件
    // 一律 preventDefault —— 而 FontPicker 下拉经 Portal 渲染在 body 末尾,
    // 恰好在锁外,导致设置弹窗内所有下拉框滚轮失效(滑块拖拽不受影响)。
    // 非模态后滚动恢复原生行为;遮罩由下方自绘 div 提供(视觉不变)。
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPortal>
        {/* 自绘遮罩:modal=false 时 Radix 不再渲染 Overlay(其内部被 modal 门控),
            这里用普通 div 维持原有的压暗背景与点击外部关闭体验 */}
        <div
          aria-hidden
          className="fixed inset-0 z-50 bg-black/80"
          onClick={() => onOpenChange(false)}
        />
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
            {...dragEvents}
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
                        data-search-anchor={`settings:${item.id}`}
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
          <DialogResizeHandle dir="se" className="bottom-0 right-0 h-4 w-4" {...resizeEvents} />
          <DialogResizeHandle dir="sw" className="bottom-0 left-0 h-4 w-4" {...resizeEvents} />
          <DialogResizeHandle dir="ne" className="right-0 top-0 h-4 w-4" {...resizeEvents} />
          <DialogResizeHandle dir="nw" className="left-0 top-0 h-4 w-4" {...resizeEvents} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

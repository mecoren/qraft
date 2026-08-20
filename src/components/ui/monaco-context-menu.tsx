/**
 * MonacoContextMenu —— Monaco 编辑器中文右键菜单(shadcn 视觉)
 *
 * 背景:
 * - Monaco 0.56 ESM 包不提供 setLocale/本地化 API,原生右键菜单恒为英文。
 * - CodeEditor 通过 options.contextmenu: false 禁用 Monaco 原生菜单,
 *   并在 editor.onContextMenu 回调中记录右键坐标、打开本菜单。
 *
 * 定位方式:
 * - 不使用 Radix ContextMenu(受控模式下在 WebView2 中锚定不稳定,会落到 0,0)。
 * - 直接用 position: fixed + left/top 定位的自管理浮层,复用 shadcn 菜单
 *   视觉类名,视觉与 Tab/列表右键菜单一致;createPortal 到 document.body。
 *
 * 执行机制(Monaco 0.56 实测确认):
 * - Monaco 内置编辑命令分为两类,统一用 editor.trigger('keyboard', id) 触发:
 *   a. registerCommand(命令): undo / redo / editor.action.selectAll /
 *      editor.action.clipboardCutAction / clipboardCopyAction / clipboardPasteAction
 *      —— 注意 undo/redo 无 editor.action. 前缀
 *   b. registerEditorAction(动作): editor.action.find / replace /
 *      formatDocument / quickCommand —— editor.trigger 同样可触发
 * - editor.getAction(id) 只对 registerEditorAction 返回非 null,
 *   对 registerCommand 返回 null,因此禁用判断不用 getAction 探测
 *   (否则命令类菜单项会被误判为不存在)。
 *
 * 菜单项:撤销 / 重做 | 剪切 / 复制 / 粘贴 | 全选 | 查找 / 替换 |
 *        格式化文档 | 命令面板;剪切/复制按选区禁用,粘贴按只读禁用。
 *        启用折叠时(options.folding = true)末尾追加「折叠 / 展开 /
 *        切换折叠 / 全部折叠 / 全部展开」组,动作 id 见 FOLDING_MENU_DEFS。
 *
 * 已知坑(0.56 源码确认):
 * - 查找/替换的 id 不是 editor.action.find/replace,而是
 *   actions.find / editor.action.startFindReplaceAction
 * - 粘贴命令在 WebView2 中 editor.trigger 不视为用户手势,execCommand('paste')
 *   被拒绝;改为 navigator.clipboard.readText() + editor.executeEdits 手动插入。
 */
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { OnMount } from '@monaco-editor/react';

/** Monaco 编辑器实例类型(onMount 回调的入参) */
export type MonacoEditor = Parameters<OnMount>[0];

export interface MonacoContextMenuProps {
  /** 编辑器实例(由 onMount 传入) */
  editor: MonacoEditor | null;
  /** 是否只读(禁用剪切/粘贴) */
  readOnly: boolean;
  /**
   * 是否启用了代码折叠(应与编辑器 options.folding 保持一致),默认 true。
   * Monaco 折叠动作的前置条件是 CONTEXT_FOLDING_ENABLED(options.folding),
   * 因此折叠关闭时整个折叠菜单组不注入,避免出现「点了没反应」的无效项。
   */
  folding?: boolean;
  /** 菜单是否打开 */
  open: boolean;
  /** 右键坐标(client 坐标,fixed 定位用) */
  position: { x: number; y: number };
  /** 关闭回调 */
  onClose: () => void;
  /** 测试定位用 */
  'data-testid'?: string;
}

interface MenuEntry {
  /** Monaco 命令/动作 id(editor.trigger 用) */
  id: string;
  label: string;
  shortcut?: string;
  /** 是否禁用(仅上下文禁用:剪切/复制需选区,粘贴只读) */
  disabled: boolean;
}

/**
 * Monaco 0.56 内置命令/动作 id(来源:node_modules/monaco-editor/esm/vs
 * 中 editorExtensions.js / coreCommands.js / clipboard.js / formatActions.js)。
 * 撤销/重做为裸 id(undo/redo),其余带 editor.action. 前缀。
 */
const MENU_DEFS: Omit<MenuEntry, 'disabled'>[] = [
  { id: 'undo', label: '撤销', shortcut: 'Ctrl+Z' },
  { id: 'redo', label: '重做', shortcut: 'Ctrl+Y' },
  { id: '__sep__1', label: '' },
  { id: 'editor.action.clipboardCutAction', label: '剪切', shortcut: 'Ctrl+X' },
  { id: 'editor.action.clipboardCopyAction', label: '复制', shortcut: 'Ctrl+C' },
  { id: '__paste__', label: '粘贴', shortcut: 'Ctrl+V' },
  { id: '__sep__2', label: '' },
  { id: 'editor.action.selectAll', label: '全选', shortcut: 'Ctrl+A' },
  { id: '__sep__3', label: '' },
  // 0.56 源码 findModel.js:查找 actions.find / 替换 editor.action.startFindReplaceAction
  { id: 'actions.find', label: '查找', shortcut: 'Ctrl+F' },
  { id: 'editor.action.startFindReplaceAction', label: '替换', shortcut: 'Ctrl+H' },
  { id: '__sep__4', label: '' },
  { id: 'editor.action.formatDocument', label: '格式化文档', shortcut: 'Shift+Alt+F' },
  { id: '__sep__5', label: '' },
  { id: 'editor.action.quickCommand', label: '命令面板', shortcut: 'Ctrl+Shift+P' },
];

/**
 * 折叠相关菜单项(仅 options.folding 为 true 时注入)。
 * 动作 id 来自 monaco 0.56 folding.js 的 FoldingAction 系列:
 * - 不存在 editor.action.toggleFolding 这个 id,「切换当前光标处折叠」
 *   的正确 id 是 editor.toggleFold(Ctrl+K Ctrl+L)
 * - 所有折叠动作都带 CONTEXT_FOLDING_ENABLED 前置条件,折叠关闭时不生效
 */
const FOLDING_MENU_DEFS: Omit<MenuEntry, 'disabled'>[] = [
  { id: '__sep__f1', label: '' },
  { id: 'editor.fold', label: '折叠', shortcut: 'Ctrl+Shift+[' },
  { id: 'editor.unfold', label: '展开', shortcut: 'Ctrl+Shift+]' },
  { id: 'editor.toggleFold', label: '切换折叠', shortcut: 'Ctrl+K Ctrl+L' },
  { id: '__sep__f2', label: '' },
  { id: 'editor.foldAll', label: '全部折叠', shortcut: 'Ctrl+K Ctrl+0' },
  { id: 'editor.unfoldAll', label: '全部展开', shortcut: 'Ctrl+K Ctrl+J' },
];

export function MonacoContextMenu({
  editor,
  readOnly,
  folding = true,
  open,
  position,
  onClose,
  'data-testid': dataTestId,
}: MonacoContextMenuProps): JSX.Element | null {
  // 打开时计算上下文禁用(无需每次渲染重算)
  const entries: MenuEntry[] = useMemo(() => {
    if (!editor) return [];
    const selection = editor.getSelection();
    const hasSelection = selection != null && !selection.isEmpty();
    // 折叠动作前置条件为 CONTEXT_FOLDING_ENABLED(即 options.folding),
    // 折叠关闭时不注入该菜单组,避免无效项。
    const defs = folding ? [...MENU_DEFS, ...FOLDING_MENU_DEFS] : MENU_DEFS;
    return defs.map((def) => {
      if (def.id.startsWith('__sep__')) {
        return { ...def, disabled: false };
      }
      if (def.id === 'editor.action.clipboardCutAction') {
        return { ...def, disabled: readOnly || !hasSelection };
      }
      if (def.id === 'editor.action.clipboardCopyAction') {
        return { ...def, disabled: !hasSelection };
      }
      if (def.id === '__paste__') {
        return { ...def, disabled: readOnly };
      }
      return { ...def, disabled: false };
    });
    // open 依赖是故意的:菜单重新打开时需基于最新选区重算禁用状态
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [editor, open, readOnly, folding]);

  // 浮层容器 ref:点击外部关闭
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc / 滚动 / blur 关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = (): void => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('wheel', onScroll, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('wheel', onScroll, true);
      window.removeEventListener('blur', onClose);
    };
  }, [open, onClose]);

  // 特殊项:粘贴。WebView2 中 editor.trigger 模拟的粘贴不被视为用户手势,
  // execCommand('paste') 被拒绝;改用手动实现:
  // navigator.clipboard.readText() → editor.executeEdits 插入到光标处。
  const handlePaste = useCallback(async (): Promise<void> => {
    onClose();
    if (!editor) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // 剪贴板 API 不可用/无权限时回退到 Monaco 原生 paste 命令
      try {
        editor.trigger('keyboard', 'editor.action.clipboardPasteAction', null);
      } catch {
        /* 忽略 */
      }
      return;
    }
    const model = editor.getModel();
    if (!model) return;
    const sel = editor.getSelection();
    const range = sel ? sel : model.getFullModelRange();
    editor.executeEdits('paste', [{ range, text }]);
    editor.focus();
  }, [editor, onClose]);

  const runAction = useCallback(
    (id: string): void => {
      if (id === '__paste__') {
        void handlePaste();
        return;
      }
      onClose();
      if (!editor) return;
      // editor.trigger 对 registerCommand 与 registerEditorAction 均有效,
      // 是 Monaco 内置动作最通用的触发方式(source 用 'keyboard' 与快捷键等价)。
      try {
        editor.trigger('keyboard', id, null);
      } catch {
        // 兜底:getAction 路径(仅对 registerEditorAction 有效)
        editor.getAction(id)?.run();
      }
    },
    [editor, onClose, handlePaste],
  );

  if (!open) return null;

  // createPortal 到 document.body:脱离编辑器容器,避免祖先元素
  // transform/filter/backdrop-filter 改变 fixed 包含块导致错位
  return createPortal(
    <div
      ref={menuRef}
      data-testid={dataTestId}
      role="menu"
      aria-orientation="vertical"
      className={cn(
        'fixed z-[60] w-56 rounded-md border border-border bg-popover-layer p-1',
        'text-popover-foreground shadow-md',
      )}
      style={{ left: position.x, top: position.y }}
    >
      {entries.map((entry) => {
        if (entry.id.startsWith('__sep__')) {
          return <div key={entry.id} role="separator" className="-mx-1 my-1 h-px bg-border" />;
        }
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            data-testid={`${dataTestId ?? 'monaco-ctx'}-${entry.id.split('.').pop()}`}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={() => runAction(entry.id)}
            className={cn(
              'flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <span className="flex-1 truncate text-left">{entry.label}</span>
            {entry.shortcut && (
              <kbd className="ml-4 shrink-0 font-mono text-xs tracking-wider opacity-60">
                {entry.shortcut}
              </kbd>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

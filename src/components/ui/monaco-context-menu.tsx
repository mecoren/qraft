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
 *        提供 onToggleWordWrap 时末尾追加「自动换行」开关项(带勾选态),
 *        切换仅作用于当前编辑器实例,由宿主经 props 下发 wordWrap 生效。
 *
 * 已知坑(0.56 源码确认):
 * - 查找/替换的 id 不是 editor.action.find/replace,而是
 *   actions.find / editor.action.startFindReplaceAction
 * - 粘贴命令在 WebView2 中 editor.trigger 不视为用户手势,execCommand('paste')
 *   被拒绝;改为 navigator.clipboard.readText() + editor.executeEdits 手动插入。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { OnMount } from '@monaco-editor/react';

/** Monaco 编辑器实例类型(onMount 回调的入参) */
export type MonacoEditor = Parameters<OnMount>[0];

/** 宿主自定义菜单项(按页面定制右键菜单) */
export interface MonacoMenuAction {
  /** 稳定唯一 id(组内) */
  id: string;
  /** 展示文案 */
  label: string;
  /** 可选快捷键提示(仅展示,不绑定按键) */
  shortcut?: string;
  /** 点击回调(不经过 editor.trigger,由宿主自行处理) */
  onSelect: () => void;
  /** 是否禁用,默认 false */
  disabled?: boolean;
}

/** 宿主自定义菜单分组:每组渲染前插入分隔线 */
export interface MonacoMenuSection {
  id: string;
  items: MonacoMenuAction[];
}

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
  /**
   * 当前是否开启自动换行(用于「自动换行」项的勾选态展示)。
   * 仅在提供 onToggleWordWrap 时生效。
   */
  wordWrapOn?: boolean;
  /**
   * 切换自动换行回调;提供时菜单末尾注入「自动换行」开关项。
   * 缺省时不注入(如 DiffEditor 对比视图等不开放该开关的场景)。
   */
  onToggleWordWrap?: () => void;
  /**
   * 宿主自定义菜单分组(按页面/工具定制):追加在内置项与折叠组之后,
   * 每组前有分隔线;动作为本地回调,不经 editor.trigger。
   */
  sections?: MonacoMenuSection[];
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
  /** Monaco 命令/动作 id(editor.trigger 用);__ 前缀为本地特殊项 */
  id: string;
  label: string;
  shortcut?: string;
  /** 是否禁用(仅上下文禁用:剪切/复制需选区,粘贴只读) */
  disabled: boolean;
  /** 勾选态(仅「自动换行」等开关项使用;定义即渲染勾选列) */
  checked?: boolean;
}

/** 静态菜单项定义:label 为 i18n 键,渲染时经 t() 解析(语言切换即时生效) */
interface MenuDef {
  /** Monaco 命令/动作 id(editor.trigger 用);__ 前缀为本地特殊项 */
  id: string;
  labelKey: string;
  shortcut?: string;
  /** 勾选态(仅「自动换行」等开关项使用) */
  checked?: boolean;
}

/**
 * Monaco 0.56 内置命令/动作 id(来源:node_modules/monaco-editor/esm/vs
 * 中 editorExtensions.js / coreCommands.js / clipboard.js / formatActions.js)。
 * 撤销/重做为裸 id(undo/redo),其余带 editor.action. 前缀。
 */
const MENU_DEFS: MenuDef[] = [
  { id: 'undo', labelKey: 'chrome.editor_menu.undo', shortcut: 'Ctrl+Z' },
  { id: 'redo', labelKey: 'chrome.editor_menu.redo', shortcut: 'Ctrl+Y' },
  { id: '__sep__1', labelKey: '' },
  { id: 'editor.action.clipboardCutAction', labelKey: 'chrome.editor_menu.cut', shortcut: 'Ctrl+X' },
  {
    id: 'editor.action.clipboardCopyAction',
    labelKey: 'chrome.editor_menu.copy',
    shortcut: 'Ctrl+C',
  },
  { id: '__paste__', labelKey: 'chrome.editor_menu.paste', shortcut: 'Ctrl+V' },
  { id: '__sep__2', labelKey: '' },
  { id: 'editor.action.selectAll', labelKey: 'chrome.editor_menu.select_all', shortcut: 'Ctrl+A' },
  { id: '__sep__3', labelKey: '' },
  // 0.56 源码 findModel.js:查找 actions.find / 替换 editor.action.startFindReplaceAction
  { id: 'actions.find', labelKey: 'chrome.editor_menu.find', shortcut: 'Ctrl+F' },
  {
    id: 'editor.action.startFindReplaceAction',
    labelKey: 'chrome.editor_menu.replace',
    shortcut: 'Ctrl+H',
  },
  { id: '__sep__4', labelKey: '' },
  {
    id: 'editor.action.formatDocument',
    labelKey: 'chrome.editor_menu.format_document',
    shortcut: 'Shift+Alt+F',
  },
  { id: '__sep__5', labelKey: '' },
  {
    id: 'editor.action.quickCommand',
    labelKey: 'chrome.editor_menu.command_palette',
    shortcut: 'Ctrl+Shift+P',
  },
];

/**
 * 折叠相关菜单项(仅 options.folding 为 true 时注入)。
 * 动作 id 来自 monaco 0.56 folding.js 的 FoldingAction 系列:
 * - 不存在 editor.action.toggleFolding 这个 id,「切换当前光标处折叠」
 *   的正确 id 是 editor.toggleFold(Ctrl+K Ctrl+L)
 * - 所有折叠动作都带 CONTEXT_FOLDING_ENABLED 前置条件,折叠关闭时不生效
 */
const FOLDING_MENU_DEFS: MenuDef[] = [
  { id: '__sep__f1', labelKey: '' },
  { id: 'editor.fold', labelKey: 'chrome.editor_menu.fold', shortcut: 'Ctrl+Shift+[' },
  { id: 'editor.unfold', labelKey: 'chrome.editor_menu.unfold', shortcut: 'Ctrl+Shift+]' },
  {
    id: 'editor.toggleFold',
    labelKey: 'chrome.editor_menu.toggle_fold',
    shortcut: 'Ctrl+K Ctrl+L',
  },
  { id: '__sep__f2', labelKey: '' },
  { id: 'editor.foldAll', labelKey: 'chrome.editor_menu.fold_all', shortcut: 'Ctrl+K Ctrl+0' },
  {
    id: 'editor.unfoldAll',
    labelKey: 'chrome.editor_menu.unfold_all',
    shortcut: 'Ctrl+K Ctrl+J',
  },
];

export function MonacoContextMenu({
  editor,
  readOnly,
  folding = true,
  wordWrapOn,
  onToggleWordWrap,
  sections,
  open,
  position,
  onClose,
  'data-testid': dataTestId,
}: MonacoContextMenuProps): JSX.Element | null {
  const { t } = useTranslation();
  // 打开时计算上下文禁用(无需每次渲染重算)
  const entries: MenuEntry[] = useMemo(() => {
    if (!editor) return [];
    const selection = editor.getSelection();
    const hasSelection = selection != null && !selection.isEmpty();
    // 折叠动作前置条件为 CONTEXT_FOLDING_ENABLED(即 options.folding),
    // 折叠关闭时不注入该菜单组,避免无效项。
    const baseDefs = folding ? [...MENU_DEFS, ...FOLDING_MENU_DEFS] : MENU_DEFS;
    // 提供切换回调时,追加「自动换行」开关组(仅作用于当前编辑器实例)
    const defs: MenuDef[] = onToggleWordWrap
      ? [
          ...baseDefs,
          { id: '__sep__w', labelKey: '' },
          {
            id: '__toggle_word_wrap__',
            labelKey: 'chrome.editor_menu.word_wrap',
            checked: wordWrapOn ?? false,
          },
        ]
      : baseDefs;
    // 宿主自定义分组:每组前插入分隔线;id 编码为 __custom__<sectionId>:<itemId>
    for (const section of sections ?? []) {
      defs.push({ id: `__sep__custom_${section.id}`, labelKey: '' });
      for (const item of section.items) {
        defs.push({
          id: `__custom__${section.id}:${item.id}`,
          labelKey: item.label,
          shortcut: item.shortcut,
        });
      }
    }
    return defs.map((def) => {
      const label = def.labelKey ? t(def.labelKey) : '';
      const base = { ...def, label };
      if (def.id === 'editor.action.clipboardCutAction') {
        return { ...base, disabled: readOnly || !hasSelection };
      }
      if (def.id === 'editor.action.clipboardCopyAction') {
        return { ...base, disabled: !hasSelection };
      }
      if (def.id === '__paste__') {
        return { ...base, disabled: readOnly };
      }
      if (def.id.startsWith('__custom__')) {
        const actionId = def.id.slice(def.id.indexOf(':') + 1);
        const item = (sections ?? []).flatMap((s) => s.items).find((a) => a.id === actionId);
        return { ...base, disabled: item?.disabled ?? false };
      }
      return { ...base, disabled: false };
    });
    // open 依赖是故意的:菜单重新打开时需基于最新选区重算禁用状态
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [editor, open, readOnly, folding, wordWrapOn, onToggleWordWrap, sections, t]);

  // 浮层容器 ref:点击外部关闭 + 视口边界修正测量
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * 视口边界修正(fixed 定位不会自动避让视口边缘):
   * - 底部放不下 → 整个菜单向上顶(底边对齐光标上方);
   *   向上仍放不下(视口过矮)→ 贴顶夹取并限制高度、内部滚动;
   * - 右侧放不下 → 左移,保证完整可见。
   * useLayoutEffect 在首帧绘制前测量并直接写回样式,无闪跳、无额外渲染。
   */
  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    // 与视口边缘保留的安全间距(px)
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = position.x;
    let y = position.y;
    let maxH: number | undefined;
    if (x + w > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - w - margin);
    }
    if (y + h > window.innerHeight - margin) {
      y = position.y - h;
      if (y < margin) {
        y = margin;
        maxH = window.innerHeight - margin * 2;
      }
    }
    // 每次打开都先复位,再按需写入修正值
    el.style.maxHeight = '';
    el.style.overflowY = '';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (maxH !== undefined) {
      el.style.maxHeight = `${maxH}px`;
      el.style.overflowY = 'auto';
    }
  }, [open, position]);

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
      // 本地开关项:不经过 editor.trigger,直接回调宿主切换状态
      // (wordWrap 由 React props → Monaco updateOptions 生效)
      if (id === '__toggle_word_wrap__') {
        onClose();
        onToggleWordWrap?.();
        return;
      }
      // 宿主自定义项:分发到对应 action 的 onSelect 回调
      if (id.startsWith('__custom__')) {
        const actionId = id.slice(id.indexOf(':') + 1);
        onClose();
        (sections ?? [])
          .flatMap((s) => s.items)
          .find((a) => a.id === actionId)
          ?.onSelect();
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
    [editor, onClose, handlePaste, onToggleWordWrap, sections],
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
            {entry.checked && (
              <Check
                aria-label={t('chrome.editor_menu.enabled_aria', { label: entry.label })}
                data-testid={`${dataTestId ?? 'monaco-ctx'}-${entry.id.split('.').pop()}-check`}
                className="ml-auto size-3.5 shrink-0 text-primary"
              />
            )}
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

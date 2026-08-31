/**
 * 编辑器状态栏快选弹窗 —— 仿 VSCode Quick Pick(CommandDialog 形态)
 *
 * 与全局搜索 / 语言模式选择器同壳:居中 CommandDialog + 顶部搜索框 +
 * cmdk 列表(↑↓ 键盘导航、Enter 确认、当前项打勾)。筛选由受控 query
 * 自行过滤(shouldFilter={false}),避免 cmdk 对中文 value 匹配不佳。
 *
 * 包含四个弹窗:
 * - GotoLineQuickPick:转到行/列(单输入,支持「行」或「行:列」,Enter 跳转)
 * - IndentQuickPick:选择缩进操作(含宽度二级列表,两级导航)
 * - EncodingQuickPick:选择编码(重新打开/保存动作 + 可搜索编码列表)
 * - EolQuickPick:选择行尾序列(LF / CRLF)
 */
import { useCallback, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { TEXT_ENCODINGS, type TextEncodingOption } from '@/lib/text-encodings';
import { INDENT_WIDTHS } from '@/lib/indentation';

/** 与 EditorLanguagePicker 一致的宽度基准(对齐全局搜索弹窗) */
const PICKER_WIDTH = 'w-[48rem] max-w-[calc(100vw-2rem)]';

/** 行首打勾列(与语言模式选择器同布局:无勾时占位对齐) */
function CheckSlot({ checked }: { checked: boolean }): JSX.Element {
  return checked ? (
    <Check aria-hidden className="size-3.5 shrink-0" />
  ) : (
    <span className="flex size-3.5 shrink-0 items-center justify-center" />
  );
}

/** 快选列表行(满宽平铺、不做内缩圆角,VSCode Quick Pick 样式) */
function PickRow({
  selected,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof CommandItem> & { selected: boolean }): JSX.Element {
  return (
    <CommandItem
      className={cn(
        'rounded-none px-3 py-1.5',
        selected && 'bg-accent font-medium text-accent-foreground',
      )}
      {...props}
    >
      {children}
    </CommandItem>
  );
}

// ============ 转到行/列 ============

/** 解析「行」或「行:列」输入(兼容全角冒号);空输入返回 null,非法返回 invalid */
function parseGoto(
  query: string,
): { line?: number; column?: number } | { invalid: true } | null {
  const normalized = query.trim().replace('：', ':');
  if (!normalized) return null;
  const m = /^(\d*)(?::(\d*))?$/.exec(normalized);
  if (!m || (!m[1] && !m[2])) return { invalid: true };
  return {
    line: m[1] ? Number.parseInt(m[1], 10) : undefined,
    column: m[2] ? Number.parseInt(m[2], 10) : undefined,
  };
}

export interface GotoLineQuickPickProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前光标行列(打开时预填) */
  cursor: { line: number; column: number };
  /** 总行数(范围提示与夹取上限) */
  maxLine: number;
  /** 确认跳转(行列有效性夹取由宿主完成) */
  onJump: (line: number, column?: number) => void;
  'data-testid'?: string;
}

/** 转到行/列弹窗:输入即搜索,Enter(输入框或结果项)确认跳转 */
export function GotoLineQuickPick({
  open,
  onOpenChange,
  cursor,
  maxLine,
  onJump,
  'data-testid': dataTestId,
}: GotoLineQuickPickProps): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // 打开时为空输入(与 VSCode「转到行」一致,光标预填在历史版本已移除);
  // 关闭时重置搜索词,放在 onOpenChange 包装器里(与 EditorLanguagePicker 模式一致)。
  const handleOpenChange = (next: boolean): void => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  const parsed = parseGoto(query);
  const invalid = parsed !== null && 'invalid' in parsed;
  const line = parsed && !('invalid' in parsed) ? parsed.line : undefined;
  const column = parsed && !('invalid' in parsed) ? parsed.column : undefined;

  const apply = (): void => {
    if (parsed === null || invalid) return;
    onJump(line ?? cursor.line, column);
    // 经 handleOpenChange 关闭以重置搜索词(直接调用 props 的 onOpenChange
    // 会绕过重置逻辑,Radix 受控关闭不会触发 onOpenChange)
    handleOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      contentClassName="h-auto w-[36rem] max-w-[calc(100vw-2rem)]"
      hideCloseButton
      shouldFilter={false}
      header={
        <>
          <DialogTitle className="sr-only">{t('chrome.code_editor.goto_title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('chrome.code_editor.goto_aria', { line: cursor.line, column: cursor.column })}
          </DialogDescription>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('chrome.code_editor.quick_pick_goto_placeholder')}
            inputMode="numeric"
            data-testid={dataTestId ? `${dataTestId}-search` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
          />
          {/* 范围提示(仿 VSCode 快速输入下方的灰字):非法输入时给格式纠错提示 */}
          <div
            className="border-b px-3 py-2 text-xs text-muted-foreground"
            data-testid={dataTestId ? `${dataTestId}-hint` : undefined}
          >
            {invalid
              ? t('chrome.code_editor.quick_pick_goto_invalid')
              : t('chrome.code_editor.quick_pick_goto_hint', { max: maxLine })}
          </div>
        </>
      }
    >
      <CommandList>
        {parsed !== null && !invalid ? (
          <PickRow
            value={`goto-${line ?? cursor.line}-${column ?? ''}`}
            data-testid={dataTestId ? `${dataTestId}-apply` : undefined}
            selected
            onSelect={apply}
          >
            <ArrowRight aria-hidden className="size-3.5 shrink-0" />
            <span>
              {column !== undefined
                ? t('chrome.code_editor.quick_pick_goto_item', { line: line ?? 1, column })
                : t('chrome.code_editor.quick_pick_goto_item_line', { line: line ?? 1 })}
            </span>
          </PickRow>
        ) : (
          <CommandEmpty>
            {invalid
              ? t('chrome.code_editor.quick_pick_goto_invalid')
              : t('chrome.code_editor.quick_pick_noop')}
          </CommandEmpty>
        )}
      </CommandList>
    </CommandDialog>
  );
}

// ============ 缩进操作 ============

export interface IndentQuickPickProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前缩进方式(状态栏徽章展示值) */
  insertSpaces: boolean;
  tabSize: number;
  /** 应用缩进方式 / 宽度(子集,由宿主落到 Monaco model) */
  onApply: (style: { insertSpaces?: boolean; tabSize?: number }) => void;
  /** 从内容检测缩进方式(宿主执行检测、应用并提示) */
  onDetect: () => void;
  /** 缩进互转(宿主转换全文前导空白并写回) */
  onConvert: (to: 'spaces' | 'tabs') => void;
  /** 裁剪尾随空格(宿主处理后写回) */
  onTrim: () => void;
  'data-testid'?: string;
}

type IndentView = 'root' | 'spaces-width' | 'display-size';

/** 缩进操作弹窗:根列表 + 两个二级宽度列表(仿 VSCode 两级导航) */
export function IndentQuickPick({
  open,
  onOpenChange,
  insertSpaces,
  tabSize,
  onApply,
  onDetect,
  onConvert,
  onTrim,
  'data-testid': dataTestId,
}: IndentQuickPickProps): JSX.Element {
  const { t } = useTranslation();
  const [view, setView] = useState<IndentView>('root');
  const [query, setQuery] = useState('');

  // 关闭时重置层级与搜索词,下次打开回到根列表(重置放在 onOpenChange 包装器)
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) {
        setView('root');
        setQuery('');
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // 选择项关闭统一走 handleOpenChange,确保关闭时重置层级与搜索词
  const close = useCallback((): void => handleOpenChange(false), [handleOpenChange]);

  /** 根列表动作项(id / i18n 键 / 英文关键词 / 行尾右侧提示) */
  const rootActions = useMemo(
    () => [
      {
        id: 'use-spaces',
        labelKey: 'chrome.code_editor.indent_pick_use_spaces',
        keywords: 'indent using spaces',
        expand: 'spaces-width' as const,
        checked: insertSpaces,
        right: t('chrome.code_editor.indent_pick_current_spaces', { size: tabSize }),
      },
      {
        id: 'use-tabs',
        labelKey: 'chrome.code_editor.indent_pick_use_tabs',
        keywords: 'indent using tabs',
        action: () => {
          onApply({ insertSpaces: false });
          close();
        },
        checked: !insertSpaces,
        right: t('chrome.code_editor.indent_pick_current_tabs'),
      },
      {
        id: 'display-size',
        labelKey: 'chrome.code_editor.indent_pick_display_size',
        keywords: 'change tab display size',
        expand: 'display-size' as const,
        checked: false,
        right: String(tabSize),
      },
      {
        id: 'detect',
        labelKey: 'chrome.code_editor.indent_pick_detect',
        keywords: 'detect indentation from content',
        action: () => {
          onDetect();
          close();
        },
        checked: false,
      },
      {
        id: 'to-spaces',
        labelKey: 'chrome.code_editor.indent_pick_convert_spaces',
        keywords: 'convert indentation to spaces',
        action: () => {
          onConvert('spaces');
          close();
        },
        checked: false,
      },
      {
        id: 'to-tabs',
        labelKey: 'chrome.code_editor.indent_pick_convert_tabs',
        keywords: 'convert indentation to tabs',
        action: () => {
          onConvert('tabs');
          close();
        },
        checked: false,
      },
      {
        id: 'trim',
        labelKey: 'chrome.code_editor.indent_pick_trim',
        keywords: 'trim trailing whitespace',
        action: () => {
          onTrim();
          close();
        },
        checked: false,
      },
    ],
    [insertSpaces, tabSize, onApply, onDetect, onConvert, onTrim, t, close],
  );

  const q = query.trim().toLowerCase();

  /** 二级宽度列表(label 用 t 包一层避免 hook 依赖膨胀) */
  const widthLabel = (w: number): string => t('chrome.code_editor.indent_pick_width', { size: w });
  const filteredWidths = INDENT_WIDTHS.filter((w) => widthLabel(w).toLowerCase().includes(q));
  const filteredRoots = rootActions.filter(
    (a) => q === '' || t(a.labelKey).toLowerCase().includes(q) || a.keywords.includes(q),
  );
  const placeholder =
    view === 'root'
      ? t('chrome.code_editor.quick_pick_placeholder')
      : t(
          view === 'spaces-width'
            ? 'chrome.code_editor.indent_pick_use_spaces'
            : 'chrome.code_editor.indent_pick_display_size',
        );

  const backRow = (
    <PickRow
      key="back"
      value="back"
      selected={false}
      data-testid={dataTestId ? `${dataTestId}-back` : undefined}
      onSelect={() => {
        setView('root');
        setQuery('');
      }}
    >
      <ArrowLeft aria-hidden className="size-3.5 shrink-0" />
      <span>{t('chrome.code_editor.quick_pick_back')}</span>
    </PickRow>
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      contentClassName={PICKER_WIDTH}
      hideCloseButton
      shouldFilter={false}
      header={
        <>
          <DialogTitle className="sr-only">
            {t('chrome.code_editor.indent_pick_title')}
          </DialogTitle>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            data-testid={dataTestId ? `${dataTestId}-search` : undefined}
          />
        </>
      }
    >
      <CommandList data-testid={dataTestId ? `${dataTestId}-list` : undefined}>
        {view !== 'root' ? (
          <>
            {q === '' && backRow}
            {filteredWidths.map((w) => {
              const selected =
                view === 'spaces-width' ? insertSpaces && tabSize === w : tabSize === w;
              return (
                <PickRow
                  key={w}
                  value={`width-${w}`}
                  selected={selected}
                  data-testid={dataTestId ? `${dataTestId}-width-${w}` : undefined}
                  onSelect={() => {
                    onApply(
                      view === 'spaces-width'
                        ? { insertSpaces: true, tabSize: w }
                        : { tabSize: w },
                    );
                    close();
                  }}
                >
                  <CheckSlot checked={selected} />
                  <span>{widthLabel(w)}</span>
                </PickRow>
              );
            })}
          </>
        ) : (
          filteredRoots.map((a) => (
              <PickRow
                key={a.id}
                value={`indent-${a.id}`}
                selected={false}
                data-testid={dataTestId ? `${dataTestId}-${a.id}` : undefined}
                onSelect={() => {
                  if (a.expand) {
                    setView(a.expand);
                    setQuery('');
                    return;
                  }
                  a.action?.();
                }}
              >
                <CheckSlot checked={a.checked} />
                <span className="truncate">{t(a.labelKey)}</span>
                {a.right && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {a.right}
                  </span>
                )}
                {a.expand && (
                  <ArrowRight aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                )}
              </PickRow>
            ))
        )}
        {view === 'root' && filteredRoots.length === 0 && (
          <CommandEmpty>{t('chrome.code_editor.quick_pick_no_match')}</CommandEmpty>
        )}
      </CommandList>
    </CommandDialog>
  );
}

// ============ 文件编码 ============

export interface EncodingQuickPickProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前编码标识 */
  currentEncoding: string;
  /** 直接切换编码(保存时按该编码写回) */
  onEncodingChange: (encodingId: string) => void;
  /** 通过编码重新打开(需磁盘文件);未提供或不可用时动作项禁用 */
  onEncodingReopen?: (encodingId: string) => void;
  /** 通过编码保存(设置编码并立即写盘) */
  onEncodingSave?: (encodingId: string) => void;
  /** 「重新打开」是否可用(典型:当前 Tab 是否有磁盘路径),缺省 false */
  reopenAvailable?: boolean;
  'data-testid'?: string;
}

type EncodingView = 'root' | 'reopen-list' | 'save-list';

/** 编码展示名(labelKey 优先翻译,与状态栏徽章同口径) */
function encodingDisplay(opt: TextEncodingOption, t: (k: string) => string): string {
  return opt.labelKey ? t(opt.labelKey) : opt.label;
}

/** 选择编码弹窗:动作项(重新打开/保存)+ 可搜索编码列表,二级列表选定编码 */
export function EncodingQuickPick({
  open,
  onOpenChange,
  currentEncoding,
  onEncodingChange,
  onEncodingReopen,
  onEncodingSave,
  reopenAvailable = false,
  'data-testid': dataTestId,
}: EncodingQuickPickProps): JSX.Element {
  const { t } = useTranslation();
  const [view, setView] = useState<EncodingView>('root');
  const [query, setQuery] = useState('');

  // 关闭时重置层级与搜索词(重置放在 onOpenChange 包装器)
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) {
        setView('root');
        setQuery('');
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // 选择项关闭统一走 handleOpenChange,确保关闭时重置层级与搜索词
  const close = useCallback((): void => handleOpenChange(false), [handleOpenChange]);
  const q = query.trim().toLowerCase();

  const filteredEncodings = TEXT_ENCODINGS.filter((opt) => {
    if (q === '') return true;
    return (
      opt.id.toLowerCase().includes(q) ||
      encodingDisplay(opt, t).toLowerCase().includes(q) ||
      (opt.label ?? '').toLowerCase().includes(q)
    );
  });

  const placeholder =
    view === 'root'
      ? t('chrome.code_editor.encoding_pick_placeholder')
      : t(
          view === 'reopen-list'
            ? 'chrome.code_editor.encoding_pick_reopen'
            : 'chrome.code_editor.encoding_pick_save',
        );

  const backRow = (
    <PickRow
      key="back"
      value="back"
      selected={false}
      data-testid={dataTestId ? `${dataTestId}-back` : undefined}
      onSelect={() => {
        setView('root');
        setQuery('');
      }}
    >
      <ArrowLeft aria-hidden className="size-3.5 shrink-0" />
      <span>{t('chrome.code_editor.quick_pick_back')}</span>
    </PickRow>
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      contentClassName={PICKER_WIDTH}
      hideCloseButton
      shouldFilter={false}
      header={
        <>
          <DialogTitle className="sr-only">
            {t('chrome.code_editor.encoding_pick_title')}
          </DialogTitle>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            data-testid={dataTestId ? `${dataTestId}-search` : undefined}
          />
        </>
      }
    >
      <CommandList data-testid={dataTestId ? `${dataTestId}-list` : undefined}>
        {view !== 'root' ? (
          <>
            {q === '' && backRow}
            {filteredEncodings.map((opt) => {
              const selected = opt.id === currentEncoding;
              return (
                <PickRow
                  key={opt.id}
                  value={`encoding-${opt.id}`}
                  selected={selected}
                  data-testid={dataTestId ? `${dataTestId}-encoding-${opt.id}` : undefined}
                  onSelect={() => {
                    if (view === 'reopen-list') onEncodingReopen?.(opt.id);
                    else onEncodingSave?.(opt.id);
                    close();
                  }}
                >
                  <CheckSlot checked={selected} />
                  <span className="truncate">{encodingDisplay(opt, t)}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {opt.id}
                  </span>
                </PickRow>
              );
            })}
            {filteredEncodings.length === 0 && (
              <CommandEmpty>{t('chrome.code_editor.quick_pick_no_match')}</CommandEmpty>
            )}
          </>
        ) : (
          <>
            {/* 动作区:仅在未输入筛选词时展示(输入即进入编码过滤,与 VSCode 一致);
             * 动作项仅在宿主提供对应回调时渲染,避免对无该能力的宿主展示误导性入口 */}
            {q === '' && (onEncodingReopen || onEncodingSave) && (
              <CommandGroup heading={t('chrome.code_editor.encoding_pick_group_actions')}>
                {onEncodingReopen && (
                  <PickRow
                    value="action-reopen"
                    selected={false}
                    disabled={!reopenAvailable}
                    data-testid={dataTestId ? `${dataTestId}-reopen` : undefined}
                    onSelect={() => {
                      if (!reopenAvailable) return;
                      setView('reopen-list');
                      setQuery('');
                    }}
                  >
                    <ArrowRight aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {t('chrome.code_editor.encoding_pick_reopen')}
                    </span>
                    {!reopenAvailable && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {t('chrome.code_editor.encoding_pick_reopen_unavailable')}
                      </span>
                    )}
                  </PickRow>
                )}
                {onEncodingSave && (
                  <PickRow
                    value="action-save"
                    selected={false}
                    data-testid={dataTestId ? `${dataTestId}-save` : undefined}
                    onSelect={() => {
                      setView('save-list');
                      setQuery('');
                    }}
                  >
                    <ArrowRight aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {t('chrome.code_editor.encoding_pick_save')}
                    </span>
                  </PickRow>
                )}
              </CommandGroup>
            )}
            <CommandGroup heading={t('chrome.code_editor.encoding_pick_group_list')}>
              {filteredEncodings.map((opt) => {
                const selected = opt.id === currentEncoding;
                return (
                  <PickRow
                    key={opt.id}
                    value={`encoding-${opt.id}`}
                    selected={selected}
                    data-testid={dataTestId ? `${dataTestId}-encoding-${opt.id}` : undefined}
                    onSelect={() => {
                      onEncodingChange(opt.id);
                      close();
                    }}
                  >
                    <CheckSlot checked={selected} />
                    <span className="truncate">{encodingDisplay(opt, t)}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {opt.id}
                    </span>
                  </PickRow>
                );
              })}
              {filteredEncodings.length === 0 && (
                <CommandEmpty>{t('chrome.code_editor.quick_pick_no_match')}</CommandEmpty>
              )}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

// ============ 行尾序列 ============

export interface EolQuickPickProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前行尾序列 */
  currentEol: 'LF' | 'CRLF';
  /** 选择目标行尾序列(内容转换由宿主完成) */
  onSelect: (eol: 'LF' | 'CRLF') => void;
  'data-testid'?: string;
}

/** 选择行尾序列弹窗:LF / CRLF 可搜索列表,当前项打勾 */
export function EolQuickPick({
  open,
  onOpenChange,
  currentEol,
  onSelect,
  'data-testid': dataTestId,
}: EolQuickPickProps): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // 关闭时重置搜索词(重置放在 onOpenChange 包装器)
  const handleOpenChange = (next: boolean): void => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  const q = query.trim().toLowerCase();
  const options = [
    {
      id: 'LF' as const,
      descKey: 'chrome.code_editor.eol_lf_desc',
      keywords: 'lf line feed',
    },
    {
      id: 'CRLF' as const,
      descKey: 'chrome.code_editor.eol_crlf_desc',
      keywords: 'crlf carriage return line feed windows',
    },
  ].filter(
    (o) =>
      q === '' ||
      o.id.toLowerCase().includes(q) ||
      t(o.descKey).toLowerCase().includes(q) ||
      o.keywords.includes(q),
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      contentClassName={PICKER_WIDTH}
      hideCloseButton
      shouldFilter={false}
      header={
        <>
          <DialogTitle className="sr-only">
            {t('chrome.code_editor.eol_pick_title')}
          </DialogTitle>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('chrome.code_editor.eol_pick_title')}
            data-testid={dataTestId ? `${dataTestId}-search` : undefined}
          />
        </>
      }
    >
      <CommandList data-testid={dataTestId ? `${dataTestId}-list` : undefined}>
        {options.map((o) => {
          const selected = o.id === currentEol;
          return (
            <PickRow
              key={o.id}
              value={`eol-${o.id}`}
              selected={selected}
              data-testid={dataTestId ? `${dataTestId}-eol-${o.id}` : undefined}
              onSelect={() => {
                onSelect(o.id);
                // 经 handleOpenChange 关闭以重置搜索词
                handleOpenChange(false);
              }}
            >
              <CheckSlot checked={selected} />
              <span>{o.id}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {t(o.descKey)}
              </span>
            </PickRow>
          );
        })}
        {options.length === 0 && (
          <CommandEmpty>{t('chrome.code_editor.quick_pick_no_match')}</CommandEmpty>
        )}
      </CommandList>
    </CommandDialog>
  );
}

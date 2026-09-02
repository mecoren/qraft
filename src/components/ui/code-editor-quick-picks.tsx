/**
 * 编辑器状态栏快选弹窗 —— 仿 VSCode Quick Pick(复用一体化 QuickPickDialog)
 *
 * 与全局搜索 / 语言模式选择器同壳:顶部搜索框固定 + 中间数据驱动列表 +
 * 底部操作提示条(全 kbd 键帽样式);高度随内容伸缩。
 *
 * 包含四个弹窗:
 * - GotoLineQuickPick:转到行/列(单输入,支持「行」或「行:列」,Enter 跳转)
 * - IndentQuickPick:选择缩进操作(含宽度二级列表,两级导航)
 * - EncodingQuickPick:选择编码(重新打开/保存动作 + 可搜索编码列表)
 * - EolQuickPick:选择行尾序列(LF / CRLF)
 */
import { useCallback, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { QuickPickDialog, type QuickPickItem } from '@/components/ui/command';
import { TEXT_ENCODINGS, type TextEncodingOption } from '@/lib/text-encodings';
import { INDENT_WIDTHS } from '@/lib/indentation';

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

  // 关闭时重置搜索词(重置放在 onOpenChange 包装器)
  const handleOpenChange = (next: boolean): void => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  const parsed = parseGoto(query);
  const invalid = parsed !== null && 'invalid' in parsed;
  const line = parsed && !('invalid' in parsed) ? parsed.line : undefined;
  const column = parsed && !('invalid' in parsed) ? parsed.column : undefined;
  const valid = parsed !== null && !invalid;

  const apply = (): void => {
    if (parsed === null || invalid) return;
    onJump(line ?? cursor.line, column);
    handleOpenChange(false);
  };

  const items: QuickPickItem[] = valid
    ? [
        {
          key: 'goto',
          value: `goto-${line ?? cursor.line}-${column ?? ''}`,
          leading: <ArrowRight aria-hidden className="size-3.5 shrink-0" />,
          label:
            column !== undefined
              ? t('chrome.code_editor.quick_pick_goto_item', { line: line ?? 1, column })
              : t('chrome.code_editor.quick_pick_goto_item_line', { line: line ?? 1 }),
          selected: true,
          onSelect: apply,
          testId: dataTestId ? `${dataTestId}-apply` : undefined,
        },
      ]
    : [];

  const hintText = invalid
    ? t('chrome.code_editor.quick_pick_goto_invalid')
    : t('chrome.code_editor.quick_pick_goto_hint', { max: maxLine });

  return (
    <QuickPickDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('chrome.code_editor.goto_title')}
      description={t('chrome.code_editor.goto_aria', { line: cursor.line, column: cursor.column })}
      placeholder={t('chrome.code_editor.quick_pick_goto_placeholder')}
      value={query}
      onValueChange={setQuery}
      inputProps={{
        inputMode: 'numeric',
        onKeyDown: (e) => {
          if (e.key === 'Enter') apply();
        },
      }}
      hint={<div data-testid={dataTestId ? `${dataTestId}-hint` : undefined}>{hintText}</div>}
      groups={[{ items }]}
      empty={
        invalid ? t('chrome.code_editor.quick_pick_goto_invalid') : t('chrome.code_editor.quick_pick_noop')
      }
      inputTestId={dataTestId ? `${dataTestId}-search` : undefined}
      hideCloseButton
      shouldFilter={false}
    />
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
  const close = useCallback((): void => handleOpenChange(false), [handleOpenChange]);

  const q = query.trim().toLowerCase();
  const widthLabel = (w: number): string => t('chrome.code_editor.indent_pick_width', { size: w });

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

  const placeholder =
    view === 'root'
      ? t('chrome.code_editor.quick_pick_placeholder')
      : t(
          view === 'spaces-width'
            ? 'chrome.code_editor.indent_pick_use_spaces'
            : 'chrome.code_editor.indent_pick_display_size',
        );

  const groups = useMemo(() => {
    if (view === 'root') {
      const rootItems = rootActions
        .filter((a) => q === '' || t(a.labelKey).toLowerCase().includes(q) || a.keywords.includes(q))
        .map(
          (a): QuickPickItem => ({
            key: a.id,
            value: `indent-${a.id}`,
            checkColumn: true,
            selected: a.checked,
            label: t(a.labelKey),
            trailing: (
              <span className="flex items-center gap-1.5">
                {a.right && <span>{a.right}</span>}
                {a.expand && (
                  <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </span>
            ),
            testId: dataTestId ? `${dataTestId}-${a.id}` : undefined,
            onSelect: () => {
              if (a.expand) {
                setView(a.expand);
                setQuery('');
                return;
              }
              a.action?.();
            },
          }),
        );
      return [{ items: rootItems }];
    }
    // 二级宽度列表
    const widthItems: QuickPickItem[] = [];
    if (q === '') {
      widthItems.push({
        key: 'back',
        value: 'back',
        leading: <ArrowLeft aria-hidden className="size-3.5 shrink-0" />,
        label: t('chrome.code_editor.quick_pick_back'),
        testId: dataTestId ? `${dataTestId}-back` : undefined,
        onSelect: () => {
          setView('root');
          setQuery('');
        },
      });
    }
    for (const w of INDENT_WIDTHS) {
      if (!widthLabel(w).toLowerCase().includes(q)) continue;
      const selected = view === 'spaces-width' ? insertSpaces && tabSize === w : tabSize === w;
      widthItems.push({
        key: `width-${w}`,
        value: `width-${w}`,
        checkColumn: true,
        selected,
        label: widthLabel(w),
        testId: dataTestId ? `${dataTestId}-width-${w}` : undefined,
        onSelect: () => {
          onApply(view === 'spaces-width' ? { insertSpaces: true, tabSize: w } : { tabSize: w });
          close();
        },
      });
    }
    return [{ items: widthItems }];
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [view, q, rootActions, insertSpaces, tabSize, dataTestId, t, widthLabel, close]);

  return (
    <QuickPickDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('chrome.code_editor.indent_pick_title')}
      placeholder={placeholder}
      value={query}
      onValueChange={setQuery}
      groups={groups}
      empty={
        view === 'root' ? t('chrome.code_editor.quick_pick_no_match') : undefined
      }
      inputTestId={dataTestId ? `${dataTestId}-search` : undefined}
      listTestId={dataTestId ? `${dataTestId}-list` : undefined}
      hideCloseButton
      shouldFilter={false}
    />
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

  const backItem: QuickPickItem = {
    key: 'back',
    value: 'back',
    leading: <ArrowLeft aria-hidden className="size-3.5 shrink-0" />,
    label: t('chrome.code_editor.quick_pick_back'),
    testId: dataTestId ? `${dataTestId}-back` : undefined,
    onSelect: () => {
      setView('root');
      setQuery('');
    },
  };

  const encodingItems = (mode: 'reopen' | 'save' | 'direct'): QuickPickItem[] =>
    filteredEncodings.map((opt): QuickPickItem => {
      const selected = opt.id === currentEncoding;
      return {
        key: opt.id,
        value: `encoding-${opt.id}`,
        checkColumn: true,
        selected,
        label: encodingDisplay(opt, t),
        trailing: opt.id,
        testId: dataTestId ? `${dataTestId}-encoding-${opt.id}` : undefined,
        onSelect: () => {
          if (mode === 'reopen') onEncodingReopen?.(opt.id);
          else if (mode === 'save') onEncodingSave?.(opt.id);
          else onEncodingChange(opt.id);
          close();
        },
      };
    });

  const groups = useMemo(() => {
    if (view !== 'root') {
      const items = [
        ...(q === '' ? [backItem] : []),
        ...encodingItems(view === 'reopen-list' ? 'reopen' : 'save'),
      ];
      return [{ key: view, items }];
    }
    const result: { key?: string; heading?: string; items: QuickPickItem[] }[] = [];
    // 动作区:仅在未输入筛选词时展示,且宿主提供了对应回调
    if (q === '' && (onEncodingReopen || onEncodingSave)) {
      const actionItems: QuickPickItem[] = [];
      if (onEncodingReopen) {
        actionItems.push({
          key: 'action-reopen',
          value: 'action-reopen',
          leading: <ArrowRight aria-hidden className="size-3.5 shrink-0" />,
          label: t('chrome.code_editor.encoding_pick_reopen'),
          disabled: !reopenAvailable,
          trailing: !reopenAvailable
            ? t('chrome.code_editor.encoding_pick_reopen_unavailable')
            : undefined,
          testId: dataTestId ? `${dataTestId}-reopen` : undefined,
          onSelect: () => {
            if (!reopenAvailable) return;
            setView('reopen-list');
            setQuery('');
          },
        });
      }
      if (onEncodingSave) {
        actionItems.push({
          key: 'action-save',
          value: 'action-save',
          leading: <ArrowRight aria-hidden className="size-3.5 shrink-0" />,
          label: t('chrome.code_editor.encoding_pick_save'),
          testId: dataTestId ? `${dataTestId}-save` : undefined,
          onSelect: () => {
            setView('save-list');
            setQuery('');
          },
        });
      }
      result.push({
        key: 'actions',
        heading: t('chrome.code_editor.encoding_pick_group_actions'),
        items: actionItems,
      });
    }
    result.push({
      key: 'list',
      heading: t('chrome.code_editor.encoding_pick_group_list'),
      items: encodingItems('direct'),
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [view, q, reopenAvailable, onEncodingReopen, onEncodingSave, dataTestId, t, backItem]);

  const hasAny = groups.some((g) => g.items.length > 0);

  return (
    <QuickPickDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('chrome.code_editor.encoding_pick_title')}
      placeholder={placeholder}
      value={query}
      onValueChange={setQuery}
      groups={groups}
      empty={hasAny ? undefined : t('chrome.code_editor.quick_pick_no_match')}
      inputTestId={dataTestId ? `${dataTestId}-search` : undefined}
      listTestId={dataTestId ? `${dataTestId}-list` : undefined}
      hideCloseButton
      shouldFilter={false}
    />
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

  const items: QuickPickItem[] = options.map(
    (o): QuickPickItem => ({
      key: o.id,
      value: `eol-${o.id}`,
      checkColumn: true,
      selected: o.id === currentEol,
      label: o.id,
      trailing: t(o.descKey),
      testId: dataTestId ? `${dataTestId}-eol-${o.id}` : undefined,
      onSelect: () => {
        onSelect(o.id);
        handleOpenChange(false);
      },
    }),
  );

  return (
    <QuickPickDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('chrome.code_editor.eol_pick_title')}
      placeholder={t('chrome.code_editor.eol_pick_title')}
      value={query}
      onValueChange={setQuery}
      groups={[{ items }]}
      empty={t('chrome.code_editor.quick_pick_no_match')}
      inputTestId={dataTestId ? `${dataTestId}-search` : undefined}
      listTestId={dataTestId ? `${dataTestId}-list` : undefined}
      hideCloseButton
      shouldFilter={false}
    />
  );
}
'use client';

import * as React from 'react';
import { type DialogProps } from '@radix-ui/react-dialog';
import { Command as CommandPrimitive } from 'cmdk';
import { Check, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover-layer text-popover-foreground',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

/**
 * QuickPickDialog —— 一体化 Quick Pick 弹窗(以「全局查找」为参考组件)。
 *
 * 结构:顶部搜索框(固定) + 中间结果列表 + 底部操作提示条(固定);
 * 高度随内容伸缩(h-auto),内容超过上限后仅列表内部滚动,搜索框与底部条始终可见。
 * 列表完全数据驱动:消费方传分组(`groups`)与数据项(`QuickPickItem`),
 * 行布局(一行/两行、打勾列、前导图标、右侧尾随信息)由组件统一渲染。
 *
 * 查询两种用法:
 * - 受控:`value` + `onValueChange`(SearchDialog / EditorLanguagePicker / 快选弹窗);
 * - 非受控:不传,由 cmdk 内部管理(CommandPalette)。
 * `shouldFilter`=false 时 cmdk 不做值过滤,由消费方按查询结果组织 `groups`;
 * 此时无任何 items 时渲染 `empty` 空态节点。
 */

/** 列表行数据项:一行/两行由 description 是否传入决定,完全由使用方代码控制 */
export type QuickPickItem = {
  /** React key(必传,保证列表稳定性) */
  key: string;
  /** cmdk 检索值(shouldFilter 时参与过滤) */
  value?: string;
  /** 主文本(第一行,truncate) */
  label: React.ReactNode;
  /** 次行描述(灰字);传入即两行结构 */
  description?: React.ReactNode;
  /** 前导槽(打勾列之后的图标:功能/语言图标、方向箭头、行号) */
  leading?: React.ReactNode;
  /** 右侧尾随信息(右对齐) */
  trailing?: React.ReactNode;
  /** badge=muted 徽标(分组名);hint=灰字(标识符),默认 hint */
  trailingStyle?: 'badge' | 'hint';
  /** 是否渲染行首打勾列(未勾时占位对齐) */
  checkColumn?: boolean;
  /** 当前值:打勾(配合 checkColumn)+ 持久 bg-accent 高亮 */
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** data-testid */
  testId?: string;
  /** 显式可访问名(缺省由内容聚合);文本搜索行用它保留命中行完整可读名 */
  ariaLabel?: string;
  /** 行级微调 */
  className?: string;
};

/** 列表分组(heading 可为自定义节点,如文本搜索的「文件名 + 命中数」) */
export type QuickPickGroup = {
  key?: string;
  heading?: React.ReactNode;
  items: QuickPickItem[];
};

type QuickPickDialogProps = {
  open: boolean;
  /** 缺省时仅由 open 控制器决定开关;受控场景(命令面板)传入以响应 Esc/遮罩 */
  onOpenChange?: (open: boolean) => void;
  /** sr-only DialogTitle(无障碍) */
  title: string;
  /** sr-only DialogDescription(无障碍) */
  description?: string;
  placeholder?: string;
  /** 输入框前导槽(SearchDialog 模式切换按钮组) */
  leading?: React.ReactNode;
  /** 受控查询;不传则 cmdk 内部管理(CommandPalette 用法) */
  value?: string;
  onValueChange?: (v: string) => void;
  /** cmdk 自过滤开关 */
  shouldFilter?: boolean;
  /** 输入框下方灰字提示行(GotoLine 范围提示) */
  hint?: React.ReactNode;
  groups: QuickPickGroup[];
  /** 列表为空时展示(GotoLine / 无匹配空态) */
  empty?: React.ReactNode;
  /** 列表底部附注(SearchDialog「命中过多」提示) */
  listFooter?: React.ReactNode;
  /** footer 右侧计数(不传不渲染) */
  count?: React.ReactNode;
  /** inputMode/onKeyDown/autoFocus 等透传到输入框 */
  inputProps?: Omit<
    React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>,
    'value' | 'onValueChange' | 'placeholder'
  >;
  contentClassName?: string;
  hideCloseButton?: boolean;
  contentTestId?: string;
  inputTestId?: string;
  listTestId?: string;
  footerTestId?: string;
  footerCountTestId?: string;
  /** 追加结果后保持键盘选中位置;未传则结果变化时清除选中 */
  preserveSelectionOnChange?: boolean;
} & Omit<DialogProps, 'onOpenChange'>;

/** 统一行渲染:打勾列(占位对齐) + 前导图标 + 主文本[+次行] + 右侧尾随(ml-auto) */
function QuickPickRow({ item }: { item: QuickPickItem }): React.JSX.Element {
  const { checkColumn, selected, leading, label, description, trailing, trailingStyle } = item;
  return (
    <CommandItem
      className={cn(
        'rounded-none px-3 py-1.5',
        selected && 'bg-accent font-medium text-accent-foreground',
        item.className,
      )}
      value={item.value ?? item.key}
      disabled={item.disabled}
      onSelect={item.onSelect}
      data-testid={item.testId}
      aria-label={item.ariaLabel}
    >
      {checkColumn &&
        (selected ? (
          <Check aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <span className="flex size-3.5 shrink-0 items-center justify-center" />
        ))}
      {leading}
      <div className="min-w-0 flex-1">
        <span className="truncate">{label}</span>
        {description && <div className="truncate text-xs text-muted-foreground">{description}</div>}
      </div>
      {trailing && (
        <span
          className={
            trailingStyle === 'badge'
              ? 'ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground'
              : 'ml-auto shrink-0 text-xs text-muted-foreground'
          }
        >
          {trailing}
        </span>
      )}
    </CommandItem>
  );
}

/** 底部操作提示条:统一 kbd 键帽样式,count 以 ml-auto 右对齐 */
function QuickPickFooter({
  count,
  testId,
  countTestId,
}: {
  count?: React.ReactNode;
  testId?: string;
  countTestId?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      data-testid={testId}
      className="flex shrink-0 items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground"
    >
      <span className="flex items-center gap-1.5">
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↑</kbd>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↓</kbd>
        {t('chrome.command_footer.navigate')}
      </span>
      <span className="flex items-center gap-1.5">
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
        {t('chrome.command_footer.confirm')}
      </span>
      <span className="flex items-center gap-1.5">
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
        {t('chrome.command_footer.close')}
      </span>
      {count != null && (
        <span data-testid={countTestId} className="ml-auto flex shrink-0 items-center gap-1.5">
          {count}
        </span>
      )}
    </div>
  );
}

const QuickPickDialog = ({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  leading,
  value,
  onValueChange,
  shouldFilter,
  hint,
  groups,
  empty,
  listFooter,
  count,
  inputProps,
  contentClassName,
  hideCloseButton,
  contentTestId,
  inputTestId,
  listTestId,
  footerTestId,
  footerCountTestId,
  preserveSelectionOnChange,
  ...props
}: QuickPickDialogProps) => {
  const [selectedValue, setSelectedValue] = React.useState<string | undefined>();
  const hasNavigatedRef = React.useRef(false);
  const queryRef = React.useRef(value);
  const groupsKeyRef = React.useRef('');
  const preserveSelectionRef = React.useRef(preserveSelectionOnChange);
  const noSelectionValue = 'qraft-quick-pick-no-selection';
  const hasItems = groups.some((g) => g.items.length > 0);
  const handleFirstNavigation = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (hasNavigatedRef.current) return;
    event.preventDefault();
    const enabledItems = groups.flatMap((group) => group.items).filter((item) => !item.disabled);
    const item =
      event.key === 'ArrowDown' ? enabledItems[0] : enabledItems[enabledItems.length - 1];
    if (!item) return;
    hasNavigatedRef.current = true;
    setSelectedValue(item.value ?? item.key);
  };
  const groupsKey = groups
    .map((group) => group.items.map((item) => item.value ?? item.key).join())
    .join();
  if (queryRef.current === value && groupsKeyRef.current === groupsKey) {
    preserveSelectionRef.current = preserveSelectionOnChange;
  }
  React.useEffect(() => {
    if (queryRef.current === value && groupsKeyRef.current === groupsKey) return;
    queryRef.current = value;
    groupsKeyRef.current = groupsKey;
    if (!preserveSelectionRef.current) {
      hasNavigatedRef.current = false;
      setSelectedValue(undefined);
    }
  }, [value, groupsKey]);
  const renderGroups = (): React.JSX.Element[] =>
    groups.map((g) => (
      <CommandGroup
        key={g.key ?? (typeof g.heading === 'string' ? g.heading : undefined) ?? ''}
        heading={g.heading}
      >
        {g.items.map((item) => (
          <QuickPickRow key={item.key} item={item} />
        ))}
      </CommandGroup>
    ));

  return (
    <Dialog {...props} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={contentTestId}
        hideCloseButton={hideCloseButton}
        className={cn(
          // 高度固定:垂直居中下顶部恒定,搜索框位置不随结果多少/空态变化;
          // 内容超限或为空时由 CommandList 内部滚动/撑开,底部提示条始终可见
          'flex h-[min(60vh,560px)] flex-col gap-0 overflow-hidden p-0 shadow-lg',
          // 宽度默认对齐「全局搜索」弹窗(单一事实来源);消费方不传即沿用
          contentClassName ?? 'w-[48rem] max-w-[calc(100vw-2rem)]',
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
        <Command
          shouldFilter={shouldFilter}
          value={selectedValue ?? noSelectionValue}
          onValueChange={(nextValue) => {
            if (hasNavigatedRef.current) setSelectedValue(nextValue);
          }}
          onKeyDown={handleFirstNavigation}
          className="flex h-full w-full shrink flex-col overflow-hidden [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-11"
        >
          {/* 顶部搜索区固定不滚;提示行紧随其后 */}
          <div className="shrink-0">
            <CommandInput
              leading={leading}
              placeholder={placeholder}
              value={value}
              onValueChange={onValueChange}
              data-testid={inputTestId}
              {...inputProps}
            />
            {hint && <div className="border-b px-3 py-2 text-xs text-muted-foreground">{hint}</div>}
          </div>
          <CommandList
            data-testid={listTestId}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          >
            {shouldFilter ? (
              <>
                {renderGroups()}
                {empty && <CommandPrimitive.Empty>{empty}</CommandPrimitive.Empty>}
              </>
            ) : hasItems ? (
              renderGroups()
            ) : empty ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">{empty}</div>
            ) : null}
            {listFooter}
          </CommandList>
          <QuickPickFooter count={count} testId={footerTestId} countTestId={footerCountTestId} />
        </Command>
      </DialogContent>
    </Dialog>
  );
};

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
    /** 输入框外层容器的 className 透传 */
    wrapperClassName?: string;
    /** 输入框前导内容(缺省为 Search 图标):SearchDialog 用它嵌入「功能/文本」模式切换 */
    leading?: React.ReactNode;
  }
>(({ className, wrapperClassName, leading, ...props }, ref) => (
  <div className={cn('flex items-center border-b px-3', wrapperClassName)} cmdk-input-wrapper="">
    {leading ?? <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />}
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
));

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden', className)}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
      className,
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 h-px bg-border', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
      className,
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
};
CommandShortcut.displayName = 'CommandShortcut';

export {
  Command,
  QuickPickDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
export type { QuickPickDialogProps };

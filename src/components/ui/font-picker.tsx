/**
 * FontPicker —— 字体族可搜索下拉框(combobox)
 *
 * 基于 Popover + Command(cmdk) 实现，Ant Design Select(showSearch) 行为：
 * - 输入框搜索：自定义 matchFontFamilyOption 模糊匹配(label/value/keywords)
 * - 清空：点击 trigger 上的 × 按钮回退到默认字体
 * - 选项渲染：用字体自身渲染 label + 全 CSS value 副标题(灰字)
 * - loading 态：加载系统字体列表时显示提示
 *
 * 性能(系统字体可达数百上千个):
 * - 渐进渲染:首次只渲染前 INITIAL_VISIBLE_OPTIONS 项,滚动到底部时经
 *   IntersectionObserver 追加 LOAD_STEP 项,避免一次挂载全部选项的
 *   字体匹配/排版开销导致首次打开卡顿
 * - 懒加载:onOpen 回调通知宿主在首次展开时才枚举系统字体,
 *   打开设置面板不再触发 DirectWrite 枚举
 *
 * 与 SettingsPanel 解耦：通过 props 注入 options/value/onChange，可复用于
 * 界面字体 / 代码字体两个场景。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { matchFontFamilyOption, type FontFamilyOption } from '@/lib/fontFamilies';

export interface FontPickerProps {
  /** 当前选中值(字体族 CSS value)；null 表示未选(默认) */
  value: string | null;
  /** 选项列表 */
  options: FontFamilyOption[];
  /** 占位文本(未选时显示在 trigger) */
  placeholder: string;
  /** 选中值变化回调；传入 null 表示清空(回退默认) */
  onChange: (value: string | null) => void;
  /** 是否正在加载系统字体列表 */
  loading?: boolean;
  /** 下拉首次/每次展开时回调(宿主用于懒加载系统字体列表) */
  onOpen?: () => void;
  /** aria-label，用于无障碍 */
  'aria-label'?: string;
}

/** 首屏渲染的选项数(其余随滚动渐进追加) */
const INITIAL_VISIBLE_OPTIONS = 50;
/** 每次触底追加的选项数 */
const LOAD_STEP = 50;

/**
 * 单个字体选项的渲染：双行布局
 * - 主行：label，使用该字体自身渲染(`style.fontFamily = value`)
 * - 副行：value 的完整 CSS 字符串(灰字, font-mono)
 *
 * memo:系统字体可达数百项,搜索输入时避免无变化选项的重渲染
 * (每项都带自定义 fontFamily 内联样式,重排成本高)。
 */
const FontOptionLabel = memo(function FontOptionLabel({
  option,
}: {
  option: FontFamilyOption;
}): JSX.Element {
  // 选项 value 可能是单字体族名(已安装字体)，也可能是完整 fallback 栈(默认项)
  // 对单字体族名加引号渲染；完整栈直接使用
  const previewFamily = option.value.includes(',') ? option.value : `'${option.value}', sans-serif`;
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span style={{ fontFamily: previewFamily }}>{option.label}</span>
      <span className="text-[11px] text-muted-foreground/70 font-mono">{option.value}</span>
    </div>
  );
});

/** 单个选项行:props 稳定(选项对象引用 + 布尔选中态 + 稳定回调)时跳过重渲染 */
const FontOptionItem = memo(function FontOptionItem({
  option,
  isChecked,
  onSelect,
}: {
  option: FontFamilyOption;
  isChecked: boolean;
  onSelect: (value: string) => void;
}): JSX.Element {
  return (
    <CommandItem value={option.value} onSelect={() => onSelect(option.value)} className="gap-2">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {isChecked && <Check className="size-4" />}
      </span>
      <FontOptionLabel option={option} />
    </CommandItem>
  );
});

export function FontPicker({
  value,
  options,
  placeholder,
  onChange,
  loading = false,
  onOpen,
  'aria-label': ariaLabel,
}: FontPickerProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 渐进渲染窗口:首屏 INITIAL_VISIBLE_OPTIONS,触底后按 LOAD_STEP 追加
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_OPTIONS);
  /** 触底哨兵元素(挂在列表末尾) */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // 环境探测:无 IntersectionObserver(jsdom 等)时直接全量渲染,不做渐进
  const [supportsIO] = useState(() => typeof IntersectionObserver !== 'undefined');

  // 当前选中项的 label，用于 trigger 显示；未选则显示 placeholder
  const selectedOption = value
    ? (options.find((opt) => opt.value === value) ??
      // 自定义值(选项列表里没有)：把 value 原样显示
      ({ value, label: value, keywords: [] } satisfies FontFamilyOption))
    : null;

  // 按 query 过滤选项(自定义匹配，禁用 cmdk 默认 shouldFilter)。
  // useMemo:输入搜索词时避免每 keystroke 重建数组;选项对象引用保持稳定,
  // 使下方 memo 的 FontOptionItem 能真正跳过未变化项的重渲染。
  const filteredOptions = useMemo(
    () => (query ? options.filter((opt) => matchFontFamilyOption(query, opt)) : options),
    [options, query],
  );

  // 搜索词变化后重置窗口(新结果集从头浏览):
  // 用「渲染期比较」官方模式重置 state,避免在 effect 同步体内 setState
  const [renderedQuery, setRenderedQuery] = useState(query);
  if (renderedQuery !== query) {
    setRenderedQuery(query);
    setVisibleCount(INITIAL_VISIBLE_OPTIONS);
  }

  // 当前窗口内渲染的选项(渐进追加;无 IO 环境直接全量)
  const shownOptions = useMemo(
    () => filteredOptions.slice(0, supportsIO ? visibleCount : filteredOptions.length),
    [filteredOptions, visibleCount, supportsIO],
  );
  const hasMore = supportsIO && visibleCount < filteredOptions.length;

  // 触底自动追加:哨兵进入视口即扩窗(root=null 对嵌套滚动容器同样成立——
  // 列表内滚动会把哨兵带入视口)。回调属异步事件驱动,非 effect 同步体 setState。
  useEffect(() => {
    if (!open || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + LOAD_STEP, filteredOptions.length));
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, hasMore, filteredOptions.length]);

  const handleSelect = useCallback(
    (selectedValue: string) => {
      // cmdk 的 CommandItem.value 默认是字符串；点击默认项时其 value 即默认栈字符串
      // 选中默认项视为"清空自定义"(传 null)；选中其他项传该字体族名
      const isDefault = options.find((opt) => opt.value === selectedValue)?.isDefault ?? false;
      onChange(isDefault ? null : selectedValue);
      setOpen(false);
      setQuery('');
    },
    [options, onChange],
  );

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation(); // 防止点击 × 触发 trigger 打开 popover
    onChange(null);
  };

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) onOpen?.();
    },
    [onOpen],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-foreground/15 bg-muted/40 px-3 py-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !selectedOption && 'text-muted-foreground',
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
            {(loading || (!options.length && open)) && (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
            <span
              className="truncate"
              style={
                selectedOption
                  ? {
                      fontFamily: selectedOption.value.includes(',')
                        ? selectedOption.value
                        : `'${selectedOption.value}', sans-serif`,
                    }
                  : undefined
              }
            >
              {selectedOption ? selectedOption.label : placeholder}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {selectedOption && (
              <span
                role="button"
                tabIndex={0}
                aria-label={t('chrome.font_picker.clear_aria')}
                className="rounded p-0.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                onClick={handleClear}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange(null);
                  }
                }}
              >
                <X className="size-3.5" />
              </span>
            )}
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        align="start"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            placeholder={t('chrome.font_picker.search')}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {loading || (!options.length && Boolean(onOpen)) ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('chrome.font_picker.loading')}
              </div>
            ) : filteredOptions.length === 0 ? (
              <CommandEmpty>{t('chrome.font_picker.empty')}</CommandEmpty>
            ) : (
              <CommandGroup>
                {shownOptions.map((option) => {
                  // 默认项与"未选(value=null)"状态都视为选中默认项
                  const isChecked = option.isDefault
                    ? value === null || value === option.value
                    : value === option.value;
                  return (
                    <FontOptionItem
                      key={option.value}
                      option={option}
                      isChecked={isChecked}
                      onSelect={handleSelect}
                    />
                  );
                })}
                {/* 渐进渲染哨兵:滚到底部时追加下一批选项 */}
                {hasMore && <div ref={sentinelRef} aria-hidden className="h-px w-full" />}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

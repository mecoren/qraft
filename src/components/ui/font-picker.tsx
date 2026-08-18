/**
 * FontPicker —— 字体族可搜索下拉框(combobox)
 *
 * 基于 Popover + Command(cmdk) 实现，参考 GoNavi 的 Ant Design Select(showSearch) 行为：
 * - 输入框搜索：自定义 matchFontFamilyOption 模糊匹配(label/value/keywords)
 * - 清空：点击 trigger 上的 × 按钮回退到默认字体
 * - 选项渲染：用字体自身渲染 label + 全 CSS value 副标题(灰字)
 * - loading 态：加载系统字体列表时显示提示
 *
 * 与 SettingsPanel 解耦：通过 props 注入 options/value/onChange，可复用于
 * 界面字体 / 代码字体两个场景。
 */

import { useState, type JSX } from 'react';
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
  /** aria-label，用于无障碍 */
  'aria-label'?: string;
}

/**
 * 单个字体选项的渲染：双行布局
 * - 主行：label，使用该字体自身渲染(`style.fontFamily = value`)
 * - 副行：value 的完整 CSS 字符串(灰字, font-mono)
 */
function FontOptionLabel({ option }: { option: FontFamilyOption }): JSX.Element {
  // 选项 value 可能是单字体族名(已安装字体)，也可能是完整 fallback 栈(默认项)
  // 对单字体族名加引号渲染；完整栈直接使用
  const previewFamily = option.value.includes(',') ? option.value : `'${option.value}', sans-serif`;
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span style={{ fontFamily: previewFamily }}>{option.label}</span>
      <span className="text-[11px] text-muted-foreground/70 font-mono">{option.value}</span>
    </div>
  );
}

export function FontPicker({
  value,
  options,
  placeholder,
  onChange,
  loading = false,
  'aria-label': ariaLabel,
}: FontPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // 当前选中项的 label，用于 trigger 显示；未选则显示 placeholder
  const selectedOption = value
    ? (options.find((opt) => opt.value === value) ??
      // 自定义值(选项列表里没有)：把 value 原样显示
      ({ value, label: value, keywords: [] } satisfies FontFamilyOption))
    : null;

  // 按 query 过滤选项(自定义匹配，禁用 cmdk 默认 shouldFilter)
  const filteredOptions = query
    ? options.filter((opt) => matchFontFamilyOption(query, opt))
    : options;

  const handleSelect = (selectedValue: string) => {
    // cmdk 的 CommandItem.value 默认是字符串；点击默认项时其 value 即默认栈字符串
    // 选中默认项视为"清空自定义"(传 null)；选中其他项传该字体族名
    const isDefault = options.find((opt) => opt.value === selectedValue)?.isDefault ?? false;
    onChange(isDefault ? null : selectedValue);
    setOpen(false);
    setQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation(); // 防止点击 × 触发 trigger 打开 popover
    onChange(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !selectedOption && 'text-muted-foreground',
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
            {loading && (
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
                aria-label="清空"
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
          <CommandInput placeholder="搜索字体族…" value={query} onValueChange={setQuery} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                正在读取系统字体列表…
              </div>
            ) : filteredOptions.length === 0 ? (
              <CommandEmpty>未找到匹配的字体族</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredOptions.map((option) => {
                  const isSelected = value === option.value;
                  // 默认项与"未选(value=null)"状态都视为选中默认项
                  const isChecked = option.isDefault
                    ? value === null || value === option.value
                    : isSelected;
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => handleSelect(option.value)}
                      className="gap-2"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isChecked && <Check className="size-4" />}
                      </span>
                      <FontOptionLabel option={option} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

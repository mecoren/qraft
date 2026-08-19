import type { JSX } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
}

/**
 * 选中标记尺寸：随复选框尺寸缩放，shadcn 默认约定为方框的 3/4。
 */
function indicatorSize(box: number): number {
  return Math.round(box * 0.75);
}

export function Checkbox({
  className,
  label,
  id,
  checked,
  ...props
}: CheckboxProps): JSX.Element {
  const inputId = id ?? props.name;
  const box = 16;
  const isChecked = props.defaultChecked ?? checked ?? false;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        id={inputId}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        {...props}
      />
      <label
        htmlFor={inputId}
        style={{ width: box, height: box }}
        className={cn(
          'flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-input bg-background shadow-sm transition-colors',
          'peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
          // 直接基于 props 渲染选中态,避免 peer 依赖失效导致样式不更新
          isChecked &&
            'border-primary bg-primary text-primary-foreground',
        )}
        aria-hidden="true"
      >
        <Check
          style={{ width: indicatorSize(box), height: indicatorSize(box) }}
          className={cn(
            'transition-opacity',
            isChecked ? 'opacity-100' : 'opacity-0',
          )}
          strokeWidth={3}
        />
      </label>
      {label && (
        <label
          htmlFor={inputId}
          className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </label>
      )}
    </div>
  );
}

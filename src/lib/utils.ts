import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 class 名称,先用 clsx 处理条件与数组,再用 tailwind-merge
 * 消解冲突的 Tailwind class(如 px-2 与 px-4 仅保留 px-4)。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

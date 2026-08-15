/**
 * 语言模式选择器 —— 仿 VSCode 右下角「选择语言模式」对话框
 *
 * 点击状态栏语言徽章打开,列出全部支持的语言;当前语言高亮并打勾。
 * 选择后即时应用到激活 Tab,关闭对话框。
 */
import type { JSX } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { EditorLanguage } from '@/components/ui/code-editor';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QUICK_LANGUAGES } from './languageMap';

export interface EditorLanguagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLanguage: EditorLanguage;
  onSelect: (language: EditorLanguage) => void;
  /** 测试定位用 */
  'data-testid'?: string;
}

export function EditorLanguagePicker({
  open,
  onOpenChange,
  currentLanguage,
  onSelect,
  'data-testid': dataTestId,
}: EditorLanguagePickerProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={dataTestId}
        className="max-w-sm gap-0 p-0"
        hideCloseButton
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm font-semibold">选择语言模式</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <div className="flex flex-col p-1.5">
            {QUICK_LANGUAGES.map((lang) => {
            const selected = lang.id === currentLanguage;
            return (
              <button
                key={lang.id}
                type="button"
                data-testid={`${dataTestId}-lang-${lang.id}`}
                onClick={() => onSelect(lang.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'bg-sidebar-primary/15 font-medium text-sidebar-primary'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {selected ? (
                  <Check aria-hidden className="size-4 shrink-0" />
                ) : (
                  <ChevronRight aria-hidden className="size-4 shrink-0 opacity-40" />
                )}
                <span className="truncate">{lang.label}</span>
              </button>
            );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, type JSX } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Settings, Trash2, Search } from 'lucide-react';
import { useToolStateStore } from '@/store/toolStateStore';
import { useHistoryStore } from '@/store/historyStore';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 打开设置面板的回调,由 App 注入 */
  onOpenSettings?: () => void;
  /** 打开历史面板的回调,由 App 注入 */
  onOpenHistory?: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenHistory,
}: CommandPaletteProps): JSX.Element {
  const tools = useToolStateStore((s) => s.availableTools);
  const selectTool = useToolStateStore((s) => s.selectTool);
  const clearHistory = useHistoryStore((s) => s.clearHistory);

  // Esc 关闭由 Dialog 内部 Radix 处理,此处仅作冗余兜底
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const handleSelectTool = (toolId: string) => {
    selectTool(toolId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden max-w-xl">
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">
          搜索工具或操作,回车执行
        </DialogDescription>
        <Command shouldFilter={true}>
          <CommandInput placeholder="搜索工具或操作..." />
          <CommandList className="max-h-80">
            <CommandEmpty>无匹配项</CommandEmpty>
            <CommandGroup heading="工具">
              {tools.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.name} ${t.tags.join(' ')}`}
                  onSelect={() => handleSelectTool(t.id)}
                >
                  <Search aria-hidden className="h-4 w-4 opacity-50" />
                  <span>{t.name}</span>
                  {t.description && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="操作">
              <CommandItem
                value="settings open settings 打开设置"
                onSelect={() => {
                  onOpenSettings?.();
                  onOpenChange(false);
                }}
              >
                <Settings aria-hidden className="h-4 w-4 opacity-50" />
                <span>打开设置</span>
              </CommandItem>
              <CommandItem
                value="history open history 打开历史"
                onSelect={() => {
                  onOpenHistory?.();
                  onOpenChange(false);
                }}
              >
                <Settings aria-hidden className="h-4 w-4 opacity-50" />
                <span>打开历史</span>
              </CommandItem>
              <CommandItem
                value="clear history 清空历史"
                onSelect={async () => {
                  await clearHistory();
                  onOpenChange(false);
                }}
              >
                <Trash2 aria-hidden className="h-4 w-4 opacity-50" />
                <span>清空历史</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

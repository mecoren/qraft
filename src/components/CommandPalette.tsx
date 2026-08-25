import { useEffect, type JSX } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { History, Home, Settings, Trash2 } from 'lucide-react';
import { useHistoryStore } from '@/store/historyStore';
import { useUiStore } from '@/store/uiStore';
import { TOOL_CATALOG } from '@/lib/tool-catalog';

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
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const openTool = useUiStore((s) => s.openTool);
  const goWelcome = useUiStore((s) => s.goWelcome);
  // Smart Detection:剪贴板探测结果(仅在用户开启开关后有内容)
  const detected = useUiStore((s) => s.detectedTools);

  // Esc 关闭由 Dialog 内部 Radix 处理,此处仅作冗余兜底
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">搜索工具或操作,回车执行</DialogDescription>
        <Command shouldFilter={true}>
          <CommandInput placeholder="搜索工具或操作..." />
          <CommandList className="max-h-80">
            <CommandEmpty>无匹配项</CommandEmpty>
            {detected.length > 0 && (
              <CommandGroup heading="检测到剪贴板内容">
                {detected.map((d) => {
                  const entry = TOOL_CATALOG.find((c) => c.id === d.toolId);
                  if (!entry) return null;
                  return (
                    <CommandItem
                      key={`detect-${d.toolId}`}
                      value={`${entry.name} ${entry.keywords.join(' ')} ${d.reason}`}
                      onSelect={() => {
                        openTool(d.toolId);
                        onOpenChange(false);
                      }}
                    >
                      <entry.icon aria-hidden className="h-4 w-4 opacity-50" />
                      <span>{entry.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{d.reason}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandGroup heading="工具">
              {TOOL_CATALOG.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={`${entry.name} ${entry.keywords.join(' ')}`}
                  onSelect={() => {
                    if (entry.special === 'settings') onOpenSettings?.();
                    else if (entry.special === 'extensions')
                      useUiStore.getState().setView('extensions');
                    else openTool(entry.id);
                    onOpenChange(false);
                  }}
                >
                  <entry.icon aria-hidden className="h-4 w-4 opacity-50" />
                  <span>{entry.name}</span>
                  {entry.description && (
                    <span className="ml-2 truncate text-xs text-muted-foreground">
                      {entry.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="操作">
              <CommandItem
                value="home welcome 所有工具 首页"
                onSelect={() => {
                  goWelcome();
                  onOpenChange(false);
                }}
              >
                <Home aria-hidden className="h-4 w-4 opacity-50" />
                <span>返回所有工具</span>
              </CommandItem>
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
                <History aria-hidden className="h-4 w-4 opacity-50" />
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

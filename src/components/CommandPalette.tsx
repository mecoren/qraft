import { useEffect, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ExternalLink, History, Home, Settings, Trash2 } from 'lucide-react';
import { useHistoryStore } from '@/store/historyStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useUiStore } from '@/store/uiStore';
import { isPopoutSupported, openToolInNewWindow } from '@/lib/popout-window';
import { TOOL_CATALOG, pickText } from '@/lib/tool-catalog';

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
  // 当前工具:为空(欢迎页)时隐藏「弹出新窗口」动作
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  const { t } = useTranslation();

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
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="max-w-xl"
      shouldFilter
      header={
        <>
          <DialogTitle className="sr-only">{t('chrome.app.name')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('chrome.palette.description')}
          </DialogDescription>
          <CommandInput placeholder={t('chrome.palette.placeholder')} />
        </>
      }
    >
      <CommandList className="max-h-80">
        <CommandEmpty>{t('chrome.palette.no_match')}</CommandEmpty>
            {detected.length > 0 && (
              <CommandGroup heading={t('chrome.palette.detect_clipboard')}>
                {detected.map((d) => {
                  const entry = TOOL_CATALOG.find((c) => c.id === d.toolId);
                  if (!entry) return null;
                  return (
                    <CommandItem
                      key={`detect-${d.toolId}`}
                      value={`${entry.name.zh} ${entry.name.en} ${entry.keywords.join(' ')} ${d.reason}`}
                      onSelect={() => {
                        openTool(d.toolId);
                        onOpenChange(false);
                      }}
                    >
                      <entry.icon aria-hidden className="h-4 w-4 opacity-50" />
                      <span>{pickText(entry.name)}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{t(d.reason)}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandGroup heading={t('chrome.palette.group_tools')}>
              {TOOL_CATALOG.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={`${entry.name.zh} ${entry.name.en} ${entry.keywords.join(' ')}`}
                  onSelect={() => {
                    if (entry.special === 'settings') onOpenSettings?.();
                    else if (entry.special === 'extensions')
                      useUiStore.getState().setView('extensions');
                    else openTool(entry.id);
                    onOpenChange(false);
                  }}
                >
                  <entry.icon aria-hidden className="h-4 w-4 opacity-50" />
                  <span>{pickText(entry.name)}</span>
                  {entry.description && (
                    <span className="ml-2 truncate text-xs text-muted-foreground">
                      {pickText(entry.description)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading={t('chrome.palette.group_actions')}>
              {currentToolId && isPopoutSupported(currentToolId) && (
                <CommandItem
                  value="popout new window open current tool 在新窗口打开 弹出"
                  onSelect={() => {
                    void openToolInNewWindow(currentToolId);
                    onOpenChange(false);
                  }}
                >
                  <ExternalLink aria-hidden className="h-4 w-4 opacity-50" />
                  <span>{t('chrome.palette.popout_current')}</span>
                </CommandItem>
              )}
              <CommandItem
                value="home welcome 所有工具 首页 all tools home"
                onSelect={() => {
                  goWelcome();
                  onOpenChange(false);
                }}
              >
                <Home aria-hidden className="h-4 w-4 opacity-50" />
                <span>{t('chrome.palette.back_home')}</span>
              </CommandItem>
              <CommandItem
                value="settings open settings 打开设置"
                onSelect={() => {
                  onOpenSettings?.();
                  onOpenChange(false);
                }}
              >
                <Settings aria-hidden className="h-4 w-4 opacity-50" />
                <span>{t('chrome.palette.open_settings')}</span>
              </CommandItem>
              <CommandItem
                value="history open history 打开历史"
                onSelect={() => {
                  onOpenHistory?.();
                  onOpenChange(false);
                }}
              >
                <History aria-hidden className="h-4 w-4 opacity-50" />
                <span>{t('chrome.palette.open_history')}</span>
              </CommandItem>
              <CommandItem
                value="clear history 清空历史 clear"
                onSelect={async () => {
                  await clearHistory();
                  onOpenChange(false);
                }}
              >
                <Trash2 aria-hidden className="h-4 w-4 opacity-50" />
                <span>{t('chrome.palette.clear_history')}</span>
              </CommandItem>
            </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

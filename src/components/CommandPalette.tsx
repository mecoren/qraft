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
import {
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  History,
  Home,
  Settings,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react';
import { useHistoryStore } from '@/store/historyStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useUiStore } from '@/store/uiStore';
import { isPopoutSupported, openToolInNewWindow } from '@/lib/popout-window';
import { CATALOG_CATEGORIES, TOOL_CATALOG, pickText } from '@/lib/tool-catalog';

const PICK_ROW = 'rounded-none px-3 py-1.5';

function ToolRow({
  icon: Icon,
  name,
  description,
  categoryLabel,
}: {
  icon: React.ComponentType<{ 'aria-hidden'?: boolean; className?: string }>;
  name: React.ReactNode;
  description?: React.ReactNode;
  categoryLabel?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-start justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 opacity-70" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{name}</span>
          {description && (
            <span className="truncate text-xs text-muted-foreground">{description}</span>
          )}
        </div>
      </div>
      {categoryLabel && (
        <span className="ml-3 shrink-0 self-center rounded-sm bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
          {categoryLabel}
        </span>
      )}
    </div>
  );
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings?: () => void;
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
  const detected = useUiStore((s) => s.detectedTools);
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const totalCount = TOOL_CATALOG.length;
  const categoryLabelMap = new Map<string, string>();
  for (const cat of CATALOG_CATEGORIES) {
    categoryLabelMap.set(cat.id, pickText(cat.label));
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="w-[48rem] max-w-[calc(100vw-2rem)]"
      hideCloseButton
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
      footer={
        <div
          className="flex shrink-0 items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground"
          data-testid="palette-footer"
        >
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1"
              aria-label={t('chrome.palette.footer_navigate')}
            >
              <ChevronUp aria-hidden className="size-3" />
              <ChevronDown aria-hidden className="size-3" />
              {t('chrome.palette.footer_navigate')}
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={t('chrome.palette.footer_open')}
            >
              <CornerDownLeft aria-hidden className="size-3" />
              {t('chrome.palette.footer_open')}
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={t('chrome.palette.footer_close')}
            >
              <kbd className="rounded border border-border bg-muted px-1 text-[10px] leading-tight">
                Esc
              </kbd>
              {t('chrome.palette.footer_close')}
            </span>
          </div>
          <span data-testid="palette-footer-count">
            {t('chrome.palette.footer_count', { count: totalCount })}
          </span>
        </div>
      }
    >
      <CommandList>
        <CommandEmpty>{t('chrome.palette.no_match')}</CommandEmpty>
        {detected.length > 0 && (
          <CommandGroup heading={t('chrome.palette.detect_clipboard')}>
            {detected.map((d) => {
              const entry = TOOL_CATALOG.find((c) => c.id === d.toolId);
              if (!entry) return null;
              return (
                <CommandItem
                  key={`detect-${d.toolId}`}
                  className={PICK_ROW}
                  value={`${entry.name.zh} ${entry.name.en} ${entry.keywords.join(' ')} ${d.reason}`}
                  onSelect={() => {
                    openTool(d.toolId);
                    onOpenChange(false);
                  }}
                >
                  <ToolRow
                    icon={entry.icon}
                    name={pickText(entry.name)}
                    description={t(d.reason)}
                  />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandGroup heading={t('chrome.palette.group_tools')}>
          {TOOL_CATALOG.map((entry) => (
            <CommandItem
              key={entry.id}
              className={PICK_ROW}
              value={`${entry.name.zh} ${entry.name.en} ${entry.keywords.join(' ')}`}
              onSelect={() => {
                if (entry.special === 'settings') onOpenSettings?.();
                else if (entry.special === 'extensions')
                  useUiStore.getState().setView('extensions');
                else openTool(entry.id);
                onOpenChange(false);
              }}
            >
              <ToolRow
                icon={entry.icon}
                name={pickText(entry.name)}
                description={entry.description ? pickText(entry.description) : undefined}
                categoryLabel={categoryLabelMap.get(entry.category)}
              />
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t('chrome.palette.group_actions')}>
          {currentToolId && isPopoutSupported(currentToolId) && (
            <CommandItem
              className={PICK_ROW}
              value="popout new window open current tool 在新窗口打开 弹出"
              onSelect={() => {
                void openToolInNewWindow(currentToolId);
                onOpenChange(false);
              }}
            >
              <ToolRow icon={SquareArrowOutUpRight} name={t('chrome.palette.popout_current')} />
            </CommandItem>
          )}
          <CommandItem
            className={PICK_ROW}
            value="home welcome 所有工具 首页 all tools home"
            onSelect={() => {
              goWelcome();
              onOpenChange(false);
            }}
          >
            <ToolRow icon={Home} name={t('chrome.palette.back_home')} />
          </CommandItem>
          <CommandItem
            className={PICK_ROW}
            value="settings open settings 打开设置"
            onSelect={() => {
              onOpenSettings?.();
              onOpenChange(false);
            }}
          >
            <ToolRow icon={Settings} name={t('chrome.palette.open_settings')} />
          </CommandItem>
          <CommandItem
            className={PICK_ROW}
            value="history open history 打开历史"
            onSelect={() => {
              onOpenHistory?.();
              onOpenChange(false);
            }}
          >
            <ToolRow icon={History} name={t('chrome.palette.open_history')} />
          </CommandItem>
          <CommandItem
            className={PICK_ROW}
            value="clear history 清空历史 clear"
            onSelect={async () => {
              await clearHistory();
              onOpenChange(false);
            }}
          >
            <ToolRow icon={Trash2} name={t('chrome.palette.clear_history')} />
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

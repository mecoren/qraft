import { useEffect, useState, useCallback, type JSX } from 'react';
import { Toaster, toast } from 'sonner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SideNav } from '@/components/SideNav';
import { CommandPalette } from '@/components/CommandPalette';
import { ToolPanel } from '@/components/ToolPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { useConfigStore } from '@/store/configStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useHistoryStore } from '@/store/historyStore';
import { listen } from '@/lib/ipc';
import type {
  ConfigChangedPayload,
  ToolProgressPayload,
  ToolChunkPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from '@/types/ipc';
import type { HistoryEntry } from '@/types/history';

type View = 'tool' | 'history' | 'settings';

export function App(): JSX.Element {
  const [view, setView] = useState<View>('tool');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const loadConfig = useConfigStore((s) => s.loadConfig);
  const applyConfigChanged = useConfigStore((s) => s.applyConfigChanged);
  const loadTools = useToolStateStore((s) => s.loadTools);
  const currentToolId = useToolStateStore((s) => s.currentToolId);
  const applyToolProgress = useToolStateStore((s) => s.applyToolProgress);
  const applyToolChunk = useToolStateStore((s) => s.applyToolChunk);
  const applyToolCompleted = useToolStateStore((s) => s.applyToolCompleted);
  const applyToolFailed = useToolStateStore((s) => s.applyToolFailed);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const applyHistoryAdded = useHistoryStore((s) => s.applyHistoryAdded);

  // 启动一次性加载
  useEffect(() => {
    void loadConfig();
    void loadTools();
    void loadHistory();
  }, [loadConfig, loadTools, loadHistory]);

  // 订阅全局事件:配置变更、历史新增、流式工具事件
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void (async () => {
      unlisteners.push(
        await listen<ConfigChangedPayload>('config_changed', (p) =>
          applyConfigChanged(p)
        )
      );
      unlisteners.push(
        await listen<HistoryEntry>('history_added', (e) =>
          applyHistoryAdded(e)
        )
      );
      unlisteners.push(
        await listen<ToolProgressPayload>('tool_progress', (p) =>
          applyToolProgress(p)
        )
      );
      unlisteners.push(
        await listen<ToolChunkPayload>('tool_chunk', (p) => applyToolChunk(p))
      );
      unlisteners.push(
        await listen<ToolCompletedPayload>('tool_completed', (p) =>
          applyToolCompleted(p)
        )
      );
      unlisteners.push(
        await listen<ToolFailedPayload>('tool_failed', (p) => {
          applyToolFailed(p);
          toast.error(`工具执行失败: ${p.error.message}`);
        })
      );
    })();
    return () => {
      for (const u of unlisteners) u();
    };
  }, [
    applyConfigChanged,
    applyHistoryAdded,
    applyToolProgress,
    applyToolChunk,
    applyToolCompleted,
    applyToolFailed,
  ]);

  // 全局快捷键:Ctrl+K 打开命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSelectHistory = useCallback((entry: HistoryEntry) => {
    useToolStateStore.getState().selectTool(entry.toolId);
    setView('tool');
  }, []);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden">
        <SideNav />
        <main className="flex-1 min-w-0">
          {view === 'tool' && currentToolId && (
            <ToolPanel toolId={currentToolId} />
          )}
          {view === 'tool' && !currentToolId && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              请从侧边栏选择工具,或按 Ctrl+K 打开命令面板
            </div>
          )}
          {view === 'history' && (
            <HistoryPanel onSelect={handleSelectHistory} />
          )}
          {view === 'settings' && <SettingsPanel />}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSettings={() => setView('settings')}
        onOpenHistory={() => setView('history')}
      />

      <Toaster richColors position="bottom-right" />
    </ErrorBoundary>
  );
}

export default App;

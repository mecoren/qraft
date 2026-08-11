import { useEffect, useState, type JSX } from 'react';
import { Toaster, toast } from 'sonner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Sidebar } from '@/components/layout/Sidebar';
import { Titlebar } from '@/components/layout/Titlebar';
import { CommandPalette } from '@/components/CommandPalette';
import { ToolPanel } from '@/components/ToolPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { SettingsDialog } from '@/components/SettingsDialog';
import { WelcomePage } from '@/pages/WelcomePage';
import { ExtensionsPage } from '@/pages/ExtensionsPage';
import { useConfigStore } from '@/store/configStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useHistoryStore } from '@/store/historyStore';
import { useUiStore } from '@/store/uiStore';
import { useShortcut } from '@/hooks/useShortcut';
import { listen } from '@/lib/ipc';
import { cn } from '@/lib/utils';

import type {
  ConfigChangedPayload,
  ToolProgressPayload,
  ToolChunkPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from '@/types/ipc';
import type { HistoryEntry } from '@/types/history';

export function App(): JSX.Element {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
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
        await listen<ConfigChangedPayload>('config_changed', (p) => applyConfigChanged(p)),
      );
      unlisteners.push(await listen<HistoryEntry>('history_added', (e) => applyHistoryAdded(e)));
      unlisteners.push(
        await listen<ToolProgressPayload>('tool_progress', (p) => applyToolProgress(p)),
      );
      unlisteners.push(await listen<ToolChunkPayload>('tool_chunk', (p) => applyToolChunk(p)));
      unlisteners.push(
        await listen<ToolCompletedPayload>('tool_completed', (p) => applyToolCompleted(p)),
      );
      unlisteners.push(
        await listen<ToolFailedPayload>('tool_failed', (p) => {
          applyToolFailed(p);
          toast.error(`工具执行失败: ${p.error.message}`);
        }),
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

  // —— 全局快捷键(导航类) ——
  // 工具操作类快捷键(execute_tool/clear_input/copy_output/search)需工具组件
  // 契约改造,标注 TODO(v1.1) 延后实现。
  useShortcut('open_command_palette', () => setPaletteOpen((v) => !v), []);
  useShortcut('toggle_sidebar', () => useUiStore.getState().toggleSidebar(), []);
  useShortcut('toggle_settings', () => setView('settings'), [setView]);
  useShortcut('switch_tool', () => setPaletteOpen(true), []);
  useShortcut('open_history', () => setView('history'), [setView]);
  // Esc 关闭当前打开的面板:命令面板 > 设置弹窗 > 历史/扩展页 > 回到工具/欢迎页
  useShortcut('close_panel', () => {
    if (paletteOpen) {
      setPaletteOpen(false);
    } else if (view === 'settings') {
      setView(currentToolId ? 'tool' : 'welcome');
    } else if (view === 'history' || view === 'extensions') {
      setView(currentToolId ? 'tool' : 'welcome');
    }
  }, [paletteOpen, view, currentToolId, setView]);

  const handleSelectHistory = (entry: HistoryEntry) => {
    useUiStore.getState().openTool(entry.toolId);
  };

  return (
    <ErrorBoundary>
      {/* 顶层:flex-col 让 Titlebar 固定顶部,下方为侧栏 + 主区水平布局
       * h-screen 撑满视口;overflow-hidden 防止 Mica 透明时溢出滚动 */}
      <div className="flex h-screen w-screen flex-col overflow-hidden">
        <Titlebar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 bg-background-layer">
            {/* settings 以弹窗形式悬浮展示,底层仍显示当前页。
             * 各页面常驻挂载,用 display:none 切换显隐:组件不卸载,DOM 与本地 state 保留,
             * 因此切换页面再回来时,工具输入/输出数据与滚动位置均不丢失。
             * 欢迎页激活条件:view=welcome,或 tool 视图下尚未选中工具 */}
            <div
              className={cn('h-full', !(view === 'welcome' || (view === 'tool' && !currentToolId)) && 'hidden')}
            >
              <WelcomePage />
            </div>
            <div className={cn('h-full', !(view === 'tool' && currentToolId) && 'hidden')}>
              <ToolPanel toolId={currentToolId ?? ''} />
            </div>
            <div className={cn('h-full', view !== 'extensions' && 'hidden')}>
              <ExtensionsPage />
            </div>
            <div className={cn('h-full', view !== 'history' && 'hidden')}>
              <HistoryPanel onSelect={handleSelectHistory} />
            </div>
          </main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSettings={() => setView('settings')}
        onOpenHistory={() => setView('history')}
      />

      {/* key 让每次打开时弹窗重挂载,initialRect() 重新按当前视口尺寸居中
       * 避免小屏→大屏窗口变化后,弹窗停留在原位置(被 resize clamp 在边缘)造成不居中 */}
      <SettingsDialog
        key={String(view === 'settings')}
        open={view === 'settings'}
        onOpenChange={(open) => {
          if (!open) setView(currentToolId ? 'tool' : 'welcome');
        }}
      />

      <Toaster richColors position="bottom-right" />
    </ErrorBoundary>
  );
}

export default App;

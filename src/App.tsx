import { useEffect, useState, type JSX } from 'react';
import { toast, Toaster } from 'sonner';
import { I18nextProvider } from 'react-i18next';
import { getI18nInstance, t as translate } from '@/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Sidebar } from '@/components/layout/Sidebar';
import { Titlebar } from '@/components/layout/Titlebar';
import { CommandPalette } from '@/components/CommandPalette';
import { SearchDialog } from '@/components/SearchDialog';
import { ToolPanel } from '@/components/ToolPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { SettingsDialog } from '@/components/SettingsDialog';
import { AboutDialog } from '@/components/AboutDialog';
import { WelcomePage } from '@/pages/WelcomePage';
import { ExtensionsPage } from '@/pages/ExtensionsPage';
import { useConfigStore } from '@/store/configStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useHistoryStore, type BackendHistoryEntry } from '@/store/historyStore';
import { useUiStore } from '@/store/uiStore';
import { useShortcut } from '@/hooks/useShortcut';
import { useSearchJump } from '@/hooks/useSearchJump';
import { clearInputAction, copyOutputAction, executeToolAction } from '@/lib/tool-actions';
import { readClipboardText } from '@/lib/clipboard';
import { detectClipboardTools } from '@/lib/clipboard-detect';
import { listen } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import {
  forceOpenFile,
  pullPendingOpenFiles,
  type OpenFileEventPayload,
  type OpenFileUnsupportedPayload,
} from '@/tools/code-editor-workspace/fileOps';
import { fileNameFromPath } from '@/tools/code-editor-workspace/languageMap';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { getPopoutToolIdFromLabel, rehydrateToolStateFromPopout } from '@/lib/popout-sync';
import {
  cycleNamingCaseShortcutHandler,
  toggleCaseShortcutHandler,
} from '@/tools/code-editor-workspace/namingCaseCommand';
import { DEFAULT_TOOL_ID } from '@/lib/tool-catalog';

import type {
  ConfigChangedPayload,
  ToolProgressPayload,
  ToolChunkPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from '@/types/ipc';
import type { HistoryEntry } from '@/types/history';

/**
 * 在代码编辑器工作区中打开一个本地文件:先切到编辑器工具,再打开文件 Tab。
 *
 * 这里的调用一律来自系统侧(文件关联双击 / 命令行参数 / 「用 Qraft 打开」),
 * 因此必须走 `openLocalFileFromSystem`:该入口不置位 `userTouched`,
 * 让随后挂载的编辑器 hydrate 把上次的 Tab 列表合并回来而不是整体丢弃。
 * `encoding` 为 Rust 端探测到的编码标识,打开 Tab 时一并记录(状态栏展示)。
 */
function openFileInEditor(path: string, content: string, encoding?: string): void {
  useUiStore.getState().openTool(DEFAULT_TOOL_ID);
  useEditorWorkspaceStore.getState().openLocalFileFromSystem(path, content, encoding);
}

/**
 * 以大文件只读模式在编辑器工作区打开本地文件(超过整读上限的文件):
 * 切到编辑器工具后创建 largeFile Tab;行索引扫描由 EditorWorkbench 的
 * useLargeFileScan 在 Tab 激活时触发。同样不置位 userTouched(hydrate 合并)。
 */
function openLargeFileInEditor(path: string): void {
  useUiStore.getState().openTool(DEFAULT_TOOL_ID);
  useEditorWorkspaceStore.getState().openLargeFileFromSystem(path);
}

export function App(): JSX.Element {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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

  // 订阅全局事件:配置变更、历史新增、流式工具事件、文件打开
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void (async () => {
      unlisteners.push(
        await listen<ConfigChangedPayload>('config_changed', (p) => applyConfigChanged(p)),
      );
      // 后端在历史落库成功后广播 history_added;payload 为 snake_case 简化结构,
      // 由 store 内 normalizeHistoryEntry 统一适配(lib/ipc 的 listen 已解包事件对象)
      unlisteners.push(
        await listen<HistoryEntry | BackendHistoryEntry>('history_added', (payload) =>
          applyHistoryAdded(payload),
        ),
      );
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
          // 事件回调内即时取词(全局 translate),不随组件渲染生命周期固化
          toast.error(translate('chrome.toast.tool_failed', { message: p.error.message }));
        }),
      );
      // 通过文件关联/命令行/拖放「用 Qraft 打开」的文件:实时在编辑器工作区打开
      unlisteners.push(
        await listen<OpenFileEventPayload>('app:open-file', (p) => {
          if (p?.path) openFileInEditor(p.path, p.content, p.encoding);
        }),
      );
      // 拖放/打开的文件无法直接作为文本打开:按载荷分流提示(参考 VS Code)
      // - unsupported(二进制):提示 + 「仍要打开」动作,点击经 fs_read_text_file_encoded
      //   的 force 参数按探测编码有损解码打开(Open Anyway)
      // - too-large:超过编辑器整读上限 → 切换大文件只读查看模式
      //   (fs_large_file_info 流式打开,非错误)
      // - error:路径非法等其他原因,展示消息
      unlisteners.push(
        await listen<OpenFileUnsupportedPayload>('app:open-file-unsupported', (p) => {
          if (!p) return;
          if (p.kind === 'unsupported' && p.path) {
            const path = p.path;
            toast.warning(
              translate('chrome.toast.open_binary_unsupported', { name: fileNameFromPath(path) }),
              {
                duration: 10_000,
                action: {
                  label: translate('tools.text_editor.open_anyway'),
                  onClick: () => {
                    void forceOpenFile(path)
                      .then((r) => openFileInEditor(r.path, r.content, r.encoding))
                      .catch(() => {
                        // 强制打开失败(读取错误/超大):静默,后端已有对应提示渠道
                      });
                  },
                },
              },
            );
          } else if (p.kind === 'too-large' && p.path) {
            // 大文件:切换编辑器工具并以只读模式打开(索引扫描由 Workbench 触发)
            openLargeFileInEditor(p.path);
          } else if (p.message) {
            toast.warning(translate('chrome.toast.open_binary_unsupported', { name: p.message }));
          }
        }),
      );
      // 弹窗关闭后回写:主窗口把弹窗写入的持久化状态重新水合进内存 store,
      // 快照式模型下让弹窗中的最后编辑在主窗口可见(Rust 在 popout 销毁时广播该事件)
      unlisteners.push(
        await listen<string>('app:popout-closed', (label) => {
          const toolId = getPopoutToolIdFromLabel(label);
          if (toolId) void rehydrateToolStateFromPopout(toolId);
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

  // 初始化兜底:拉取「打开文件」待处理队列。
  // 若应用在 webview 就绪前就收到打开文件请求,`app:open-file` /
  // `app:open-file-unsupported` 事件可能丢失,这里从 Rust 端队列补齐:
  // - File 项 → 常规打开
  // - TooLarge 项 → 大文件只读查看模式
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false;
    void (async () => {
      try {
        const items = await pullPendingOpenFiles();
        if (cancelled) return;
        for (const item of items) {
          if (item?.kind === 'file' && item.path) {
            openFileInEditor(item.path, item.content, item.encoding);
          } else if (item?.kind === 'tooLarge' && item.path) {
            openLargeFileInEditor(item.path);
          }
        }
      } catch {
        // 拉取失败静默处理:事件通道仍可能已送达,避免启动阻塞
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // —— Smart Detection(opt-in):窗口聚焦时本地探测剪贴板,结果进命令面板 ——
  // 安全不变量:smartDetectionEnabled 默认 false,关闭态全链路零剪贴板读取;
  // 仅桌面壳内生效(web 预览无 __TAURI_INTERNALS__ 时短路),探测纯本地、零网络。
  const smartDetectionEnabled = useUiStore((s) => s.smartDetectionEnabled);
  useEffect(() => {
    if (!smartDetectionEnabled || !('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false;
    const detect = (): void => {
      void readClipboardText().then((raw) => {
        if (cancelled) return;
        useUiStore.getState().setDetectedTools(detectClipboardTools(raw ?? ''));
      });
    };
    detect();
    window.addEventListener('focus', detect);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', detect);
    };
  }, [smartDetectionEnabled]);

  // —— 全局快捷键(导航类) ——
  // 工具操作类(execute/clear/copy)经 lib/tool-actions 注册表触达当前激活工具,
  // 由各工具经 useToolShortcutActions 注册(search 仍待与 Monaco 冲突方案,保持 pending)。
  // 切换字符命名风格:作用于当前激活的编辑器实例(编辑器工具打开时生效)。
  useShortcut('cycle_naming_case', () => cycleNamingCaseShortcutHandler(), []);
  useShortcut('toggle_case', () => toggleCaseShortcutHandler(), []);
  useShortcut('execute_tool', () => executeToolAction(), []);
  useShortcut('clear_input', () => clearInputAction(), []);
  useShortcut('copy_output', () => copyOutputAction(), []);
  useShortcut('open_command_palette', () => setPaletteOpen((v) => !v), []);
  useShortcut('toggle_sidebar', () => useUiStore.getState().toggleSidebar(), []);
  useShortcut('toggle_settings', () => setView('settings'), [setView]);
  useShortcut('switch_tool', () => setPaletteOpen(true), []);
  useShortcut('open_history', () => setView('history'), [setView]);
  // 全局搜索:Ctrl+Shift+F 打开搜索面板
  useShortcut('global_search', () => setSearchOpen(true), []);
  // 搜索跳转:订阅 searchStore 的目标,切换视图/打开工具并定位高亮
  useSearchJump();
  // Esc 关闭当前打开的面板:全局搜索 > 命令面板 > 设置/关于弹窗 > 历史/扩展页 > 回到工具/欢迎页。
  // 无面板可关且焦点在 Monaco(编辑器/查找部件)内时返回 false 放行事件,
  // 让编辑器原生行为生效(如 Esc 关闭 Ctrl+F 查找部件)。
  useShortcut(
    'close_panel',
    (e) => {
      if (searchOpen) {
        setSearchOpen(false);
      } else if (paletteOpen) {
        setPaletteOpen(false);
      } else if (view === 'settings' || view === 'about') {
        setView(currentToolId ? 'tool' : 'welcome');
      } else if (view === 'history' || view === 'extensions') {
        setView(currentToolId ? 'tool' : 'welcome');
      } else if (e.target instanceof Element && e.target.closest('.monaco-editor')) {
        return false;
      }
    },
    [searchOpen, paletteOpen, view, currentToolId, setView],
  );

  const handleSelectHistory = (entry: HistoryEntry) => {
    useUiStore.getState().openTool(entry.toolId);
  };

  return (
    <I18nextProvider i18n={getI18nInstance()}>
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
                className={cn(
                  'h-full',
                  !(view === 'welcome' || (view === 'tool' && !currentToolId)) && 'hidden',
                )}
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

        {/* 全局搜索弹窗:由 Ctrl+Shift+F 唤起。
         * key 让每次打开时重挂载,查询输入自动清空(避免上次输入残留) */}
        <SearchDialog key={`search-${searchOpen}`} open={searchOpen} onOpenChange={setSearchOpen} />

        {/* key 让每次打开时弹窗重挂载,initialRect() 重新按当前视口尺寸居中
         * 避免小屏→大屏窗口变化后,弹窗停留在原位置(被 resize clamp 在边缘)造成不居中。
         * 前缀避免两个弹窗的 key 在同时为 false 时冲突。 */}
        <SettingsDialog
          key={`settings-${view === 'settings'}`}
          open={view === 'settings'}
          onOpenChange={(open) => {
            if (!open) setView(currentToolId ? 'tool' : 'welcome');
          }}
        />

        {/* 关于弹窗:独立于设置,由侧边栏「关于」入口打开 */}
        <AboutDialog
          key={`about-${view === 'about'}`}
          open={view === 'about'}
          onOpenChange={(open) => {
            if (!open) setView(currentToolId ? 'tool' : 'welcome');
          }}
        />

        <Toaster position="bottom-right" />
      </ErrorBoundary>
    </I18nextProvider>
  );
}

export default App;

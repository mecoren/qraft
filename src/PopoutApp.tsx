/**
 * 弹出窗口根组件 —— `index.html?popout=<toolId>` 启动分支的轻量应用壳
 *
 * 与主窗口 App 的差异(详见 prd/tool-popout-window/design.md):
 * - 仅保留「最小标题栏(工具图标+名称+拖拽区+窗口控制) + 工具工作区」,
 *   不挂 Sidebar / CommandPalette / SearchDialog / 全局快捷键 / Smart Detection。
 * - 订阅后端工具流式事件与 config_changed:弹窗内执行后端工具、语言/主题
 *   热更新与主窗口同机制;不订阅 app:open-file(文件关联只进主窗口)。
 * - 工具状态为快照式:工具组件挂载时沿用既有 zustand persist 水合,
 *   从共享 localStorage 载入主窗口最近一次落盘状态,窗口间不实时同步。
 */

import { Suspense, createElement, useEffect, type ComponentType, type JSX } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { toast, Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getI18nInstance, t as translate } from '@/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WindowControls } from '@/components/ui/window-controls';
import { getCatalogEntry, pickText } from '@/lib/tool-catalog';
import { getToolComponent, type ToolProps } from '@/tools/registry';
import { catalogToMetadata } from '@/components/ToolPanel';
import { flushPopoutToolState } from '@/lib/popout-sync';
import { useToolStateStore } from '@/store/toolStateStore';
import { useConfigStore } from '@/store/configStore';
import { listen } from '@/lib/ipc';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';

import type {
  ConfigChangedPayload,
  ToolProgressPayload,
  ToolChunkPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from '@/types/ipc';

export interface PopoutAppProps {
  /** 由 URL ?popout= 传入的原始 toolId;非法值渲染「未找到工具」提示 */
  toolId: string;
}

export function PopoutApp({ toolId }: PopoutAppProps): JSX.Element {
  return (
    <I18nextProvider i18n={getI18nInstance()}>
      <ErrorBoundary>
        <PopoutShell toolId={toolId} />
      </ErrorBoundary>
    </I18nextProvider>
  );
}

function PopoutShell({ toolId }: PopoutAppProps): JSX.Element {
  const { t } = useTranslation();
  const entry = getCatalogEntry(toolId);
  // 提取为局部变量,符合 JSX PascalCase 组件约定
  const ToolIcon = entry?.icon;
  const toolComponent = entry && !entry.special ? getToolComponent(toolId) : null;

  // 启动加载:配置(语言/主题热更新基线)与后端工具列表(后端工具执行依赖)
  useEffect(() => {
    void useConfigStore.getState().loadConfig();
    void useToolStateStore.getState().loadTools();
  }, []);

  // 订阅全局事件:配置变更、后端工具流式事件(与 App.tsx 同机制)
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void (async () => {
      unlisteners.push(
        await listen<ConfigChangedPayload>('config_changed', (p) =>
          useConfigStore.getState().applyConfigChanged(p),
        ),
      );
      unlisteners.push(
        await listen<ToolProgressPayload>('tool_progress', (p) =>
          useToolStateStore.getState().applyToolProgress(p),
        ),
      );
      unlisteners.push(
        await listen<ToolChunkPayload>('tool_chunk', (p) =>
          useToolStateStore.getState().applyToolChunk(p),
        ),
      );
      unlisteners.push(
        await listen<ToolCompletedPayload>('tool_completed', (p) =>
          useToolStateStore.getState().applyToolCompleted(p),
        ),
      );
      unlisteners.push(
        await listen<ToolFailedPayload>('tool_failed', (p) => {
          useToolStateStore.getState().applyToolFailed(p);
          toast.error(translate('chrome.toast.tool_failed', { message: p.error.message }));
        }),
      );
      // 弹窗关闭流程:Rust 已拦截 CloseRequested(prevent_close),此处冲刷防抖
      // 窗口内未落盘的工具状态(供主窗口回写),再自行销毁窗口
      unlisteners.push(
        await listen('app:popout-close-requested', async () => {
          try {
            await flushPopoutToolState(toolId);
          } catch {
            // 冲刷失败不阻塞关闭:落盘的是最后一次防抖写入,可接受
          }
          void getCurrentWindow().destroy();
        }),
      );
    })();
    return () => {
      for (const u of unlisteners) u();
    };
  }, []);

  if (!entry || entry.special || !toolComponent) {
    return (
      <div
        role="status"
        className="flex h-screen w-screen items-center justify-center bg-background-layer text-muted-foreground"
      >
        {t('chrome.tool_panel.not_found')}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background-layer">
      {/* 最小标题栏:复用主窗口 .titlebar 体系(拖拽区/工具名样式/WindowControls),
       * 不含 Logo 中段与菜单栏,保持弹窗聚焦工具本体 */}
      <header className="titlebar" data-testid="popout-titlebar">
        <div className="titlebar-left">
          {ToolIcon && (
            <span className="titlebar-tool" data-testid="popout-tool-name">
              <ToolIcon aria-hidden className="size-4" strokeWidth={ICON_STROKE_WIDTH} />
              <span className="titlebar-title">{pickText(entry.name)}</span>
            </span>
          )}
        </div>
        <div className="titlebar-fill" data-tauri-drag-region />
        <WindowControls />
      </header>

      {/* 工具工作区:与 ToolPanel 同一容器规范(内边距/滚动边界交由工具组件自管) */}
      <div className="min-h-0 flex-1 overflow-hidden px-3 pt-2 pb-3">
        <Suspense
          fallback={
            <div
              role="status"
              className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground"
            >
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {t('chrome.tool_panel.loading')}
            </div>
          }
        >
          {/* 小写命名 + createElement,与 ToolPanel 一致:从注册表查找组件类型并实例化,
           * 避免 React Compiler ESLint 规则 react-hooks/static-components 误报 */}
          {createElement(toolComponent as ComponentType<ToolProps>, {
            toolId,
            metadata: catalogToMetadata(entry),
          })}
        </Suspense>
      </div>

      <Toaster position="bottom-right" />
    </div>
  );
}

export default PopoutApp;

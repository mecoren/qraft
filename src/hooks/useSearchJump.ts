/**
 * useSearchJump —— 全局搜索跳转 + 高亮 hook
 *
 * 订阅 searchStore 的跳转目标:
 * - 非设置场景(tool / welcome / history / extensions / about):
 *   切换视图 / 打开工具,随后对目标锚点做 DOM 定位与闪烁高亮,并 consume。
 * - 设置场景(view === 'settings'):不做处理,由 SettingsDialog 自行
 *   消费(切换左侧菜单 + 定位字段高亮),避免重复处理。
 *
 * 锚点定位使用重试调度:工具组件经 ToolPanel keepalive 保持挂载,
 * 但目标工具可能尚未访问(需经 React.lazy 异步加载),故每 120ms 重试
 * 最多 20 次,锚点元素出现后 scrollIntoView + 追加高亮类。
 */

import { useEffect } from 'react';
import { useSearchStore } from '@/store/searchStore';
import { useUiStore } from '@/store/uiStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { getTabEditor } from '@/lib/editor-search-registry';
import { findMatchRangesInContent, type TextRange } from '@/lib/editor-text-search';
import type { editor } from 'monaco-editor';

/** 高亮类(与 globals.css 的 .search-anchor-highlight 对应) */
export const HIGHLIGHT_CLASS = 'search-anchor-highlight';
/** Monaco 文本搜索匹配装饰类(与 globals.css 的 .search-text-match 对应) */
export const TEXT_MATCH_CLASS = 'search-text-match';
/** 高亮持续时长(ms),由测试同步引用 */
export const HIGHLIGHT_MS = 2000;
/** 定位重试间隔(ms) */
const RETRY_INTERVAL_MS = 120;
/** 最大重试次数(≈2.4s,覆盖 React.lazy 加载与 keepalive 切换) */
const MAX_RETRIES = 20;
/** 高亮移除定时器句柄:连续跳转时清理上一次定时器,避免误删新高亮 */
let highlightTimer: number | undefined;
/**
 * 上一次文本搜索的 decoration 记录(绑定编辑器实例)。
 * Monaco 的 decoration id 只在同一编辑器内有效,跨实例清理无效,
 * 故同时记录实例;实例已销毁时跳过清理(新实例无残留)。
 */
let lastTextDecoration: { ed: editor.IStandaloneCodeEditor; ids: string[] } | null = null;

/**
 * 定位锚点元素并触发高亮;找不到时按间隔重试。
 * 独立导出供 SettingsDialog 等场景复用。
 */
export function scheduleHighlight(anchor: string, attempts = 0): void {
  const el = document.querySelector(`[data-search-anchor="${anchor}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add(HIGHLIGHT_CLASS);
    if (highlightTimer !== undefined) window.clearTimeout(highlightTimer);
    highlightTimer = window.setTimeout(() => {
      el.classList.remove(HIGHLIGHT_CLASS);
      highlightTimer = undefined;
    }, HIGHLIGHT_MS);
    return;
  }
  if (attempts >= MAX_RETRIES) return; // 静默降级:仅跳转视图,不定位
  window.setTimeout(() => scheduleHighlight(anchor, attempts + 1), RETRY_INTERVAL_MS);
}

/**
 * 对编辑器实例应用文本匹配高亮(Monaco decoration),返回第一个匹配范围。
 * 连续跳转先清空上一次 decoration,避免累积。
 */
function applyTextSearchHighlights(
  ed: editor.IStandaloneCodeEditor,
  content: string,
  query: string,
): TextRange | null {
  // 清理上一次 decoration:仅在同一编辑器实例上清(跨实例时旧 id 无效且实例可能已销毁)
  if (lastTextDecoration && lastTextDecoration.ed === ed && lastTextDecoration.ids.length > 0) {
    ed.deltaDecorations(lastTextDecoration.ids, []);
  }
  lastTextDecoration = null;
  const ranges = findMatchRangesInContent(content, query);
  if (ranges.length === 0) return null;
  const decorations: editor.IModelDeltaDecoration[] = ranges.map((r) => ({
    range: {
      startLineNumber: r.startLineNumber,
      startColumn: r.startColumn,
      endLineNumber: r.endLineNumber,
      endColumn: r.endColumn,
    },
    options: { className: TEXT_MATCH_CLASS },
  }));
  lastTextDecoration = { ed, ids: ed.deltaDecorations([], decorations) };
  return ranges[0];
}

/**
 * 文本搜索跳转:等待编辑器实例挂载后应用高亮并定位。
 * 编辑器实例在 React.lazy 加载 / tab 重挂载后才注册,故按间隔重试。
 */
function jumpToTextTarget(tabId: string, query: string, attempts = 0): void {
  const ed = getTabEditor(tabId);
  if (ed && ed.getModel()) {
    const tab = useEditorWorkspaceStore.getState().workspace.tabs.find((t) => t.id === tabId);
    const first = applyTextSearchHighlights(ed, tab?.content ?? '', query);
    if (first) {
      ed.revealRangeInCenter({
        startLineNumber: first.startLineNumber,
        startColumn: first.startColumn,
        endLineNumber: first.endLineNumber,
        endColumn: first.endColumn,
      });
      ed.setSelection({
        startLineNumber: first.startLineNumber,
        startColumn: first.startColumn,
        endLineNumber: first.endLineNumber,
        endColumn: first.endColumn,
      });
      ed.focus();
    }
    return;
  }
  if (attempts >= MAX_RETRIES) return; // 静默降级:tab 可能已关闭,仅打开工具
  window.setTimeout(() => jumpToTextTarget(tabId, query, attempts + 1), RETRY_INTERVAL_MS);
}

export function useSearchJump(): void {
  const target = useSearchStore((s) => s.target);
  const consume = useSearchStore((s) => s.consume);

  useEffect(() => {
    if (!target) return;
    const ui = useUiStore.getState();
    if (target.view === 'settings') {
      // 设置场景:先切换到设置视图;菜单切换与字段锚点定位由 SettingsDialog 完成,
      // 保留 target 供其消费,避免重复处理。
      ui.setView('settings');
      return;
    }

    // 文本搜索跳转(编辑器内容高亮):打开文本编辑器 + 激活目标 tab + decoration 高亮定位
    if (target.textQuery && target.tabId) {
      if (target.toolId) ui.openTool(target.toolId);
      useEditorWorkspaceStore.getState().switchTab(target.tabId);
      jumpToTextTarget(target.tabId, target.textQuery);
      consume();
      return;
    }

    if (target.view === 'tool') {
      if (target.toolId) ui.openTool(target.toolId);
    } else if (target.view === 'welcome') {
      ui.goWelcome();
    } else {
      ui.setView(target.view);
    }

    if (target.anchor) {
      scheduleHighlight(target.anchor);
    }
    consume();
  }, [target, consume]);
}

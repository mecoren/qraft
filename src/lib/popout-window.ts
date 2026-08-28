/**
 * 工具弹出新窗口 —— 跨运行模式的窗口创建入口
 *
 * - Tauri 桌面模式:运行时 WebviewWindow 创建独立窗口,每工具单实例
 *   (label = `popout-<toolId>`),重复弹出时聚焦已有窗口而非重复创建。
 * - Web 模式(浏览器 dev/预览):window.open 回退;返回 null 即被浏览器
 *   拦截,以 warning toast 明确告知用户。
 * - Tauri API 全部经动态 import 引入,保证纯 Web 构建不打包 Tauri 运行时。
 *
 * 状态一致性采用「快照式独立窗口」(与 DevToys 一致):弹窗挂载工具组件时
 * 沿用现有 zustand persist 水合,从共享 localStorage 载入快照;窗口间不实时
 * 同步,各自写回持久层,最后写入者胜出。详见 prd/tool-popout-window/design.md。
 */

import { toast } from 'sonner';
import { getCatalogEntry, pickText, type CatalogEntry } from '@/lib/tool-catalog';
import { t as translate } from '@/i18n';

/** 弹窗 URL 查询参数名(main.tsx 据此分支渲染 PopoutApp) */
export const POPOUT_QUERY_KEY = 'popout';

/** 弹窗窗口 label 前缀(Rust 端按此前缀区分弹窗与主窗口的关闭流程) */
export const POPOUT_LABEL_PREFIX = 'popout-';

/** 默认窗口尺寸与最小尺寸(Tauri 逻辑像素,随系统 DPI 自适应) */
export const DEFAULT_POPOUT_WIDTH = 900;
export const DEFAULT_POPOUT_HEIGHT = 640;
export const MIN_POPOUT_WIDTH = 480;
export const MIN_POPOUT_HEIGHT = 360;

/** 当前是否运行在 Tauri 桌面壳内(与 App.tsx 既有判定一致) */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 弹窗窗口 label:每工具单实例的唯一标识 */
export function popoutWindowLabel(toolId: string): string {
  return `${POPOUT_LABEL_PREFIX}${toolId}`;
}

/** 弹窗加载的相对 URL(Tauri 与 Web 模式共用,Web 模式外层再解析为绝对地址) */
export function getPopoutUrl(toolId: string): string {
  return `index.html?${POPOUT_QUERY_KEY}=${encodeURIComponent(toolId)}`;
}

/** 该工具是否允许弹出(目录中存在且非应用内特殊页面) */
export function isPopoutSupported(toolId: string): boolean {
  const entry = getCatalogEntry(toolId);
  return !!entry && !entry.special;
}

/**
 * 在新窗口打开指定工具。
 * 三处入口(标题栏/命令面板/侧栏右键)共用;全程吞掉异常并转为 toast,
 * 不向调用方抛错(fire-and-forget 语义)。
 */
export async function openToolInNewWindow(toolId: string): Promise<void> {
  const entry = getCatalogEntry(toolId);
  if (!entry || entry.special) return;
  try {
    if (isTauriRuntime()) {
      await openTauriPopout(toolId, entry);
    } else {
      openWebPopout(entry);
    }
  } catch {
    // 建窗失败(权限缺失/系统限制/label 冲突):以 toast 反馈,不影响主窗口
    toast.error(translate('chrome.toast.popout_failed'));
  }
}

/** Tauri 模式:查重聚焦或创建 WebviewWindow */
async function openTauriPopout(toolId: string, entry: CatalogEntry): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = popoutWindowLabel(toolId);

  // 每工具单实例:已打开时还原并聚焦,与 DevToys 行为一致
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.unminimize();
    await existing.setFocus();
    return;
  }

  const size = entry.popoutSize ?? { width: DEFAULT_POPOUT_WIDTH, height: DEFAULT_POPOUT_HEIGHT };
  // decorations:false + 复用 WindowControls,弹窗标题栏与主窗口视觉一致;
  // visible 默认 true,配合 center 由系统决定落点
  const webview = new WebviewWindow(label, {
    url: getPopoutUrl(toolId),
    title: pickText(entry.name),
    width: size.width,
    height: size.height,
    minWidth: MIN_POPOUT_WIDTH,
    minHeight: MIN_POPOUT_HEIGHT,
    center: true,
    resizable: true,
    decorations: false,
    shadow: true,
  });

  // 建窗结果经事件通知:tauri://created 成功 / tauri://error 失败(官方模式)
  await new Promise<void>((resolve, reject) => {
    void webview.once('tauri://created', () => resolve());
    void webview.once('tauri://error', (e) => {
      reject(e.payload instanceof Error ? e.payload : new Error('webview create failed'));
    });
  });
}

/** Web 模式:window.open 回退,被拦截时 toast 提示 */
function openWebPopout(entry: CatalogEntry): void {
  const size = entry.popoutSize ?? { width: DEFAULT_POPOUT_WIDTH, height: DEFAULT_POPOUT_HEIGHT };
  const url = new URL(getPopoutUrl(entry.id), window.location.href).toString();
  const opened = window.open(url, '_blank', `popup=yes,width=${size.width},height=${size.height}`);
  if (!opened) {
    toast.warning(translate('chrome.toast.popout_blocked'));
  }
}

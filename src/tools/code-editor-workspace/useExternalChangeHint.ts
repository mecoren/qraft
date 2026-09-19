/**
 * 打开文件的外部变更提示 —— watcher 推送 + 激活轮询双路
 *
 * 职责:
 * - 把当前可比对(有磁盘路径、记录了 mtime 基准、非只读大文件)的 Tab 路径
 *   全量注册给后端 watcher(`fs_watch_open_files`),Tab 集合变化经防抖同步
 * - 订阅 `fs:external-change`:后端只报「这条路径出过事」,是否算外部修改由
 *   这里按 Tab 基准重新 stat 判定 —— 本应用自己写盘同样会触发事件,而保存流程
 *   已把基准刷成新 mtime,因此自写会被判为「无事发生」且不吃掉后续真实改动的
 *   提示名额
 * - 激活 Tab 时补一次同样的比对:watcher 只在进程存活期推送,窗口外的改动
 *   (以及原生监视器不可用的场合)靠这条兜底;每个「路径 + 基准」只 stat 一次,
 *   避免打字引起的重渲染把激活比对变成轮询
 * - 提示同样按「路径 + 基准」去重:基准变化(重新加载/保存)后才进入新一轮
 *
 * 提示之外不做任何自动动作:覆盖 / 重新加载仍由保存时的 ERR_FILE_MODIFIED
 * 三选对话框决定。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CommandError, listen } from '@/lib/ipc';
import { fileMtimeMs, watchOpenFiles } from './fileOps';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import type { EditorTab } from './schema';

/** `fs:external-change` 事件载荷(后端只回传注册时的原始路径) */
interface ExternalChangePayload {
  path: string;
}

/** Tab 集合变化到下发注册之间的防抖窗口:连续开关 Tab 不该各打一次 IPC */
const WATCH_SYNC_DEBOUNCE_MS = 250;

/** 可参与外部变更比对的 Tab:无路径 / 无基准(旧数据)/ 只读大文件都跳过 */
function watchablePath(tab: EditorTab): string | null {
  if (!tab.path || tab.largeFile || tab.openedMtimeMs === undefined) return null;
  return tab.path;
}

export function useExternalChangeHint(args: { ready: boolean; activeTab: EditorTab | null }): void {
  const { ready, activeTab } = args;
  const { t } = useTranslation();
  /** 已提示过的「路径 + 基准」:同一基准只打扰一次 */
  const notifiedRef = useRef<Set<string>>(new Set());
  /** 激活路径已 stat 过的「路径 + 基准」:避免重渲染把激活比对变成轮询 */
  const probedRef = useRef<Set<string>>(new Set());
  const tabs = useEditorWorkspaceStore((state) => state.workspace.tabs);

  /**
   * 比对一次磁盘 mtime 与 Tab 基准:不一致提示「已被外部修改」,文件没了提示「将重建」。
   * `fromActivation` 为 true 时同一基准只 stat 一次(激活兜底);事件路径每次都 stat,
   * 因为后端已按路径去抖,且「磁盘又变回来了」这类无实质变化的事件不该吃掉后续真实改动的提示名额。
   */
  const checkTab = useCallback(
    (tab: EditorTab, fromActivation: boolean) => {
      const path = watchablePath(tab);
      if (path === null || tab.openedMtimeMs === undefined) return;
      const baseline = tab.openedMtimeMs;
      const key = `${path}:${baseline}`;
      if (notifiedRef.current.has(key) || (fromActivation && probedRef.current.has(key))) return;
      if (fromActivation) probedRef.current.add(key);
      void fileMtimeMs(path)
        .then((current) => {
          if (current === baseline) return;
          notifiedRef.current.add(key);
          toast.warning(t('tools.text_editor.external_modified_hint', { title: tab.title }));
        })
        .catch((e: unknown) => {
          // 文件已被外部删除:提前说清「保存将在原路径重新创建」,否则用户只会在
          // 关闭时看到一句读不懂的 IO 报错。
          if (e instanceof CommandError && e.code === 'ERR_FILE_NOT_FOUND') {
            notifiedRef.current.add(key);
            toast.warning(t('tools.text_editor.external_deleted_hint', { title: tab.title }));
            return;
          }
          // 其它 stat 失败静默:保存路径有 ERR_FILE_MODIFIED 三选兜底
        });
    },
    [t],
  );

  // 后端监视集合:全量替换语义,路径集合字符串化后作为依赖(内容不变不重发)
  const pathsKey = useMemo(
    () =>
      tabs
        .map(watchablePath)
        .filter((p): p is string => p !== null)
        .sort()
        .join('\n'),
    [tabs],
  );
  useEffect(() => {
    if (!ready || !pathsKey) return;
    const timer = setTimeout(() => {
      void watchOpenFiles(pathsKey.split('\n')).catch(() => {
        // watcher 不可用(原生后端失败等):激活比对仍能兜底
      });
    }, WATCH_SYNC_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [ready, pathsKey]);

  // watcher 推送:事件路径与注册时同源字符串,精确比对即可
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<ExternalChangePayload>('fs:external-change', (payload) => {
          if (cancelled || !payload?.path) return;
          const { tabs: live } = useEditorWorkspaceStore.getState().workspace;
          for (const tab of live) {
            if (tab.path === payload.path) checkTab(tab, false);
          }
        });
      } catch {
        // 事件系统不可用(浏览器 dev 等):激活比对仍能兜底
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [checkTab]);

  // 激活比对:切回 Tab 即知晓窗口外的改动(每「路径 + 基准」一次)
  useEffect(() => {
    if (!ready || !activeTab) return;
    checkTab(activeTab, true);
  }, [ready, activeTab, checkTab]);
}

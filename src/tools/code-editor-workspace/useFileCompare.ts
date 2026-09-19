/**
 * 文件对比状态 —— 「两个已打开文件并排 Diff」的选中集、对比项与补丁导出
 *
 * 从 EditorWorkbench 拆出:对比是纯会话内 UI 状态(不落盘),其生命周期
 * (选中 → 组成对比 → 切换/交换 → 引用 Tab 被关闭时清理)自成闭环,与编辑、
 * 保存、文件树等其它工作区职责无耦合。
 *
 * 约束:
 * - `tabs` 必须来自 store 订阅(渲染值),两个清理 effect 依赖它的引用变化
 *   来同步「已关闭 Tab 不再出现在选中集 / 对比项里」;
 * - 对比项引用的 Tab 与左栏多选都只在会话内有效,重载后由 hydrate 重建 Tab。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  buildUnifiedPatch,
  buildUnifiedPatchFromBlocks,
  type DiffSnapshot,
} from '@/components/text-diff/diff-utils';
import { downloadText } from '@/lib/file-utils';
import { useTextCompareStore } from '@/tools/textCompareStore';
import { useEditorWorkspaceStore } from './useEditorWorkspaceStore';
import type { ComparePair, EditorTab } from './schema';

/** 生成稳定唯一对比 id */
function createCompareId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `compare-${crypto.randomUUID()}`;
  }
  return `compare-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useFileCompare({
  tabs,
  activeTabId,
}: {
  /** 当前工作区 Tab 列表(store 订阅值,用于清理与对比项引用解析) */
  tabs: EditorTab[];
  /** 当前激活 Tab id(左栏多选的隐含基准) */
  activeTabId: string | null;
}): {
  /** 左栏 Ctrl+多选选中的 Tab id 集合 */
  selectedTabIds: string[];
  compares: ComparePair[];
  activeCompareId: string | null;
  /** 当前激活对比项及其左右 Tab(引用失效时为 null) */
  activeCompare: ComparePair | null;
  compareLeft: EditorTab | null;
  compareRight: EditorTab | null;
  /** 主区域是否渲染对比视图 */
  showCompare: boolean;
  /** 退出对比视图(打开/新建/切换文件时调用) */
  clearActiveCompare: () => void;
  handleSelectTab: (id: string) => void;
  handleSelectMany: (id: string, additive: boolean) => void;
  handleCompareSelected: () => void;
  handleSelectCompare: (id: string) => void;
  handleCloseCompare: (id: string) => void;
  handleCloseAllCompares: () => void;
  swapCompareSides: (compareId: string) => void;
  /** 把刚追加到末尾的快照 Tab 与指定 Tab 组成对比并激活 */
  compareWithLatestTab: (leftTabId: string) => void;
  exportComparePatch: (left: EditorTab, right: EditorTab) => Promise<void>;
  /** 最新差异快照(供导出补丁判断新鲜度,由对比视图回填) */
  compareSnapRef: { current: DiffSnapshot | null };
} {
  const { t } = useTranslation();
  /**
   * 左栏 Ctrl+多选选中的文件(id 集合,不含激活 Tab 自身)。
   * 存储层不落盘(纯会话内 UI 状态),关闭文件时同步剔除失效 id。
   */
  const [selectedTabIds, setSelectedTabIds] = useState<string[]>([]);
  /** 已创建的对比项列表(不落盘,纯会话内 UI 状态) */
  const [compares, setCompares] = useState<ComparePair[]>([]);
  /** 当前激活的对比项 id(主区域显示其 diff) */
  const [activeCompareId, setActiveCompareId] = useState<string | null>(null);

  /** 当前激活的对比项及左右文件(引用失效时回退 null) */
  const activeCompare = activeCompareId
    ? (compares.find((cp) => cp.id === activeCompareId) ?? null)
    : null;
  const compareLeft = activeCompare
    ? (tabs.find((t) => t.id === activeCompare.leftTabId) ?? null)
    : null;
  const compareRight = activeCompare
    ? (tabs.find((t) => t.id === activeCompare.rightTabId) ?? null)
    : null;
  const showCompare = Boolean(activeCompare && compareLeft && compareRight);

  /** 退出对比视图:打开/新建/切换文件后主区域回到编辑器 */
  const clearActiveCompare = useCallback(() => {
    setActiveCompareId(null);
  }, []);

  /** 点击左栏普通文件:激活该 Tab 并退出对比视图 */
  const handleSelectTab = useCallback((id: string) => {
    useEditorWorkspaceStore.getState().switchTab(id);
    setActiveCompareId(null);
  }, []);

  /**
   * 左栏选中处理(单击 / Ctrl+点击)。
   *
   * 「选中集合」= selectedTabIds ∪ {activeTabId}(去重),表示当前参与对比的候选文件。
   * - additive=false(普通点击):仅激活该文件,清空多选(选中集合=仅该文件)
   * - additive=true(Ctrl/Cmd+点击):**先把原先高亮(激活)的文件纳入选中集**,
   *   再切换点击的文件在选中集中的存在,避免激活文件在切 Tab 后丢失
   *
   * 选中集合最多 2 个文件:
   * - 第 3 个时**直接报错**并拒绝加入,避免选中过多后对比时静默只取前两个
   */
  const handleSelectMany = useCallback(
    (id: string, additive: boolean) => {
      const state = useEditorWorkspaceStore.getState();
      const tab = state.workspace.tabs.find((t) => t.id === id);
      if (!tab) return;
      if (additive) {
        // 基准选中集:当前激活 Tab 必须计入(去重),保证"原先高亮的"不丢失
        const base = selectedTabIds.includes(activeTabId ?? '')
          ? selectedTabIds
          : [...selectedTabIds, ...(activeTabId ? [activeTabId] : [])];
        // 点击的文件已在选中集 → 取消;否则加入
        const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
        if (new Set(next).size > 2) {
          toast.error(t('tools.text_editor.err_max_two_compare'));
          return;
        }
        state.switchTab(id);
        setActiveCompareId(null);
        setSelectedTabIds(next);
        return;
      }
      // 普通点击:仅激活该文件,清空多选
      state.switchTab(id);
      setActiveCompareId(null);
      setSelectedTabIds([]);
    },
    [selectedTabIds, activeTabId, t],
  );

  /** 关闭文件后,从选中集合剔除已关闭的 Tab,避免残留失效 id */
  useEffect(() => {
    const valid = new Set(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id));
    // 订阅 store.tabs 变化后清理本地选择缓存:store 即外部状态源,
    // 此处同步是「订阅外部系统变更后修正本地缓存」的必要同步,非普通渲染副作用。
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-x/set-state-in-effect
    setSelectedTabIds((prev) => prev.filter((x) => valid.has(x)));
  }, [tabs]);

  /**
   * 比较所选内容:从多选集合中取参与对比的两个文件。
   *
   * 选择集为「恰好 2 个」时直接对比;不足 2 个提示需选中两个;
   * 超过 2 个时**直接报错**,避免静默只取前两个造成困惑。
   */
  const handleCompareSelected = useCallback(() => {
    const state = useEditorWorkspaceStore.getState();
    const { tabs: allTabs } = state.workspace;
    // 参与对比的候选 = 多选集合 + 激活 Tab(去重)
    const chosen: EditorTab[] = [];
    for (const id of selectedTabIds) {
      const tab = allTabs.find((t) => t.id === id);
      if (tab && !chosen.some((c) => c.id === tab.id)) chosen.push(tab);
    }
    const active = allTabs.find((t) => t.id === state.workspace.activeTabId);
    if (active && !chosen.some((c) => c.id === active.id)) chosen.push(active);
    if (chosen.length < 2) {
      toast.info(t('tools.text_editor.info_select_two'));
      return;
    }
    if (chosen.length > 2) {
      toast.error(t('tools.text_editor.err_only_two_compare'));
      return;
    }
    const pair: ComparePair = {
      id: createCompareId(),
      leftTabId: chosen[0].id,
      rightTabId: chosen[1].id,
    };
    setCompares((prev) => [...prev, pair]);
    setActiveCompareId(pair.id);
  }, [selectedTabIds, t]);

  /** 点击左栏对比项:切换激活该对比 */
  const handleSelectCompare = useCallback((id: string) => {
    setActiveCompareId(id);
  }, []);

  /** 关闭对比项:移除该对比,激活态自动跳到相邻(或清空) */
  const handleCloseCompare = useCallback((id: string) => {
    setCompares((prev) => {
      const next = prev.filter((cp) => cp.id !== id);
      setActiveCompareId((active) => {
        if (active !== id) return active;
        const idx = prev.findIndex((cp) => cp.id === id);
        return next[Math.min(idx, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, []);

  /** 关闭整个「对比差异」分组:清空全部对比项并退出对比视图 */
  const handleCloseAllCompares = useCallback(() => {
    setCompares([]);
    setActiveCompareId(null);
  }, []);

  /**
   * 交换对比两侧(对齐文本比较工具「交换两侧内容」):把对比项的左右
   * Tab id 互换。内容在 Tab 本身,不拷贝数据;渲染层标题/语言各自跟随。
   */
  const swapCompareSides = useCallback((compareId: string) => {
    setCompares((prev) =>
      prev.map((cp) =>
        cp.id === compareId ? { ...cp, leftTabId: cp.rightTabId, rightTabId: cp.leftTabId } : cp,
      ),
    );
  }, []);

  /** 新增一个对比项并激活(左栏多选 / 快照对比 / 冲突对比共用) */
  const addCompare = useCallback((leftTabId: string, rightTabId: string) => {
    const pair: ComparePair = { id: createCompareId(), leftTabId, rightTabId };
    setCompares((prev) => [...prev, pair]);
    setActiveCompareId(pair.id);
  }, []);

  /**
   * 与「刚打开的快照 Tab」组成对比:快照恒为追加在末尾的最后一个 Tab
   * (openDroppedText 不指定位置),故按末位取 id;快照 Tab 无路径,
   * 不会与本地文件 Tab 混淆。
   */
  const compareWithLatestTab = useCallback(
    (leftTabId: string) => {
      const latest = useEditorWorkspaceStore.getState().workspace.tabs;
      const snapshotTabId = latest[latest.length - 1]?.id;
      if (snapshotTabId) addCompare(leftTabId, snapshotTabId);
    },
    [addCompare],
  );

  /**
   * 最新差异快照(存 ref,不进 state):FileCompareView 经 onDiffSnapshot 回填。
   * 对比视图 key 到对比项,切换对比即重挂,快照天然跟随当前对比,不串台。
   */
  const compareSnapRef = useRef<DiffSnapshot | null>(null);

  /**
   * 导出当前对比的统一格式补丁(.patch):快照新鲜时按显示块生成(与所见
   * 一致),过期(如刚编辑完计算未到)回退 jsdiff 独立计算。文件名取两侧
   * Tab 名。
   */
  const exportComparePatch = useCallback(
    async (left: EditorTab, right: EditorTab) => {
      if (!left.content.trim() && !right.content.trim()) {
        toast.info(t('tools.text_compare.patch_empty_toast'));
        return;
      }
      const snap = compareSnapRef.current;
      const opts = useTextCompareStore.getState().options;
      const fresh =
        snap !== null &&
        snap.original === left.content &&
        snap.modified === right.content &&
        snap.ignoreWhitespace === opts.ignoreWhitespace &&
        snap.ignoreCase === opts.ignoreCase &&
        snap.ignoreEol === opts.ignoreEol;
      const names = { originalName: left.title, modifiedName: right.title };
      const patch = fresh
        ? buildUnifiedPatchFromBlocks(left.content, right.content, snap.blocks, names)
        : buildUnifiedPatch(left.content, right.content, names);
      downloadText(`${left.title}-${right.title}.patch`, patch, 'text/x-diff');
    },
    [t],
  );

  /** 对比项引用的 Tab 被关闭时,自动清理该对比项 */
  useEffect(() => {
    // 同上文:订阅 store.tabs 变化后清理对比缓存(外部状态源同步),非普通渲染副作用。
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-x/set-state-in-effect
    setCompares((prev) => {
      const valid = new Set(useEditorWorkspaceStore.getState().workspace.tabs.map((t) => t.id));
      const next = prev.filter((cp) => valid.has(cp.leftTabId) && valid.has(cp.rightTabId));
      if (next.length !== prev.length) {
        setActiveCompareId((active) =>
          active && next.some((cp) => cp.id === active) ? active : (next[0]?.id ?? null),
        );
      }
      return next;
    });
  }, [tabs]);

  return {
    selectedTabIds,
    compares,
    activeCompareId,
    activeCompare,
    compareLeft,
    compareRight,
    showCompare,
    clearActiveCompare,
    handleSelectTab,
    handleSelectMany,
    handleCompareSelected,
    handleSelectCompare,
    handleCloseCompare,
    handleCloseAllCompares,
    swapCompareSides,
    compareWithLatestTab,
    exportComparePatch,
    compareSnapRef,
  };
}

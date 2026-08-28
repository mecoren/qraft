/**
 * 文本比较工作区 Store —— 多 Tab 对比文档
 *
 * 设计说明(与 jsonFormatterStore / 编辑器工作区保持一致的模式):
 * - 不挂 persist 中间件:文档经 `config_get` / `config_set` IPC 持久化到
 *   Rust 端 JsonConfigStore(`tool_prefs.text_compare_docs_v1`),重启后由
 *   `hydrate()` 还原。
 * - `ready` 标志:hydrate 完成后才为 true,组件据此决定是否开始持久化,
 *   避免「启动时用默认空状态覆盖已存数据」。
 * - `userTouched` 标志:hydrate 完成前用户已主动操作时置位;hydrate 据此
 *   保留用户操作,不覆盖。
 * - 每个 Tab 是一组对比(原始文本 + 修改后文本双内容),标题由原始侧
 *   内容首行派生或 compare-N 自动命名。
 * - 无本地历史快照(旧版文本比较即无历史功能,保持范围不变)。
 */
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';

/** 单个对比文档(Tab) */
export interface CompareDoc {
  /** 稳定唯一 id(React key / 激活切换定位用) */
  id: string;
  /** Tab 显示名(原始侧内容首行派生或 compare-N 自动命名) */
  title: string;
  /**
   * 自动命名的原始标题(compare-N)。仅自动命名 Tab 使用:
   * 输入内容后 title 改为首行派生文本,清空内容时回退到该名,
   * 同时保证新 Tab 的序号分配不因改名而重复。
   * 手动重命名后清除,后续内容变化不再派生标题。
   */
  autoTitle?: string;
  /** 固定 Tab:始终排在 Tab 栏最前(与编辑器工作区 pinned 语义一致) */
  pinned: boolean;
  /** 原始文本(左侧) */
  original: string;
  /** 修改后文本(右侧) */
  modified: string;
}

/** 文档工作区(整体持久化单元) */
export interface CompareDocs {
  docs: CompareDoc[];
  /** 当前激活文档;无文档时为 null */
  activeDocId: string | null;
}

export const DOCS_CONFIG_KEY = 'tool_prefs.text_compare_docs_v1';

/** 未命名 Tab 标题的最大显示长度(超出截断加省略号) */
const TITLE_MAX = 32;
/**
 * 内容派生标题的门槛:首个非空行需超过 3 个字符才会放到 Tab 名位置。
 * 按首行而非全文判断,避免一两个字符的输入把 Tab 名换成碎片文本。
 */
const TITLE_MIN_CHARS = 3;

/** 生成稳定唯一 id(crypto.randomUUID,降级为时间戳+随机) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 由原始侧内容推导标题:取首个非空行并去除首尾空白,超长截断加省略号。
 * 首行为空、全空白或未超过 3 个字符时返回 null(回退到自动命名占位)。
 */
export function deriveTitleFromContent(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      if (trimmed.length <= TITLE_MIN_CHARS) return null;
      return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX)}…` : trimmed;
    }
  }
  return null;
}

/** 扫描现有文档中最大的 `compare-N` 序号,返回下一个可用序号 */
export function nextAutoNumber(docs: readonly CompareDoc[]): number {
  let max = 0;
  for (const d of docs) {
    for (const name of [d.title, d.autoTitle]) {
      const m = /^compare-(\d+)$/.exec(name ?? '');
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}

/** 校验一条反序列化出的文档是否结构合法,合法则返回规整后的副本 */
function sanitizeDoc(raw: unknown): CompareDoc | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.title !== 'string' || !t.title) return null;
  const autoTitle = typeof t.autoTitle === 'string' && t.autoTitle ? t.autoTitle : undefined;
  const pinned = t.pinned === true;
  const original = typeof t.original === 'string' ? t.original : '';
  const modified = typeof t.modified === 'string' ? t.modified : '';
  return {
    id: t.id,
    title: t.title,
    ...(autoTitle !== undefined ? { autoTitle } : {}),
    pinned,
    original,
    modified,
  };
}

/** 将任意反序列化值规整为合法 CompareDocs,损坏数据逐字段回退默认值 */
export function normalizeDocs(raw: unknown): CompareDocs {
  if (typeof raw !== 'object' || raw === null) return { docs: [], activeDocId: null };
  const w = raw as Record<string, unknown>;
  const docs = Array.isArray(w.docs)
    ? w.docs.map(sanitizeDoc).filter((d): d is CompareDoc => d !== null)
    : [];
  const activeDocId =
    typeof w.activeDocId === 'string' && docs.some((d) => d.id === w.activeDocId)
      ? w.activeDocId
      : null;
  return { docs, activeDocId };
}

interface TextCompareWorkspaceState {
  docs: CompareDoc[];
  activeDocId: string | null;

  /** 是否已完成 hydrate;false 时禁止持久化 */
  ready: boolean;
  /** hydrate 完成前用户是否已主动操作(保留用户操作,不覆盖) */
  userTouched: boolean;
  /** 最近一次持久化错误(仅用于诊断,不影响使用) */
  error: string | null;

  /** 从 Rust config 还原;已还原时再次调用为 no-op */
  hydrate: () => Promise<void>;
  /** 新建空白文档并激活 */
  newDoc: () => void;
  /** 关闭文档,激活态自动跳到相邻 */
  closeDoc: (id: string) => void;
  /** 切换激活文档 */
  switchDoc: (id: string) => void;
  /** 重命名文档 Tab:清除 autoTitle,后续内容变化不再派生标题 */
  renameDoc: (id: string, title: string) => void;
  /** 切换文档 Tab 固定状态(固定 Tab 恒排 Tab 栏最前) */
  togglePinDoc: (id: string) => void;
  /** 更新文档某一侧内容(编辑器 onChange 调用);自动命名 Tab 随原始侧内容派生标题 */
  setDocContent: (id: string, side: 'original' | 'modified', text: string) => void;
  /** 将当前文档列表写入 Rust config(组件防抖后调用) */
  persistDocs: () => Promise<void>;
}

/** 默认文档 id(store 初始即含一个空文档,避免 hydrate 异步完成前的输入丢失) */
export const DEFAULT_DOC_ID = 'default';

function createDefaultDocs(): CompareDocs {
  return {
    docs: [
      {
        id: DEFAULT_DOC_ID,
        title: 'compare-1',
        autoTitle: 'compare-1',
        pinned: false,
        original: '',
        modified: '',
      },
    ],
    activeDocId: DEFAULT_DOC_ID,
  };
}

export const useTextCompareStore = create<TextCompareWorkspaceState>((set, get) => ({
  ...createDefaultDocs(),
  ready: false,
  userTouched: false,
  error: null,

  hydrate: async () => {
    // 已还原则不重复读取,防止多次挂载时竞态覆盖用户正在编辑的内容
    if (get().ready) return;
    const res = await safeInvoke<unknown>('config_get', { key: DOCS_CONFIG_KEY });
    const restored = res.ok ? normalizeDocs(res.value) : null;
    set((s) => {
      // 若 hydrate 完成前用户已主动操作,保留用户操作,避免异步恢复覆盖用户意图
      if (s.userTouched) return { ready: true, error: res.ok ? null : res.error.message };
      return {
        ready: true,
        error: res.ok ? null : res.error.message,
        ...(restored ? { docs: restored.docs, activeDocId: restored.activeDocId } : {}),
      };
    });
  },

  newDoc: () => {
    const { docs } = get();
    const n = nextAutoNumber(docs);
    const doc: CompareDoc = {
      id: createId(),
      title: `compare-${n}`,
      autoTitle: `compare-${n}`,
      pinned: false,
      original: '',
      modified: '',
    };
    set((s) => ({
      docs: [...s.docs, doc],
      activeDocId: doc.id,
      userTouched: true,
    }));
  },

  closeDoc: (id) => {
    const { docs, activeDocId } = get();
    const index = docs.findIndex((d) => d.id === id);
    if (index < 0) return;
    const rest = docs.filter((d) => d.id !== id);
    const nextActive =
      activeDocId === id ? (rest[Math.min(index, rest.length - 1)]?.id ?? null) : activeDocId;
    set({ docs: rest, activeDocId: nextActive, userTouched: true });
  },

  switchDoc: (id) => {
    const { docs } = get();
    if (!docs.some((d) => d.id === id)) return;
    set({ activeDocId: id });
  },

  renameDoc: (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, title: trimmed, autoTitle: undefined } : d)),
      userTouched: true,
    }));
  },

  togglePinDoc: (id) => {
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, pinned: !d.pinned } : d)),
      userTouched: true,
    }));
  },

  setDocContent: (id, side, text) => {
    const { docs } = get();
    const next = docs.map((d) => {
      if (d.id !== id) return d;
      // 自动命名 Tab(compare-N 且未改名):标题由原始侧首行派生;
      // modified 侧变化不改标题(对比 Tab 语义锚定原始侧)
      const content = { ...d, [side]: text } as CompareDoc;
      if (side === 'original' && (d.autoTitle !== undefined || /^compare-\d+$/.test(d.title))) {
        const autoTitle = d.autoTitle ?? d.title;
        content.title = deriveTitleFromContent(text) ?? autoTitle;
        content.autoTitle = autoTitle;
      }
      return content;
    });
    set({ docs: next, userTouched: true });
  },

  persistDocs: async () => {
    // hydrate 完成前不写,避免覆盖已存数据
    const { ready, docs, activeDocId } = get();
    if (!ready) return;
    const r = await safeInvoke<boolean>('config_set', {
      key: DOCS_CONFIG_KEY,
      value: { docs, activeDocId } satisfies CompareDocs,
    });
    if (!r.ok) set({ error: r.error.message });
  },
}));

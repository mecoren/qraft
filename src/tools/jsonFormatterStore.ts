/**
 * JSON 格式化器工作区 Store —— 多 Tab 文档 + 工具本地历史
 *
 * 设计说明(与编辑器工作区 useEditorWorkspaceStore 保持一致的模式):
 * - 不挂 persist 中间件:文档与历史分别经 `config_get` / `config_set` IPC
 *   持久化到 Rust 端 JsonConfigStore(`tool_prefs.json_formatter_docs_v1` /
 *   `tool_prefs.json_formatter_history_v1`),重启后由 `hydrate()` 还原。
 * - `ready` 标志:hydrate 完成后才为 true,组件据此决定是否开始持久化,
 *   避免"启动时用默认空状态覆盖已存数据"。
 * - `userTouched` 标志:hydrate 完成前用户已主动操作时置位;
 *   hydrate 据此保留用户操作,不覆盖。
 * - 历史:工具本地维护完整内容的最近文档快照(全局历史仅存截断预览,
 *   无法还原内容,故不复用);按内容去重、条数与大小编量上限。
 */
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';

/** 单个 JSON 文档(Tab) */
export interface JsonDoc {
  /** 稳定唯一 id(React key / 激活切换定位用) */
  id: string;
  /** Tab 显示名(内容首行派生或 json-N 自动命名,见 autoTitle) */
  title: string;
  /**
   * 自动命名的原始标题(json-N)。仅自动命名 Tab 使用:
   * 输入内容后 title 改为首行派生文本,清空内容时回退到该名,
   * 同时保证新 Tab 的序号分配不因改名而重复。
   */
  autoTitle?: string;
  /** 当前输入文本 */
  content: string;
}

/** 一条本地历史(完整输入内容快照) */
export interface JsonHistoryItem {
  /** 稳定唯一 id */
  id: string;
  /** 列表显示名(内容首行派生) */
  title: string;
  /** 完整输入内容(可还原) */
  content: string;
  /** 记录时间(ms 时间戳) */
  timestamp: number;
}

/** 文档工作区(整体持久化单元) */
export interface FormatterDocs {
  docs: JsonDoc[];
  /** 当前激活文档;无文档时为 null */
  activeDocId: string | null;
}

export const DOCS_CONFIG_KEY = 'tool_prefs.json_formatter_docs_v1';
export const HISTORY_CONFIG_KEY = 'tool_prefs.json_formatter_history_v1';

/** 历史最大条数(超出丢弃最旧) */
export const MAX_HISTORY_ITEMS = 50;
/** 单条历史的最大字符数(超出不入库,避免配置文件膨胀) */
export const MAX_HISTORY_ITEM_CHARS = 256 * 1024;
/**
 * 同一编辑会话的合并窗口(毫秒):最新一条历史在该窗口内的再次记录
 * 视为同一次编辑的连续快照,原位覆盖而非新增,避免打字/粘贴调整期间碎片化。
 */
export const COALESCE_WINDOW_MS = 8000;

/** 未命名 Tab 标题的最大显示长度(超出截断加省略号) */
const TITLE_MAX = 32;

/** 生成稳定唯一 id(Node 22 的 crypto.randomUUID,降级为时间戳+随机) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `json-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 由内容推导标题:取首个非空行并去除首尾空白,超长截断加省略号。
 * 内容为空或全空白时返回 null(回退到自动命名)。
 */
export function deriveTitleFromContent(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX)}…` : trimmed;
    }
  }
  return null;
}

/** 扫描现有文档中最大的 `json-N` 序号,返回下一个可用序号 */
export function nextAutoNumber(docs: readonly JsonDoc[]): number {
  let max = 0;
  for (const d of docs) {
    for (const name of [d.title, d.autoTitle]) {
      const m = /^json-(\d+)$/.exec(name ?? '');
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}

/** 校验一条反序列化出的文档是否结构合法,合法则返回规整后的副本 */
function sanitizeDoc(raw: unknown): JsonDoc | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.title !== 'string' || !t.title) return null;
  const autoTitle = typeof t.autoTitle === 'string' && t.autoTitle ? t.autoTitle : undefined;
  const content = typeof t.content === 'string' ? t.content : '';
  return {
    id: t.id,
    title: t.title,
    ...(autoTitle !== undefined ? { autoTitle } : {}),
    content,
  };
}

/** 将任意反序列化值规整为合法 FormatterDocs,损坏数据逐字段回退默认值 */
export function normalizeDocs(raw: unknown): FormatterDocs {
  if (typeof raw !== 'object' || raw === null) return { docs: [], activeDocId: null };
  const w = raw as Record<string, unknown>;
  const docs = Array.isArray(w.docs)
    ? w.docs.map(sanitizeDoc).filter((d): d is JsonDoc => d !== null)
    : [];
  const activeDocId =
    typeof w.activeDocId === 'string' && docs.some((d) => d.id === w.activeDocId)
      ? w.activeDocId
      : null;
  return { docs, activeDocId };
}

/** 校验一条反序列化出的历史是否结构合法,合法则返回规整后的副本 */
function sanitizeHistoryItem(raw: unknown): JsonHistoryItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const h = raw as Record<string, unknown>;
  if (typeof h.id !== 'string' || !h.id) return null;
  if (typeof h.content !== 'string') return null;
  return {
    id: h.id,
    title:
      typeof h.title === 'string' && h.title
        ? h.title
        : (deriveTitleFromContent(h.content) ?? 'json'),
    content: h.content,
    timestamp: typeof h.timestamp === 'number' ? h.timestamp : 0,
  };
}

/** 将任意反序列化值规整为合法历史数组,损坏数据逐字段过滤 */
export function normalizeHistory(raw: unknown): JsonHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeHistoryItem).filter((h): h is JsonHistoryItem => h !== null);
}

interface JsonFormatterWorkspaceState {
  docs: JsonDoc[];
  activeDocId: string | null;
  history: JsonHistoryItem[];

  /** 是否已完成 hydrate;false 时禁止持久化 */
  ready: boolean;
  /** hydrate 完成前用户是否已主动操作(保留用户操作,不覆盖) */

  userTouched: boolean;
  /** 最近一次持久化错误(仅用于诊断,不影响使用) */
  error: string | null;

  /** 从 Rust config 还原;已还原时再次调用为 no-op */
  hydrate: () => Promise<void>;
  /** 新建空白文档并激活;content 可选(用于从历史/粘贴创建) */
  newDoc: (content?: string) => void;
  /** 关闭文档,激活态自动跳到相邻 */
  closeDoc: (id: string) => void;
  /** 切换激活文档 */
  switchDoc: (id: string) => void;
  /** 更新文档内容(编辑器 onChange 调用);自动命名 Tab 随内容派生标题 */
  setDocContent: (id: string, content: string) => void;
  /**
   * 记录一条历史:按完整内容去重(命中则提升到最前并刷新时间),
   * 空内容 / 超大内容跳过,超出上限丢弃最旧。
   */
  recordHistory: (content: string) => void;
  /** 删除单条历史 */
  removeHistory: (id: string) => void;
  /** 清空全部历史 */
  clearHistory: () => void;
  /** 将当前文档列表写入 Rust config(组件防抖后调用) */
  persistDocs: () => Promise<void>;
  /** 将当前历史写入 Rust config(组件防抖后调用) */
  persistHistory: () => Promise<void>;
}

/** 默认文档 id(store 初始即含一个空文档,避免 hydrate 异步完成前的输入丢失) */
export const DEFAULT_DOC_ID = 'default';

function createDefaultDocs(): FormatterDocs {
  return {
    docs: [{ id: DEFAULT_DOC_ID, title: 'json-1', autoTitle: 'json-1', content: '' }],
    activeDocId: DEFAULT_DOC_ID,
  };
}

export const useJsonFormatterStore = create<JsonFormatterWorkspaceState>((set, get) => ({
  ...createDefaultDocs(),
  history: [],
  ready: false,
  userTouched: false,
  error: null,

  hydrate: async () => {
    // 已还原则不重复读取,防止多次挂载时竞态覆盖用户正在编辑的内容
    if (get().ready) return;
    const [docsRes, historyRes] = await Promise.all([
      safeInvoke<unknown>('config_get', { key: DOCS_CONFIG_KEY }),
      safeInvoke<unknown>('config_get', { key: HISTORY_CONFIG_KEY }),
    ]);
    const restoredDocs = docsRes.ok ? normalizeDocs(docsRes.value) : null;
    const restoredHistory = historyRes.ok ? normalizeHistory(historyRes.value) : null;
    let errorMessage: string | null = null;
    if (!docsRes.ok) errorMessage = docsRes.error.message;
    else if (!historyRes.ok) errorMessage = historyRes.error.message;
    set((s) => {
      // 若 hydrate 完成前用户已主动操作,保留用户操作,避免异步恢复覆盖用户意图
      if (s.userTouched) return { ready: true, error: errorMessage };
      return {
        ready: true,
        error: errorMessage,
        ...(restoredDocs ? { docs: restoredDocs.docs, activeDocId: restoredDocs.activeDocId } : {}),
        ...(restoredHistory ? { history: restoredHistory } : {}),
      };
    });
  },

  newDoc: (content = '') => {
    const { docs } = get();
    const derived = deriveTitleFromContent(content);
    const doc: JsonDoc = {
      id: createId(),
      title: derived ?? `json-${nextAutoNumber(docs)}`,
      ...(derived ? {} : { autoTitle: `json-${nextAutoNumber(docs)}` }),
      content,
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

  setDocContent: (id, content) => {
    const { docs } = get();
    const next = docs.map((d) => {
      if (d.id !== id) return d;
      // 自动命名 Tab(json-N 且未改名):用首行文字做标题;
      // autoTitle 记住原始自动名,清空内容后回退,序号分配不因改名而重复
      if (d.autoTitle !== undefined || /^json-\d+$/.test(d.title)) {
        const autoTitle = d.autoTitle ?? d.title;
        return { ...d, content, autoTitle, title: deriveTitleFromContent(content) ?? autoTitle };
      }
      return { ...d, content };
    });
    set({ docs: next, userTouched: true });
  },

  recordHistory: (content) => {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_HISTORY_ITEM_CHARS) return;
    set((s) => {
      const now = Date.now();
      // 完全相同的内容:仅提升到最前(已是最新则原位刷新时间),不新增条目。
      // 必须先于会话合并判断:否则过滤后 newest 回退到旧条目,误插入重复项。
      const existingIndex = s.history.findIndex((h) => h.content === content);
      if (existingIndex >= 0) {
        const promoted: JsonHistoryItem = { ...s.history[existingIndex], timestamp: now };
        return {
          history: [promoted, ...s.history.filter((_, i) => i !== existingIndex)],
          userTouched: true,
        };
      }
      const newest = s.history[0];
      // 同一编辑会话合并:最新条目在时间窗内的连续变更原位覆盖(内容/标题/时间),
      // 使打字或粘贴调整过程中的自动快照收敛为一条,而不是每次按键新增一条
      if (newest && now - newest.timestamp <= COALESCE_WINDOW_MS) {
        const updated: JsonHistoryItem = {
          ...newest,
          title: deriveTitleFromContent(content) ?? newest.title,
          content,
          timestamp: now,
        };
        return { history: [updated, ...s.history.slice(1)], userTouched: true };
      }
      const item: JsonHistoryItem = {
        id: createId(),
        title: deriveTitleFromContent(content) ?? 'json',
        content,
        timestamp: now,
      };
      return { history: [item, ...s.history].slice(0, MAX_HISTORY_ITEMS), userTouched: true };
    });
  },

  removeHistory: (id) => {
    set((s) => ({ history: s.history.filter((h) => h.id !== id), userTouched: true }));
  },

  clearHistory: () => {
    set({ history: [], userTouched: true });
  },

  persistDocs: async () => {
    // hydrate 完成前不写,避免覆盖已存数据
    const { ready, docs, activeDocId } = get();
    if (!ready) return;
    const r = await safeInvoke<boolean>('config_set', {
      key: DOCS_CONFIG_KEY,
      value: { docs, activeDocId } satisfies FormatterDocs,
    });
    if (!r.ok) set({ error: r.error.message });
  },

  persistHistory: async () => {
    const { ready, history } = get();
    if (!ready) return;
    const r = await safeInvoke<boolean>('config_set', {
      key: HISTORY_CONFIG_KEY,
      value: history,
    });
    if (!r.ok) set({ error: r.error.message });
  },
}));

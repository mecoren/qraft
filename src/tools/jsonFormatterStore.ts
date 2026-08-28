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
 *   注意"用户主动"不含跨工具注入:「发送到…」走 `injectDocFromTool`,
 *   它不置位该标志,hydrate 会把历史文档与历史记录合并回来。
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
   * 手动重命名后清除,后续内容变化不再派生标题。
   */
  autoTitle?: string;
  /** 固定 Tab:始终排在 Tab 栏最前(与编辑器工作区 pinned 语义一致) */
  pinned: boolean;
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
/**
 * 内容派生标题的门槛:首个非空行需超过 3 个字符才会放到 Tab 名位置。
 * 按首行而非全文判断,避免「{ + 多行内容」这类输入把单个 `{` 变成 Tab 名。
 */
const TITLE_MIN_CHARS = 3;

/** 生成稳定唯一 id(Node 22 的 crypto.randomUUID,降级为时间戳+随机) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `json-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 由内容推导标题:取首个非空行并去除首尾空白,超长截断加省略号。
 * 首行为空、全空白或未超过 3 个字符时返回 null(回退到自动命名占位)。
 */
export function deriveTitleFromContent(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      // 首行未超过 3 个字符不派生:避免输入一两个字符就把 Tab 名从 json-N 换成碎片文本
      if (trimmed.length <= TITLE_MIN_CHARS) return null;
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
  // 旧版本持久化数据无 pinned 字段,回退 false 保证兼容
  const pinned = t.pinned === true;
  const content = typeof t.content === 'string' ? t.content : '';
  return {
    id: t.id,
    title: t.title,
    ...(autoTitle !== undefined ? { autoTitle } : {}),
    pinned,
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
  /**
   * 由其他工具注入内容(「发送到…」),写入当前激活文档,行为近似
   * `setDocContent` 但**不**置位 `userTouched`。
   *
   * 原因:这类调用发生在 `JsonFormatter` 懒加载挂载时——`useToolHandoff` 的
   * effect 同步消费载荷,而同一轮挂载里 `hydrate()` 还是个未落地的 Promise。
   * 若按"用户主动操作"处理会让 hydrate 直接放弃持久化数据,上次的文档列表
   * 与整份本地历史随即被防抖 persist 永久覆盖。不置位后由 hydrate 走合并分支。
   */
  injectDocFromTool: (content: string) => void;
  /** 关闭文档,激活态自动跳到相邻 */
  closeDoc: (id: string) => void;
  /** 切换激活文档 */
  switchDoc: (id: string) => void;
  /** 重命名文档 Tab:清除 autoTitle,后续内容变化不再派生标题 */
  renameDoc: (id: string, title: string) => void;
  /** 切换文档 Tab 固定状态(固定 Tab 恒排 Tab 栏最前) */
  togglePinDoc: (id: string) => void;
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
    docs: [
      { id: DEFAULT_DOC_ID, title: 'json-1', autoTitle: 'json-1', pinned: false, content: '' },
    ],
    activeDocId: DEFAULT_DOC_ID,
  };
}

/**
 * 把跨工具注入的内容合并进 hydrate 还原出的文档列表。
 *
 * 只在「userTouched 为 false 但当前文档已有内容」时调用,即内容只可能来自
 * `injectDocFromTool`(其余增删改文档的 action 都会置位 userTouched)。
 * 与编辑器工作区不同:JsonDoc 无 path 字段,无法按路径去重,因此把注入内容
 * 一律作为新文档追加到还原列表末尾并激活;初始那个空白默认文档不参与合并。
 */
function mergeInjectedDocs(restored: FormatterDocs, current: FormatterDocs): FormatterDocs {
  const injected = current.docs.filter((d) => d.content.trim() !== '');
  if (injected.length === 0) return restored;
  const docs = [...restored.docs];
  let activeDocId = restored.activeDocId;
  for (const doc of injected) {
    // 默认文档 id 固定为 DEFAULT_DOC_ID 且会被持久化,还原列表里可能已存在同 id,
    // 撞 id 会导致 React key 冲突与 closeDoc/switchDoc 定位歧义,故换发新 id
    const id = docs.some((d) => d.id === doc.id) ? createId() : doc.id;
    // 自动命名的注入文档沿用还原后列表的序号空间重新编号,避免与还原出的 json-N 撞名
    const autoTitle = doc.autoTitle !== undefined ? `json-${nextAutoNumber(docs)}` : undefined;
    docs.push({
      ...doc,
      id,
      ...(autoTitle !== undefined
        ? { autoTitle, title: deriveTitleFromContent(doc.content) ?? autoTitle }
        : {}),
    });
    activeDocId = id;
  }
  return { docs, activeDocId };
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
      // userTouched 为 false 但文档已有内容:只可能来自跨工具「发送到…」的注入
      // (其余改动文档的 action 都会置位 userTouched),需与持久化列表合并而非互相覆盖
      const merged = restoredDocs
        ? mergeInjectedDocs(restoredDocs, { docs: s.docs, activeDocId: s.activeDocId })
        : null;
      return {
        ready: true,
        error: errorMessage,
        ...(merged ? { docs: merged.docs, activeDocId: merged.activeDocId } : {}),
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
      pinned: false,
      content,
    };
    set((s) => ({
      docs: [...s.docs, doc],
      activeDocId: doc.id,
      userTouched: true,
    }));
  },

  injectDocFromTool: (content) => {
    const { docs, activeDocId } = get();
    // 无激活文档(例如全部关闭后)时新建一个承载注入内容;同样不置位 userTouched
    if (activeDocId === null || !docs.some((d) => d.id === activeDocId)) {
      const derived = deriveTitleFromContent(content);
      const doc: JsonDoc = {
        id: createId(),
        title: derived ?? `json-${nextAutoNumber(docs)}`,
        ...(derived ? {} : { autoTitle: `json-${nextAutoNumber(docs)}` }),
        pinned: false,
        content,
      };
      set((s) => ({ docs: [...s.docs, doc], activeDocId: doc.id }));
      return;
    }
    set((s) => ({
      docs: s.docs.map((d) => {
        if (d.id !== activeDocId) return d;
        // 与 setDocContent 一致:自动命名 Tab 随注入内容派生标题
        if (d.autoTitle !== undefined || /^json-\d+$/.test(d.title)) {
          const autoTitle = d.autoTitle ?? d.title;
          return { ...d, content, autoTitle, title: deriveTitleFromContent(content) ?? autoTitle };
        }
        return { ...d, content };
      }),
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

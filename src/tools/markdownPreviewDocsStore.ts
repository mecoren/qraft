/**
 * Markdown 预览工作区 Store —— 多 Tab 文档
 *
 * 设计说明(与 jsonFormatterStore.ts 保持一致的模式,差异点):
 * - 不挂 persist 中间件:文档列表经 `config_get` / `config_set` IPC 持久化到
 *   Rust 端 JsonConfigStore(`tool_prefs.markdown_preview_docs_v1`),重启后由
 *   `hydrate()` 还原。
 * - 无本地历史概念(草稿即文档,关闭即丢),因此不设 history 相关状态。
 * - 旧版单文档草稿(localStorage `qraft_markdown_draft`)在 hydrate 时一次性
 *   迁移为第一个文档;迁移后清除旧 key,不回写,避免双写竞争。
 * - `ready` / `userTouched` 标志语义与 jsonFormatterStore 一致:hydrate 完成
 *   前禁止持久化;hydrate 前的「发送到…」注入不置位 userTouched,由 hydrate
 *   合并分支保留(见 mergeInjectedDocs)。
 */
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import { DRAFT_STORAGE_KEY } from './markdownPreviewStore';

/** 单个 Markdown 文档(Tab) */
export interface MdDoc {
  /** 稳定唯一 id(React key / 激活切换定位用) */
  id: string;
  /** Tab 显示名(内容首个标题/非空行派生,或 md-N 自动命名) */
  title: string;
  /**
   * 自动命名的原始标题(md-N)。仅自动命名 Tab 使用:
   * 内容变化时 title 派生,清空时回退该名;手动重命名后清除。
   */
  autoTitle?: string;
  /** 固定 Tab:始终排在 Tab 栏最前 */
  pinned: boolean;
  /** 当前输入文本 */
  content: string;
  /**
   * 系统打开标记(openDocFromSystem 创建;瞬时字段,持久化/还原时被
   * sanitizeDoc 剥离)。hydrate 合并注入文档时据此识别系统打开的文档,
   * 使空内容文件(空 .md)也不被 content 非空过滤条件丢弃。
   */
  fromSystem?: true;
}

/** 文档工作区(整体持久化单元) */
export interface MdDocsWorkspace {
  docs: MdDoc[];
  /** 当前激活文档;无文档时为 null */
  activeDocId: string | null;
}

export const MD_DOCS_CONFIG_KEY = 'tool_prefs.markdown_preview_docs_v1';

/** 未命名 Tab 标题的最大显示长度(超出截断加省略号) */
const TITLE_MAX = 32;
/**
 * 内容派生标题的门槛:首个非空行需超过 3 个字符才会放到 Tab 名位置,
 * 避免输入一两个字符就把 Tab 名从 md-N 换成碎片文本。
 */
const TITLE_MIN_CHARS = 3;

/** 生成稳定唯一 id(crypto.randomUUID 不可用时降级为时间戳+随机) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `md-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 由内容推导标题:优先取首个 Markdown 标题行的纯文本(去掉 # 前缀),
 * 否则取首个非空行;超长截断加省略号。无可用行(或未超过 3 字符)返回 null。
 */
export function deriveMdTitle(content: string): string | null {
  for (const line of content.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
    const text = heading ? heading[1].trim() : line.trim();
    if (text) {
      if (text.length <= TITLE_MIN_CHARS) return null;
      return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
    }
  }
  return null;
}

/** 扫描现有文档中最大的 `md-N` 序号,返回下一个可用序号 */
export function nextMdAutoNumber(docs: readonly MdDoc[]): number {
  let max = 0;
  for (const d of docs) {
    for (const name of [d.title, d.autoTitle]) {
      const m = /^md-(\d+)$/.exec(name ?? '');
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}

/** 校验一条反序列化出的文档是否结构合法,合法则返回规整后的副本 */
function sanitizeDoc(raw: unknown): MdDoc | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.title !== 'string' || !t.title) return null;
  const autoTitle = typeof t.autoTitle === 'string' && t.autoTitle ? t.autoTitle : undefined;
  const pinned = t.pinned === true;
  const content = typeof t.content === 'string' ? t.content : '';
  // fromSystem 是会话内瞬时标记,持久化还原时一律剥离(旧数据冗余字段防污染)
  return {
    id: t.id,
    title: t.title,
    ...(autoTitle !== undefined ? { autoTitle } : {}),
    pinned,
    content,
  };
}

/** 将任意反序列化值规整为合法 MdDocsWorkspace,损坏数据逐字段回退默认值 */
export function normalizeMdDocs(raw: unknown): MdDocsWorkspace {
  if (typeof raw !== 'object' || raw === null) return { docs: [], activeDocId: null };
  const w = raw as Record<string, unknown>;
  const docs = Array.isArray(w.docs)
    ? w.docs.map(sanitizeDoc).filter((d): d is MdDoc => d !== null)
    : [];
  const activeDocId =
    typeof w.activeDocId === 'string' && docs.some((d) => d.id === w.activeDocId)
      ? w.activeDocId
      : null;
  return { docs, activeDocId };
}

interface MdDocsState {
  docs: MdDoc[];
  activeDocId: string | null;

  /** 是否已完成 hydrate;false 时禁止持久化 */
  ready: boolean;
  /** hydrate 完成前用户是否已主动操作(保留用户操作,不覆盖) */
  userTouched: boolean;
  /**
   * 是否真正首次使用(无持久化数据且无旧版草稿)。文档列表为空时组件据此
   * 决定填入示例文档(首次使用)还是空白文档(上次主动关闭了全部文档)。
   */
  firstUse: boolean;
  /** 最近一次持久化错误(仅用于诊断,不影响使用) */
  error: string | null;

  /** 从 Rust config 还原;已还原时再次调用为 no-op */
  hydrate: () => Promise<void>;
  /** 新建空白文档并激活;content 可选(用于粘贴/注入创建) */
  newDoc: (content?: string) => void;
  /** 由其他工具注入内容(「发送到…」),不置位 userTouched(语义同 jsonFormatterStore) */
  injectDocFromTool: (content: string) => void;
  /**
   * 由系统触发打开 .md 文件(文件关联/命令行/拖放):作为新文档追加并激活,
   * 不置位 userTouched(语义同编辑器 openLocalFileFromSystem —— hydrate 走
   * mergeInjectedDocs 合并,持久化文档列表不被丢弃)。
   */
  openDocFromSystem: (content: string) => void;
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
  /** 将当前文档列表写入 Rust config(组件防抖后调用) */
  persistDocs: () => Promise<void>;
}

/** 默认文档 id(store 初始即含一个空文档,避免 hydrate 异步完成前的输入丢失) */
export const DEFAULT_MD_DOC_ID = 'md-default';

function createDefaultDocs(): MdDocsWorkspace {
  return {
    docs: [{ id: DEFAULT_MD_DOC_ID, title: 'md-1', autoTitle: 'md-1', pinned: false, content: '' }],
    activeDocId: DEFAULT_MD_DOC_ID,
  };
}

/**
 * 读取旧版 localStorage 单文档草稿:返回「是否存在」与内容。
 * 旧版工具只有一份草稿;key 存在(即使为空串,代表用户明确清空过)即视为有效
 * 旧草稿,迁移为新工作区的唯一文档;迁移后清除旧 key,不再写回。
 */
function readLegacyDraft(): { exists: boolean; content: string } {
  try {
    const v = localStorage.getItem(DRAFT_STORAGE_KEY);
    return v === null ? { exists: false, content: '' } : { exists: true, content: v };
  } catch {
    return { exists: false, content: '' };
  }
}

/** 清除旧版草稿 key(迁移完成后调用;异常静默,不影响主流程) */
function clearLegacyDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // 存储不可用等异常静默忽略
  }
}

/** 旧版 localStorage 单文档草稿 → 首个文档的工作区(迁移基底) */
function legacyWorkspace(content: string): MdDocsWorkspace {
  const derived = content.trim() ? deriveMdTitle(content) : null;
  const doc: MdDoc = {
    id: createId(),
    title: derived ?? 'md-1',
    ...(derived ? {} : { autoTitle: 'md-1' }),
    pinned: false,
    content,
  };
  return { docs: [doc], activeDocId: doc.id };
}

/**
 * 把跨工具注入的内容合并进 hydrate 还原出的文档列表。
 *
 * 只在「userTouched 为 false 但当前文档已有内容」时调用,即内容只可能来自
 * `injectDocFromTool` 或 `openDocFromSystem`(其余增删改文档的 action 都会
 * 置位 userTouched)。注入内容一律作为新文档追加到还原列表末尾并激活
 * (语义同 jsonFormatterStore)。系统打开的空 .md(content 为空)经
 * `fromSystem` 标记同样保留,不被非空过滤条件丢弃。
 */
function mergeInjectedDocs(restored: MdDocsWorkspace, current: MdDocsWorkspace): MdDocsWorkspace {
  const injected = current.docs.filter((d) => d.content.trim() !== '' || d.fromSystem === true);
  if (injected.length === 0) return restored;
  const docs = [...restored.docs];
  let activeDocId = restored.activeDocId;
  for (const doc of injected) {
    // 默认文档 id 固定且会被持久化,还原列表里可能已存在同 id,撞 id 会导致
    // React key 冲突,故换发新 id
    const id = docs.some((d) => d.id === doc.id) ? createId() : doc.id;
    const autoTitle = doc.autoTitle !== undefined ? `md-${nextMdAutoNumber(docs)}` : undefined;
    // 合并进还原列表时剥掉瞬时标记 fromSystem(系统打开语义在此消费完毕)
    const { fromSystem: _fromSystem, ...plain } = doc;
    void _fromSystem;
    docs.push({
      ...plain,
      id,
      ...(autoTitle !== undefined
        ? { autoTitle, title: deriveMdTitle(doc.content) ?? autoTitle }
        : {}),
    });
    activeDocId = id;
  }
  return { docs, activeDocId };
}

export const useMdDocsStore = create<MdDocsState>((set, get) => ({
  ...createDefaultDocs(),
  ready: false,
  userTouched: false,
  firstUse: true,
  error: null,

  hydrate: async () => {
    if (get().ready) return;
    const res = await safeInvoke<unknown>('config_get', { key: MD_DOCS_CONFIG_KEY });
    const errorMessage = res.ok ? null : res.error.message;
    // 持久化文档列表仅当 value 为对象时才算存在;null = key 从未写入(首次使用/旧版本升级)
    const hasPersisted = res.ok && res.value !== null && res.value !== undefined;
    const restored = hasPersisted ? normalizeMdDocs(res.value) : null;
    // 旧版 localStorage 草稿只在 config 无数据时参与迁移,避免两个数据源竞争
    const legacy = hasPersisted ? { exists: false, content: '' } : readLegacyDraft();
    set((s) => {
      // 若 hydrate 完成前用户已主动操作,保留用户操作,避免异步恢复覆盖用户意图
      if (s.userTouched) return { ready: true, error: errorMessage, firstUse: false };
      // userTouched 为 false 但文档已有内容:只可能来自跨工具「发送到…」注入或
      // 系统打开 .md(openDocFromSystem,发生在工具挂载 hydrate 之前),
      // 需与还原列表合并而非互相覆盖。restored 为空列表(上次主动关闭全部文档)
      // 时同样经 mergeInjectedDocs 走「无注入 → 原样返回」路径
      if (restored || legacy.exists) {
        // 旧草稿只在无持久化数据时参与迁移,作为还原列表基底
        const restoredWorkspace: MdDocsWorkspace = restored
          ? restored
          : legacyWorkspace(legacy.content);
        if (!restored) clearLegacyDraft();
        const merged = mergeInjectedDocs(restoredWorkspace, {
          docs: s.docs,
          activeDocId: s.activeDocId,
        });
        return {
          ready: true,
          error: errorMessage,
          docs: merged.docs,
          activeDocId: merged.activeDocId,
          firstUse: false,
        };
      }
      // 真正首次使用(无任何持久化数据):组件 effect 填入示例文档。
      // 但 hydrate 前已有系统打开(openDocFromSystem)注入的文档时,文档列表
      // 非空 —— 直接保留注入结果并清掉 firstUse,避免示例文档覆盖用户
      // 刚打开的 md 内容(注入文档即用户意图,不应再展示首次示例)。
      // 无注入时显式清成空列表(store 初始的默认空文档不属于用户数据),
      // 让组件 effect 按原有 firstUse 语义补示例文档。
      const injected = mergeInjectedDocs(
        { docs: [], activeDocId: null },
        { docs: s.docs, activeDocId: s.activeDocId },
      );
      const hasInjected = injected.docs.length > 0;
      return {
        ready: true,
        error: errorMessage,
        docs: hasInjected ? injected.docs : [],
        activeDocId: hasInjected ? injected.activeDocId : null,
        firstUse: !hasInjected,
      };
    });
  },

  newDoc: (content = '') => {
    const { docs } = get();
    const derived = deriveMdTitle(content);
    const doc: MdDoc = {
      id: createId(),
      title: derived ?? `md-${nextMdAutoNumber(docs)}`,
      ...(derived ? {} : { autoTitle: `md-${nextMdAutoNumber(docs)}` }),
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
      const derived = deriveMdTitle(content);
      const doc: MdDoc = {
        id: createId(),
        title: derived ?? `md-${nextMdAutoNumber(docs)}`,
        ...(derived ? {} : { autoTitle: `md-${nextMdAutoNumber(docs)}` }),
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
        if (d.autoTitle !== undefined || /^md-\d+$/.test(d.title)) {
          const autoTitle = d.autoTitle ?? d.title;
          return { ...d, content, autoTitle, title: deriveMdTitle(content) ?? autoTitle };
        }
        return { ...d, content };
      }),
    }));
  },

  // 系统触发(文件关联/命令行/拖放 .md):追加新文档并激活。
  // userTouched 分两档:hydrate 未完成(ready=false)时保持 false,让 hydrate 走
  // mergeInjectedDocs 合并分支保住持久化文档;ready 后已无合并机会,置位使
  // 防抖 persist 把注入文档落盘(重启不丢)。fromSystem 标记让空 .md 文件
  // 在合并时同样保留(见 mergeInjectedDocs)
  openDocFromSystem: (content) => {
    const { docs, ready } = get();
    const derived = deriveMdTitle(content);
    const doc: MdDoc = {
      id: createId(),
      title: derived ?? `md-${nextMdAutoNumber(docs)}`,
      ...(derived ? {} : { autoTitle: `md-${nextMdAutoNumber(docs)}` }),
      pinned: false,
      content,
      fromSystem: true,
    };
    set((s) => ({
      docs: [...s.docs, doc],
      activeDocId: doc.id,
      ...(ready ? { userTouched: true } : {}),
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
      // 自动命名 Tab(md-N 且未改名):用首个标题/非空行做标题;
      // autoTitle 记住原始自动名,清空内容后回退,序号分配不因改名而重复
      if (d.autoTitle !== undefined || /^md-\d+$/.test(d.title)) {
        const autoTitle = d.autoTitle ?? d.title;
        return { ...d, content, autoTitle, title: deriveMdTitle(content) ?? autoTitle };
      }
      return { ...d, content };
    });
    set({ docs: next, userTouched: true });
  },

  persistDocs: async () => {
    // hydrate 完成前不写,避免覆盖已存数据
    const { ready, docs, activeDocId } = get();
    if (!ready) return;
    // fromSystem 为会话内瞬时标记,落盘前剥离(还原时 sanitizeDoc 亦会兜底剥离)
    const plainDocs = docs.map(({ fromSystem: _fromSystem, ...doc }) => {
      void _fromSystem;
      return doc;
    });
    const r = await safeInvoke<boolean>('config_set', {
      key: MD_DOCS_CONFIG_KEY,
      value: { docs: plainDocs, activeDocId } satisfies MdDocsWorkspace,
    });
    if (!r.ok) set({ error: r.error.message });
  },
}));

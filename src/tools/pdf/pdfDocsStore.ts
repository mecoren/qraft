/**
 * PDF 工具工作区 Store —— 多 Tab 文档
 *
 * 模式与 markdownPreviewDocsStore 一致:
 * - 会话态内存 store:打开的 PDF 字节(base64)与表单/叠加编辑状态驻留内存,
 *   不持久化(20MB 级二进制不宜落 config store;关闭应用即丢弃,同 Monaco Tab
 *   未保存语义由 dirty 标记提示)。
 * - `openPdfFromSystem`:系统入口(文件关联/命令行/拖放)注入新 Tab 并激活;
 *   「拖入文本编辑器编辑框」例外由 App.tsx 路由层处理,store 不感知。
 * - 字节统一以 base64 存储(结构克隆安全,zustand set 可比较),读取方
 *   (PdfViewer / 表单面板)按需解码;持久化直接存 base64 字符串。
 */
import { create } from 'zustand';

/** 单个 PDF 文档(Tab) */
export interface PdfDoc {
  /** 稳定唯一 id(React key / 激活切换定位用) */
  id: string;
  /** Tab 显示名(文件名派生,或 pdf-N 自动命名) */
  title: string;
  /** 来源完整路径;从粘贴/对话框新建(无路径)为 null */
  path: string | null;
  /** 原始文件字节(base64;表单与叠加编辑的保存基底) */
  base64: string;
  /** 文件字节数(展示用) */
  size: number;
  /** 未保存的修改(表单值 / 叠加文本)标记 */
  dirty: boolean;
  /**
   * 编辑序号:markDirty 与字节替换时递增,供 commitSaved 判断落盘快照是否已过期。
   * PDF 的在途编辑态在组件本地(values / overlays),store 无内容可比对,只能用序号。
   */
  rev: number;
}

/** 系统打开载荷:openPdfFromSystem 的入参 */
export interface SystemOpenPdfInput {
  path: string;
  base64: string;
  size: number;
}

interface PdfDocsState {
  docs: PdfDoc[];
  activeDocId: string | null;

  /** 新建空白文档?PDF 无法凭空新建,首开前由组件展示空态引导打开文件 */
  /** 打开 PDF(系统注入):追加新 Tab 并激活 */
  openPdfFromSystem: (input: SystemOpenPdfInput) => void;
  /** 打开 PDF(对话框/工具内操作):同上,但语义来自用户主动操作 */
  openPdfFromUser: (input: Omit<SystemOpenPdfInput, 'path'> & { path: string | null }) => void;
  /** 以内存字节新开 Tab(页面提取/合并的产物;无路径,保存走「另存为」) */
  openPdfBytes: (input: { title: string; base64: string; size: number }) => void;
  /** 关闭文档,激活态自动跳到相邻 */
  closeDoc: (id: string) => void;
  /** 切换激活文档 */
  switchDoc: (id: string) => void;
  /** 标记文档已修改(表单值变更 / 叠加编辑) */
  markDirty: (id: string) => void;
  /**
   * 写回保存结果:仅当 `savedRev` 仍是文档当前序号(即 await 写入期间没有新编辑)时,
   * 才更新字节与大小并清除 dirty;否则磁盘上是过期快照,保留 dirty 与原字节
   * (字节变化会触发按新内容重载,把在途编辑冲掉),只采纳 path。
   */
  commitSaved: (
    id: string,
    base64: string,
    size: number,
    path: string | null,
    savedRev: number,
  ) => void;
}

/** 生成稳定唯一 id(crypto.randomUUID 不可用时降级为时间戳+随机) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 扫描现有文档中最大的 `pdf-N` 序号,返回下一个可用序号 */
export function nextPdfAutoNumber(docs: readonly PdfDoc[]): number {
  let max = 0;
  for (const d of docs) {
    const m = /^pdf-(\d+)$/.exec(d.title);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/** 由路径派生 Tab 标题(文件名,超长截断) */
export function titleFromPath(path: string | null, docs: readonly PdfDoc[]): string {
  if (!path) return `pdf-${nextPdfAutoNumber(docs)}`;
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.length > 40 ? `${name.slice(0, 40)}…` : name;
}

/** 同路径复用既有 Tab(再打开同一文件 = 激活,不重复开) */
export function findDocByPath(docs: readonly PdfDoc[], path: string): PdfDoc | null {
  return docs.find((d) => d.path !== null && samePath(d.path, path)) ?? null;
}

/** 路径比较:分隔符与大小写不敏感(Windows 同一文件可能两种写法) */
export function samePath(a: string, b: string): boolean {
  return a.split('/').join('\\').toLowerCase() === b.split('/').join('\\').toLowerCase();
}

export const usePdfDocsStore = create<PdfDocsState>((set, get) => ({
  docs: [],
  activeDocId: null,

  openPdfFromSystem: ({ path, base64, size }) => {
    const { docs } = get();
    const existing = findDocByPath(docs, path);
    if (existing) {
      // 已打开:重新读取即视为刷新(用户重开文件想看最新内容),覆盖字节并激活
      set((s) => ({
        docs: s.docs.map((d) =>
          d.id === existing.id ? { ...d, base64, size, dirty: false, rev: d.rev + 1 } : d,
        ),
        activeDocId: existing.id,
      }));
      return;
    }
    const doc: PdfDoc = {
      id: createId(),
      title: titleFromPath(path, docs),
      path,
      base64,
      size,
      dirty: false,
      rev: 0,
    };
    set((s) => ({
      docs: [...s.docs, doc],
      activeDocId: doc.id,
    }));
  },

  openPdfFromUser: ({ path, base64, size }) => {
    const { docs } = get();
    if (path !== null) {
      const existing = findDocByPath(docs, path);
      if (existing) {
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === existing.id ? { ...d, base64, size, dirty: false, rev: d.rev + 1 } : d,
          ),
          activeDocId: existing.id,
        }));
        return;
      }
    }
    const doc: PdfDoc = {
      id: createId(),
      title: titleFromPath(path, docs),
      path,
      base64,
      size,
      dirty: false,
      rev: 0,
    };
    set((s) => ({
      docs: [...s.docs, doc],
      activeDocId: doc.id,
    }));
  },

  openPdfBytes: ({ title, base64, size }) => {
    const doc: PdfDoc = {
      id: createId(),
      title,
      path: null,
      base64,
      size,
      dirty: false,
      rev: 0,
    };
    set((s) => ({
      docs: [...s.docs, doc],
      activeDocId: doc.id,
    }));
  },

  closeDoc: (id) => {
    const { docs, activeDocId } = get();
    const index = docs.findIndex((d) => d.id === id);
    if (index < 0) return;
    const rest = docs.filter((d) => d.id !== id);
    const nextActive =
      activeDocId === id ? (rest[Math.min(index, rest.length - 1)]?.id ?? null) : activeDocId;
    set({ docs: rest, activeDocId: nextActive });
  },

  switchDoc: (id) => {
    const { docs } = get();
    if (!docs.some((d) => d.id === id)) return;
    set({ activeDocId: id });
  },

  markDirty: (id) => {
    // 已 dirty 也要递增 rev:否则「dirty 后再次编辑」在保存 await 期间发生时,
    // commitSaved 看不出快照过期,会把新改动清成已保存。
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, dirty: true, rev: d.rev + 1 } : d)),
    }));
  },

  commitSaved: (id, base64, size, path, savedRev) => {
    set((s) => ({
      docs: s.docs.map((d) => {
        if (d.id !== id) return d;
        if (d.rev !== savedRev) {
          // 写入的是过期快照:保持 dirty 与既有字节,仅认下新的保存路径
          return path ? { ...d, path } : d;
        }
        return {
          ...d,
          base64,
          size,
          dirty: false,
          ...(path ? { path } : {}),
        };
      }),
    }));
  },
}));

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
  /** 关闭文档,激活态自动跳到相邻 */
  closeDoc: (id: string) => void;
  /** 切换激活文档 */
  switchDoc: (id: string) => void;
  /** 标记文档已修改(表单值变更 / 叠加编辑) */
  markDirty: (id: string) => void;
  /** 写回保存成功后:更新字节与大小,清除 dirty */
  commitSaved: (id: string, base64: string, size: number, path?: string) => void;
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
        docs: s.docs.map((d) => (d.id === existing.id ? { ...d, base64, size, dirty: false } : d)),
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
            d.id === existing.id ? { ...d, base64, size, dirty: false } : d,
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
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id && !d.dirty ? { ...d, dirty: true } : d)),
    }));
  },

  commitSaved: (id, base64, size, path) => {
    set((s) => ({
      docs: s.docs.map((d) =>
        d.id === id
          ? {
              ...d,
              base64,
              size,
              dirty: false,
              ...(path !== undefined && path ? { path } : {}),
            }
          : d,
      ),
    }));
  },
}));

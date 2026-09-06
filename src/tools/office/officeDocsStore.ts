/**
 * Office 工具工作区 Store —— 多 Tab 文档
 *
 * 模式与 pdfDocsStore 一致:
 * - 会话态内存 store:打开的 Office 文件字节(base64)与编辑状态驻留内存,
 *   不持久化(二进制不宜落 localStorage;关闭应用即丢弃,未保存语义由
 *   dirty 标记提示 —— 当前版本 xlsx 编辑导出走另存,不覆盖原文件)。
 * - `openOfficeFromSystem`:系统入口(文件关联/命令行/拖放)注入新 Tab
 *   并激活;「拖入文本编辑器编辑框」例外由 App.tsx 路由层处理,store 不感知。
 * - 字节统一以 base64 存储(结构克隆安全,zustand set 可比较)。
 */
import { create } from 'zustand';

/** Office 文档的可渲染类别(由扩展名派生) */
export type OfficeKind = 'word' | 'excel' | 'powerpoint' | 'legacy';

/** 单个 Office 文档(Tab) */
export interface OfficeDoc {
  /** 稳定唯一 id(React key / 激活切换定位用) */
  id: string;
  /** Tab 显示名(文件名派生,或 doc-N 自动命名) */
  title: string;
  /** 来源完整路径 */
  path: string;
  /** 原始文件字节(base64;渲染与导出的基底) */
  base64: string;
  /** 文件字节数(展示用) */
  size: number;
  /** 渲染类别(word / excel / powerpoint / legacy 旧二进制格式) */
  kind: OfficeKind;
}

/** 由扩展名派生渲染类别;非白名单扩展名归 legacy(展示转换指引) */
export function officeKindFromPath(path: string): OfficeKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['docx', 'docm', 'doc'].includes(ext)) return ext === 'doc' ? 'legacy' : 'word';
  if (['xlsx', 'xlsm', 'xls'].includes(ext)) return ext === 'xls' ? 'legacy' : 'excel';
  if (['pptx', 'pptm', 'ppt'].includes(ext)) return ext === 'ppt' ? 'legacy' : 'powerpoint';
  return 'legacy';
}

/** 系统打开载荷:openOfficeFromSystem 的入参 */
export interface SystemOpenOfficeInput {
  path: string;
  base64: string;
  size: number;
}

interface OfficeDocsState {
  docs: OfficeDoc[];
  activeDocId: string | null;

  /** 打开 Office 文档(系统注入):同路径复用 Tab(刷新字节),否则追加并激活 */
  openOfficeFromSystem: (input: SystemOpenOfficeInput) => void;
  /** 关闭文档,激活态自动跳到相邻 */
  closeDoc: (id: string) => void;
  /** 切换激活文档 */
  switchDoc: (id: string) => void;
}

/** 生成稳定唯一 id(crypto.randomUUID 不可用时降级为时间戳+随机) */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 路径比较:分隔符与大小写不敏感(Windows 同一文件可能两种写法) */
export function sameOfficePath(a: string, b: string): boolean {
  return a.split('/').join('\\').toLowerCase() === b.split('/').join('\\').toLowerCase();
}

/** 同路径复用既有 Tab(再打开同一文件 = 激活并刷新,不重复开) */
export function findOfficeDocByPath(docs: readonly OfficeDoc[], path: string): OfficeDoc | null {
  return docs.find((d) => sameOfficePath(d.path, path)) ?? null;
}

/** 由路径派生 Tab 标题(文件名,超长截断) */
export function officeTitleFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.length > 40 ? `${name.slice(0, 40)}…` : name;
}

export const useOfficeDocsStore = create<OfficeDocsState>((set, get) => ({
  docs: [],
  activeDocId: null,

  openOfficeFromSystem: ({ path, base64, size }) => {
    const { docs } = get();
    const existing = findOfficeDocByPath(docs, path);
    if (existing) {
      // 已打开:重新读取即视为刷新(用户重开文件想看最新内容),覆盖字节并激活
      set((s) => ({
        docs: s.docs.map((d) => (d.id === existing.id ? { ...d, base64, size } : d)),
        activeDocId: existing.id,
      }));
      return;
    }
    const doc: OfficeDoc = {
      id: createId(),
      title: officeTitleFromPath(path),
      path,
      base64,
      size,
      kind: officeKindFromPath(path),
    };
    set((s) => ({
      docs: [...s.docs, doc],
      activeDocId: doc.id,
    }));
  },

  closeDoc: (id) => {
    set((s) => {
      const idx = s.docs.findIndex((d) => d.id === id);
      if (idx === -1) return s;
      const docs = s.docs.filter((d) => d.id !== id);
      let activeDocId = s.activeDocId;
      if (s.activeDocId === id) {
        activeDocId = docs[Math.min(idx, docs.length - 1)]?.id ?? null;
      }
      return { docs, activeDocId };
    });
  },

  switchDoc: (id) => {
    set((s) => (s.docs.some((d) => d.id === id) ? { activeDocId: id } : s));
  },
}));

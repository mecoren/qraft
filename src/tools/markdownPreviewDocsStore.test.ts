/**
 * openDocFromSystem 契约测试 —— 系统打开 .md 的注入语义
 *
 * 目标行为(App.tsx 的 openFileInMarkdownPreview 依赖):
 * - 追加新文档并激活,不替换/不影响既有文档
 * - hydrate 未完成(ready=false)时不置位 userTouched:
 *   随后的 hydrate 走 mergeInjectedDocs 合并,持久化文档不被丢弃;
 *   无持久化数据(首次使用)时注入文档同样保留,不被 firstUse 示例文档覆盖
 * - ready 后已无合并机会:置位 userTouched 让防抖 persist 落盘
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMdDocsStore } from './markdownPreviewDocsStore';
import type { MdDocsWorkspace } from './markdownPreviewDocsStore';
import { DRAFT_STORAGE_KEY } from './markdownPreviewStore';
import { safeInvoke } from '@/lib/ipc';

vi.mock('@/lib/ipc', () => ({
  safeInvoke: vi.fn(),
}));

const invokeMock = safeInvoke as unknown as ReturnType<typeof vi.fn>;

function resetStore(partial: Partial<Parameters<typeof useMdDocsStore.setState>[0]> = {}): void {
  useMdDocsStore.setState({
    docs: [{ id: 'md-default', title: 'md-1', autoTitle: 'md-1', pinned: false, content: '' }],
    activeDocId: 'md-default',
    ready: false,
    userTouched: false,
    firstUse: false,
    error: null,
    ...partial,
  });
}

describe('openDocFromSystem', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStore();
  });

  it('追加新文档并激活,不影响既有文档', () => {
    useMdDocsStore.getState().openDocFromSystem('# 注入文档\n\n内容');
    const s = useMdDocsStore.getState();
    expect(s.docs).toHaveLength(2);
    const doc = s.docs.find((d) => d.content === '# 注入文档\n\n内容');
    expect(doc).toBeDefined();
    // 标题取首个标题行
    expect(doc?.title).toBe('注入文档');
    expect(s.activeDocId).toBe(doc?.id);
    // 原默认文档仍在
    expect(s.docs.some((d) => d.id === 'md-default')).toBe(true);
  });

  it('hydrate 未完成时调用:不置位 userTouched,后续 hydrate 合并保住持久化文档', async () => {
    useMdDocsStore.getState().openDocFromSystem('# 系统打开');
    expect(useMdDocsStore.getState().userTouched).toBe(false);

    // 持久化数据:一个历史文档;hydrate 应把它还原并把注入文档合并进来
    const persisted: MdDocsWorkspace = {
      docs: [{ id: 'restored-1', title: '历史文档', pinned: false, content: '# 历史' }],
      activeDocId: 'restored-1',
    };
    invokeMock.mockResolvedValue({ ok: true, value: persisted });

    await useMdDocsStore.getState().hydrate();

    const s = useMdDocsStore.getState();
    expect(s.ready).toBe(true);
    // 持久化文档未被丢弃
    expect(s.docs.some((d) => d.id === 'restored-1' && d.content === '# 历史')).toBe(true);
    // 注入文档被合并保留且激活
    const injected = s.docs.find((d) => d.content === '# 系统打开');
    expect(injected).toBeDefined();
    expect(s.activeDocId).toBe(injected?.id);
  });

  it('ready 后调用:置位 userTouched,防抖 persist 可落盘', () => {
    resetStore({ ready: true });
    useMdDocsStore.getState().openDocFromSystem('# 运行中打开');
    expect(useMdDocsStore.getState().userTouched).toBe(true);
  });

  it('首次使用(hydrate 前注入,无持久化数据):注入文档保留,不被示例文档/firstUse 覆盖', async () => {
    useMdDocsStore.getState().openDocFromSystem('# 我刚打开的文档');
    expect(useMdDocsStore.getState().userTouched).toBe(false);

    // 无持久化数据:config_get 返回 null(首次使用)
    invokeMock.mockResolvedValue({ ok: true, value: null });

    await useMdDocsStore.getState().hydrate();

    const s = useMdDocsStore.getState();
    expect(s.ready).toBe(true);
    // 注入文档仍在且激活
    const doc = s.docs.find((d) => d.content === '# 我刚打开的文档');
    expect(doc).toBeDefined();
    expect(s.activeDocId).toBe(doc?.id);
    // firstUse 被清除:组件补位 effect 不会新建示例文档顶掉注入内容
    expect(s.firstUse).toBe(false);
    // 合并进列表后瞬时标记已剥离
    expect(doc?.fromSystem).toBeUndefined();
  });

  it('首次使用且注入空 .md(空内容):文档仍保留,不退回示例文档', async () => {
    useMdDocsStore.getState().openDocFromSystem('');
    invokeMock.mockResolvedValue({ ok: true, value: null });

    await useMdDocsStore.getState().hydrate();

    const s = useMdDocsStore.getState();
    // 空 md 经 fromSystem 标记保留(而非被非空过滤丢弃),不触发示例文档
    expect(s.docs).toHaveLength(1);
    expect(s.docs[0].title).toMatch(/^md-\d+$/);
    expect(s.firstUse).toBe(false);
    expect(s.activeDocId).toBe(s.docs[0].id);
  });

  it('首次使用但无注入:维持原 firstUse 语义(docs 清空,组件补示例文档)', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: null });

    await useMdDocsStore.getState().hydrate();

    const s = useMdDocsStore.getState();
    expect(s.ready).toBe(true);
    expect(s.docs).toEqual([]);
    expect(s.activeDocId).toBeNull();
    expect(s.firstUse).toBe(true);
  });

  it('旧版 localStorage 草稿与 hydrate 前注入并存:合并保留两者', async () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, '# Legacy Draft');
    useMdDocsStore.getState().openDocFromSystem('# 系统打开');
    // config 无持久化数据(null):旧草稿参与迁移
    invokeMock.mockResolvedValue({ ok: true, value: null });

    await useMdDocsStore.getState().hydrate();

    const s = useMdDocsStore.getState();
    expect(s.docs.some((d) => d.content === '# Legacy Draft')).toBe(true);
    const injected = s.docs.find((d) => d.content === '# 系统打开');
    expect(injected).toBeDefined();
    expect(s.activeDocId).toBe(injected?.id);
    // 旧 key 迁移后清除
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('内容无标题行时以首个非空行做标题;内容太短则回退 md-N 自动命名', () => {
    // 首个非空行超过 3 字符:直接做 Tab 标题,无 autoTitle(不随内容改写)
    useMdDocsStore.getState().openDocFromSystem('只是普通文本');
    const doc = useMdDocsStore.getState().docs.find((d) => d.content === '只是普通文本');
    expect(doc?.title).toBe('只是普通文本');
    expect(doc?.autoTitle).toBeUndefined();
    // 内容过短(≤3 字符)不派生标题:回退 md-N 自动命名
    useMdDocsStore.getState().openDocFromSystem('ab');
    const fallback = useMdDocsStore.getState().docs.find((d) => d.content === 'ab');
    expect(fallback?.title).toMatch(/^md-\d+$/);
    expect(fallback?.autoTitle).toBe(fallback?.title);
  });
});

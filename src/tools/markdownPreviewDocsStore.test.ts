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

  it('携带文件载荷(拖放/关联打开):走绑定语义,同路径去重刷新而非重复 Tab', () => {
    const s = useMdDocsStore.getState();
    // 第一次:绑定路径,Tab 名取文件名,记录编码与 mtime 基准
    s.openDocFromSystem('v0', {
      path: 'C:\\docs\\drop.md',
      content: 'v0',
      encoding: 'utf-8',
      mtimeMs: 10,
    });
    const first = useMdDocsStore.getState().docs.find((d) => d.path === 'C:\\docs\\drop.md');
    expect(first).toBeDefined();
    expect(first?.title).toBe('drop.md');
    expect(first?.encoding).toBe('utf-8');
    expect(first?.mtimeMs).toBe(10);
    expect(first?.savedContent).toBe('v0');
    expect(useMdDocsStore.getState().activeDocId).toBe(first?.id);

    // 同路径再次打开(外部修改后重拖):刷新该文档而非新增 Tab
    s.openDocFromSystem('v1', {
      path: 'C:\\docs\\drop.md',
      content: 'v1',
      encoding: 'utf-8',
      mtimeMs: 11,
    });
    const after = useMdDocsStore.getState();
    expect(after.docs.filter((d) => d.path === 'C:\\docs\\drop.md')).toHaveLength(1);
    const refreshed = after.docs.find((d) => d.path === 'C:\\docs\\drop.md');
    expect(refreshed?.content).toBe('v1');
    expect(refreshed?.mtimeMs).toBe(11);
  });

  it('无载荷(纯内容注入)保持既有非绑定语义:不设 path/savedContent', () => {
    useMdDocsStore.getState().openDocFromSystem('# 纯内容');
    const doc = useMdDocsStore.getState().docs.find((d) => d.content === '# 纯内容');
    expect(doc?.path).toBeUndefined();
    expect(doc?.savedContent).toBeUndefined();
  });
});

describe('文件绑定(openFileAsDoc / attachPath / markSaved)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ ok: true, value: true });
    useMdDocsStore.setState({
      docs: [{ id: 'md-default', title: 'md-1', autoTitle: 'md-1', pinned: false, content: '' }],
      activeDocId: 'md-default',
      ready: true,
      userTouched: false,
      firstUse: false,
      error: null,
    });
  });

  it('openFileAsDoc:新路径追加文档并激活,Tab 名取文件名,快照与 mtime 记录', () => {
    useMdDocsStore.getState().openFileAsDoc({
      path: 'C:\\docs\\我的笔记.md',
      content: '# 笔记',
      encoding: 'utf-8',
      mtimeMs: 1234,
    });
    const s = useMdDocsStore.getState();
    expect(s.docs).toHaveLength(2);
    const doc = s.docs[1];
    expect(doc.title).toBe('我的笔记.md');
    expect(doc.path).toBe('C:\\docs\\我的笔记.md');
    expect(doc.encoding).toBe('utf-8');
    expect(doc.mtimeMs).toBe(1234);
    expect(doc.savedContent).toBe('# 笔记');
    expect(s.activeDocId).toBe(doc.id);
    // 用户主动打开:置位 userTouched
    expect(s.userTouched).toBe(true);
  });

  it('openFileAsDoc:同路径文档已存在时重读刷新内容与基准,不追加新 Tab', () => {
    useMdDocsStore.getState().openFileAsDoc({
      path: 'C:\\docs\\a.md',
      content: 'v1',
      encoding: 'utf-8',
      mtimeMs: 100,
    });
    // 编辑偏离磁盘(制造 dirty)
    useMdDocsStore.getState().setDocContent(useMdDocsStore.getState().activeDocId!, 'v1 改');
    // 重新打开同路径:磁盘内容刷回,savedContent 同步刷新(dirty 消除)
    useMdDocsStore.getState().openFileAsDoc({
      path: 'C:\\docs\\a.md',
      content: 'v2',
      encoding: 'utf-8',
      mtimeMs: 200,
    });
    const s = useMdDocsStore.getState();
    expect(s.docs).toHaveLength(2); // 原默认 + 一个文件文档,未新增
    const doc = s.docs[1];
    expect(doc.content).toBe('v2');
    expect(doc.savedContent).toBe('v2');
    expect(doc.mtimeMs).toBe(200);
  });

  it('attachPath:纯草稿另存为后绑定路径,标题切为文件名且内容派生让位', () => {
    const s0 = useMdDocsStore.getState();
    useMdDocsStore.getState().setDocContent(s0.activeDocId!, '# 草稿标题');
    const id = useMdDocsStore.getState().activeDocId!;
    useMdDocsStore.getState().attachPath(id, 'C:\\docs\\saved.md', 'utf-8', 999);
    const doc = useMdDocsStore.getState().docs.find((d) => d.id === id);
    expect(doc?.path).toBe('C:\\docs\\saved.md');
    expect(doc?.title).toBe('saved.md');
    expect(doc?.autoTitle).toBeUndefined();
    expect(doc?.savedContent).toBe('# 草稿标题');
    // 后续内容变化不再改写 Tab 名(文件名优先),但 dirty 生效
    useMdDocsStore.getState().setDocContent(id, '# 草稿标题 改');
    expect(useMdDocsStore.getState().docs.find((d) => d.id === id)?.title).toBe('saved.md');
  });

  it('markSaved:刷新 savedContent 快照与 mtime;dirty 判定随内容变化', () => {
    useMdDocsStore.getState().openFileAsDoc({
      path: 'C:\\docs\\b.md',
      content: 'base',
      encoding: 'utf-8',
      mtimeMs: 1,
    });
    const id = useMdDocsStore.getState().activeDocId!;
    // 打开后干净
    let doc = useMdDocsStore.getState().docs.find((d) => d.id === id);
    expect(doc?.content === doc?.savedContent).toBe(true);
    // 编辑 → dirty
    useMdDocsStore.getState().setDocContent(id, 'base 改');
    doc = useMdDocsStore.getState().docs.find((d) => d.id === id);
    expect(doc?.content !== doc?.savedContent).toBe(true);
    // 保存成功 → 快照刷新、dirty 消除
    useMdDocsStore.getState().markSaved(id, 42);
    doc = useMdDocsStore.getState().docs.find((d) => d.id === id);
    expect(doc?.savedContent).toBe('base 改');
    expect(doc?.mtimeMs).toBe(42);
    expect(doc?.content === doc?.savedContent).toBe(true);
  });

  it('持久化往返:path/encoding/mtimeMs/savedContent 一并还原(sanitizeDoc)', async () => {
    useMdDocsStore.getState().openFileAsDoc({
      path: 'C:\\docs\\c.md',
      content: '# 还原',
      encoding: 'gb18030',
      mtimeMs: 77,
    });
    // 组件防抖 persist 最终调 config_set;直接驱动一次 persistDocs
    await useMdDocsStore.getState().persistDocs();
    const payload = invokeMock.mock.calls.find((c) => c[0] === 'config_set')?.[1];
    expect(payload?.value.docs[1].path).toBe('C:\\docs\\c.md');
    expect(payload?.value.docs[1].encoding).toBe('gb18030');
    expect(payload?.value.docs[1].mtimeMs).toBe(77);
    expect(payload?.value.docs[1].savedContent).toBe('# 还原');
  });

  it('hydrate 还原带 path 的文档:字段完整还原', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      value: {
        docs: [
          {
            id: 'f-1',
            title: 'file.md',
            pinned: false,
            content: '# F',
            path: 'C:\\docs\\file.md',
            encoding: 'utf-8',
            mtimeMs: 5,
            savedContent: '# F',
          },
        ],
        activeDocId: 'f-1',
      },
    });
    useMdDocsStore.setState({ ready: false, userTouched: false });
    await useMdDocsStore.getState().hydrate();
    const doc = useMdDocsStore.getState().docs[0];
    expect(doc.path).toBe('C:\\docs\\file.md');
    expect(doc.encoding).toBe('utf-8');
    expect(doc.mtimeMs).toBe(5);
    expect(doc.savedContent).toBe('# F');
    // fromSystem 瞬时标记仍被剥离
    expect(doc.fromSystem).toBeUndefined();
  });

  it('损坏数据兜底:path 非法(空串/非字符串)时绑定字段整体丢弃,文档保留', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      value: {
        docs: [
          {
            id: 'broken',
            title: 'Broken',
            pinned: false,
            content: 'x',
            path: '',
            mtimeMs: 1,
          },
        ],
        activeDocId: 'broken',
      },
    });
    useMdDocsStore.setState({ ready: false, userTouched: false });
    await useMdDocsStore.getState().hydrate();
    const doc = useMdDocsStore.getState().docs[0];
    expect(doc.id).toBe('broken');
    expect(doc.content).toBe('x');
    expect(doc.path).toBeUndefined();
    expect(doc.mtimeMs).toBeUndefined();
  });
});

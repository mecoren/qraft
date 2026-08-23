import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import {
  COALESCE_WINDOW_MS,
  DOCS_CONFIG_KEY,
  HISTORY_CONFIG_KEY,
  MAX_HISTORY_ITEMS,
  MAX_HISTORY_ITEM_CHARS,
  deriveTitleFromContent,
  nextAutoNumber,
  normalizeDocs,
  normalizeHistory,
  useJsonFormatterStore,
  type JsonDoc,
} from './jsonFormatterStore';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

/** 重置为「单个空白文档」初始态(zustand 模块级单例,避免用例间污染) */
function resetStore(): void {
  useJsonFormatterStore.setState({
    docs: [{ id: 'default', title: 'json-1', autoTitle: 'json-1', content: '' }],
    activeDocId: 'default',
    history: [],
    ready: false,
    userTouched: false,
    error: null,
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  resetStore();
});

describe('deriveTitleFromContent', () => {
  it('derives the first non-empty line and truncates long lines', () => {
    expect(deriveTitleFromContent('\n  {"a":1}  \n')).toBe('{"a":1}');
    const long = 'x'.repeat(40);
    const title = deriveTitleFromContent(long);
    expect(title).toBe(`${'x'.repeat(32)}…`);
    expect(title?.length).toBe(33);
  });

  it('returns null for blank content', () => {
    expect(deriveTitleFromContent('')).toBeNull();
    expect(deriveTitleFromContent('  \n\t ')).toBeNull();
  });
});

describe('nextAutoNumber', () => {
  it('scans both title and autoTitle for json-N and returns max + 1', () => {
    const docs = [
      { id: 'a', title: 'json-3', autoTitle: 'json-7', content: '' },
      { id: 'b', title: 'renamed', autoTitle: undefined, content: '' },
      { id: 'c', title: '{"x":1}', autoTitle: 'json-2', content: '{"x":1}' },
    ] as unknown as JsonDoc[];
    expect(nextAutoNumber(docs)).toBe(8);
  });

  it('returns 1 for empty docs', () => {
    expect(nextAutoNumber([])).toBe(1);
  });
});

describe('normalizeDocs / normalizeHistory', () => {
  it('falls back to defaults for invalid payloads', () => {
    expect(normalizeDocs(null)).toEqual({ docs: [], activeDocId: null });
    expect(normalizeDocs({ docs: 'nope' })).toEqual({ docs: [], activeDocId: null });
    // activeTabId 不在 docs 中 → 置 null
    const w = normalizeDocs({
      docs: [{ id: 'd1', title: 't', content: '{}' }, 'broken'],
      activeDocId: 'missing',
    });
    expect(w.docs.map((d) => d.id)).toEqual(['d1']);
    expect(w.activeDocId).toBeNull();
  });

  it('filters broken history entries and fills defaults', () => {
    const items = normalizeHistory([
      { id: 'h1', content: '{"a":1}' },
      { id: '', content: 'x' },
      null,
      { id: 'h2' },
      'raw',
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('{"a":1}');
    expect(items[0].timestamp).toBe(0);
  });
});

describe('document tabs', () => {
  it('newDoc names blank docs json-N and activates them; typed content derives the title', () => {
    const s0 = useJsonFormatterStore.getState();
    s0.newDoc(); // 默认 json-1 已存在 → 新建为 json-2
    let s = useJsonFormatterStore.getState();
    expect(s.docs).toHaveLength(2);
    expect(s.docs[1].title).toBe('json-2');
    expect(s.activeDocId).toBe(s.docs[1].id);

    s.setDocContent(s.docs[1].id, '\n{"typed":true}');
    s = useJsonFormatterStore.getState();
    expect(s.docs[1].title).toBe('{"typed":true}');
    // 清空内容回退到原始自动名
    s.setDocContent(s.docs[1].id, '');
    s = useJsonFormatterStore.getState();
    expect(s.docs[1].title).toBe('json-2');
  });

  it('closeDoc activates the right neighbor first, then left; last close clears activation', () => {
    const s0 = useJsonFormatterStore.getState();
    s0.newDoc();
    s0.newDoc();
    let s = useJsonFormatterStore.getState();
    const [d0, d1, d2] = s.docs;
    // 关闭中间 → 激活右邻
    s.closeDoc(d1.id);
    s = useJsonFormatterStore.getState();
    expect(s.docs.map((d) => d.id)).toEqual([d0.id, d2.id]);
    expect(s.activeDocId).toBe(d2.id);
    // 全部关闭 → 无激活
    s.closeDoc(d0.id);
    s.closeDoc(d2.id);
    s = useJsonFormatterStore.getState();
    expect(s.docs).toHaveLength(0);
    expect(s.activeDocId).toBeNull();
  });

  it('switchDoc ignores unknown ids', () => {
    const s = useJsonFormatterStore.getState();
    s.switchDoc('nope');
    expect(useJsonFormatterStore.getState().activeDocId).toBe('default');
  });
});

describe('recordHistory', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 开启假时钟并从 t=0 开始 */
  function useClock(): void {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  }

  it('coalesces rapid consecutive changes into a single entry', () => {
    useClock();
    const s = useJsonFormatterStore.getState();
    s.recordHistory('{"a":1}');
    vi.setSystemTime(3000);
    s.recordHistory('{"a":12}');
    vi.setSystemTime(6000);
    s.recordHistory('{"a":123}');
    const { history } = useJsonFormatterStore.getState();
    // 打字/粘贴调整期间的自动快照收敛为一条
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('{"a":123}');
    expect(history[0].timestamp).toBe(6000);
  });

  it('starts a new entry once the coalesce window elapses', () => {
    useClock();
    const s = useJsonFormatterStore.getState();
    s.recordHistory('A');
    vi.setSystemTime(COALESCE_WINDOW_MS + 1);
    s.recordHistory('B');
    const { history } = useJsonFormatterStore.getState();
    expect(history.map((h) => h.content)).toEqual(['B', 'A']);
  });

  it('re-recording identical content promotes/refreshes instead of duplicating', () => {
    useClock();
    const s = useJsonFormatterStore.getState();
    s.recordHistory('A');
    vi.setSystemTime(COALESCE_WINDOW_MS + 1);
    s.recordHistory('B');
    vi.setSystemTime(2 * (COALESCE_WINDOW_MS + 1));
    s.recordHistory('A'); // 精确匹配旧条目:提升到最前并刷新时间,不新增
    const { history } = useJsonFormatterStore.getState();
    expect(history.map((h) => h.content)).toEqual(['A', 'B']);
    expect(history[0].timestamp).toBe(2 * (COALESCE_WINDOW_MS + 1));
  });

  it('caps size across distinct sessions', () => {
    useClock();
    for (let i = 0; i < MAX_HISTORY_ITEMS + 5; i++) {
      // 每次推进到窗口之外,确保各自成条目
      vi.setSystemTime(i * (COALESCE_WINDOW_MS + 1000));
      useJsonFormatterStore.getState().recordHistory(`item-${i}`);
    }
    const { history } = useJsonFormatterStore.getState();
    expect(history).toHaveLength(MAX_HISTORY_ITEMS);
    expect(history[0].content).toBe(`item-${MAX_HISTORY_ITEMS + 4}`);
  });

  it('skips empty or oversized contents', () => {
    const s = useJsonFormatterStore.getState();
    s.recordHistory('   ');
    s.recordHistory('x'.repeat(MAX_HISTORY_ITEM_CHARS + 1));
    expect(useJsonFormatterStore.getState().history).toHaveLength(0);
  });

  it('removes single entries and clears all', () => {
    useClock();
    const s = useJsonFormatterStore.getState();
    s.recordHistory('A');
    vi.setSystemTime(COALESCE_WINDOW_MS + 1);
    s.recordHistory('B');
    const { history } = useJsonFormatterStore.getState();
    expect(history.map((h) => h.content)).toEqual(['B', 'A']);
    useJsonFormatterStore.getState().removeHistory(history[0].id);
    expect(useJsonFormatterStore.getState().history.map((h) => h.content)).toEqual(['A']);
    useJsonFormatterStore.getState().clearHistory();
    expect(useJsonFormatterStore.getState().history).toHaveLength(0);
  });
});

describe('hydrate / persist', () => {
  it('restores docs and history from config_get', async () => {
    invokeMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          docs: [{ id: 'd1', title: 'saved', content: '{"v":1}' }],
          activeDocId: 'd1',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 'h1', title: 'saved', content: '{"v":1}', timestamp: 123 }],
      });

    await useJsonFormatterStore.getState().hydrate();
    const s = useJsonFormatterStore.getState();
    expect(invokeMock).toHaveBeenCalledWith('config_get', { key: DOCS_CONFIG_KEY });
    expect(invokeMock).toHaveBeenCalledWith('config_get', { key: HISTORY_CONFIG_KEY });
    expect(s.ready).toBe(true);
    expect(s.docs.map((d) => d.id)).toEqual(['d1']);
    expect(s.activeDocId).toBe('d1');
    expect(s.history).toHaveLength(1);
    expect(s.error).toBeNull();
  });

  it('keeps user changes when touched before hydrate completes', async () => {
    useJsonFormatterStore.setState({
      userTouched: true,
      docs: [{ id: 'u1', title: 'mine', content: 'user-typed' }],
      activeDocId: 'u1',
    });
    invokeMock.mockResolvedValue({ success: true, data: { docs: [], activeDocId: null } });

    await useJsonFormatterStore.getState().hydrate();
    const s = useJsonFormatterStore.getState();
    expect(s.ready).toBe(true);
    expect(s.docs.map((d) => d.id)).toEqual(['u1']);
  });

  it('sets error but stays usable on failure', async () => {
    invokeMock.mockRejectedValue(new Error('ipc down'));
    await useJsonFormatterStore.getState().hydrate();
    const s = useJsonFormatterStore.getState();
    expect(s.ready).toBe(true);
    expect(s.error).toBeTruthy();
    // 默认空白文档仍在
    expect(s.docs.map((d) => d.id)).toEqual(['default']);
  });

  it('is a no-op once ready', async () => {
    useJsonFormatterStore.setState({ ready: true });
    await useJsonFormatterStore.getState().hydrate();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('persistDocs skips before ready and writes payload after ready', async () => {
    await useJsonFormatterStore.getState().persistDocs();
    expect(invokeMock).not.toHaveBeenCalled();

    useJsonFormatterStore.setState({ ready: true });
    await useJsonFormatterStore.getState().persistDocs();
    expect(invokeMock).toHaveBeenCalledWith('config_set', {
      key: DOCS_CONFIG_KEY,
      value: {
        docs: [{ id: 'default', title: 'json-1', autoTitle: 'json-1', content: '' }],
        activeDocId: 'default',
      },
    });
  });

  it('persistHistory writes the array after ready', async () => {
    useJsonFormatterStore.setState({ ready: true });
    useJsonFormatterStore.getState().recordHistory('{"k":1}');
    invokeMock.mockClear();
    await useJsonFormatterStore.getState().persistHistory();
    expect(invokeMock).toHaveBeenCalledWith('config_set', {
      key: HISTORY_CONFIG_KEY,
      value: [expect.objectContaining({ content: '{"k":1}' })],
    });
  });
});

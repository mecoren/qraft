/**
 * 文本比较工作区 store 单测 —— 新增动作与持久化防护
 *
 * 覆盖:setDocSideFile(内容+文件名+标题派生)、swapDocSides(内容与
 * 文件名互换)、capDocForPersist 持久化载荷截断(config.json 防撑爆)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import { DOCS_CONFIG_KEY, MAX_PERSIST_SIDE_CHARS, useTextCompareStore } from './textCompareStore';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function resetStore(): void {
  useTextCompareStore.setState({
    docs: [
      {
        id: 'default',
        title: 'compare-1',
        autoTitle: 'compare-1',
        pinned: false,
        original: '',
        modified: '',
      },
    ],
    activeDocId: 'default',
    ready: false,
    userTouched: false,
    error: null,
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  resetStore();
});

describe('setDocSideFile', () => {
  it('写入内容并记录文件名;原始侧自动命名 Tab 标题改为文件名', () => {
    useTextCompareStore.getState().setDocSideFile('default', 'original', 'body {}', 'a.json');
    const doc = useTextCompareStore.getState().docs[0]!;
    expect(doc.original).toBe('body {}');
    expect(doc.originalFileName).toBe('a.json');
    expect(doc.title).toBe('a.json');
    // autoTitle 保留:清空后仍可回退 compare-N
    expect(doc.autoTitle).toBe('compare-1');
  });

  it('修改侧记录文件名但不改标题(标题锚定原始侧)', () => {
    useTextCompareStore.getState().setDocSideFile('default', 'modified', 'body {}', 'b.json');
    const doc = useTextCompareStore.getState().docs[0]!;
    expect(doc.modified).toBe('body {}');
    expect(doc.modifiedFileName).toBe('b.json');
    expect(doc.title).toBe('compare-1');
  });

  it('fileName=null 清除来源记录(替换文件语义)', () => {
    useTextCompareStore.getState().setDocSideFile('default', 'modified', 'x', 'b.json');
    useTextCompareStore.getState().setDocSideFile('default', 'modified', 'y', null);
    const doc = useTextCompareStore.getState().docs[0]!;
    expect(doc.modified).toBe('y');
    expect(doc.modifiedFileName).toBeUndefined();
  });

  it('手输编辑(setDocContent)不清除已记录的文件名', () => {
    useTextCompareStore.getState().setDocSideFile('default', 'modified', 'x', 'b.json');
    useTextCompareStore.getState().setDocContent('default', 'modified', 'edited');
    expect(useTextCompareStore.getState().docs[0]!.modifiedFileName).toBe('b.json');
  });
});

describe('swapDocSides', () => {
  it('两侧内容与来源文件名整体互换', () => {
    useTextCompareStore.setState({
      docs: [
        {
          id: 's',
          title: 't',
          pinned: false,
          original: 'AAA',
          modified: 'BBB',
          originalFileName: 'l.txt',
          modifiedFileName: 'r.txt',
        },
      ],
      activeDocId: 's',
    });
    useTextCompareStore.getState().swapDocSides('s');
    const doc = useTextCompareStore.getState().docs[0]!;
    expect(doc.original).toBe('BBB');
    expect(doc.modified).toBe('AAA');
    expect(doc.originalFileName).toBe('r.txt');
    expect(doc.modifiedFileName).toBe('l.txt');
    // 标题/pinned 等其余字段不动
    expect(doc.title).toBe('t');
    expect(doc.pinned).toBe(false);
  });
});

describe('persistDocs 载荷防护', () => {
  it('超限侧内容落盘前截断到上限(Tab 结构保留)', async () => {
    const huge = 'x'.repeat(MAX_PERSIST_SIDE_CHARS + 1000);
    useTextCompareStore.setState({
      docs: [
        {
          id: 'default',
          title: 'compare-1',
          autoTitle: 'compare-1',
          pinned: false,
          original: huge,
          modified: 'small',
        },
      ],
      activeDocId: 'default',
      ready: true,
      userTouched: true,
    });
    invokeMock.mockResolvedValue({ success: true, data: true });
    await useTextCompareStore.getState().persistDocs();
    const calls = invokeMock.mock.calls as unknown[][];
    const payload = calls[calls.length - 1]![1] as {
      key: string;
      value: { docs: Array<{ original: string; modified: string; title: string }> };
    };
    expect(payload.key).toBe(DOCS_CONFIG_KEY);
    const doc = payload.value.docs[0]!;
    expect(doc.original).toHaveLength(MAX_PERSIST_SIDE_CHARS);
    expect(doc.modified).toBe('small');
    expect(doc.title).toBe('compare-1');
    // 内存态不受截断影响
    expect(useTextCompareStore.getState().docs[0]!.original).toHaveLength(
      MAX_PERSIST_SIDE_CHARS + 1000,
    );
  });
});

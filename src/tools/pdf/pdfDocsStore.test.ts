import { beforeEach, describe, expect, it } from 'vitest';
import {
  findDocByPath,
  nextPdfAutoNumber,
  samePath,
  titleFromPath,
  usePdfDocsStore,
} from './pdfDocsStore';

/** 重置 store 到初始空态(用例间隔离) */
function resetStore(): void {
  usePdfDocsStore.setState({ docs: [], activeDocId: null });
}

describe('nextPdfAutoNumber', () => {
  it('空列表从 1 开始', () => {
    expect(nextPdfAutoNumber([])).toBe(1);
  });

  it('取既有 pdf-N 的最大序号 +1', () => {
    const docs = [
      { id: 'a', title: 'pdf-1', path: null, base64: '', size: 0, dirty: false },
      { id: 'b', title: 'pdf-3', path: null, base64: '', size: 0, dirty: false },
    ];
    expect(nextPdfAutoNumber(docs)).toBe(4);
  });

  it('文件名 Tab 不影响序号', () => {
    const docs = [{ id: 'a', title: '合同.pdf', path: null, base64: '', size: 0, dirty: false }];
    expect(nextPdfAutoNumber(docs)).toBe(1);
  });
});

describe('samePath', () => {
  it('分隔符与大小写不敏感', () => {
    expect(samePath('C:\\Docs\\A.pdf', 'c:/docs/a.pdf')).toBe(true);
    expect(samePath('C:\\Docs\\A.pdf', 'C:\\Docs\\B.pdf')).toBe(false);
  });
});

describe('titleFromPath', () => {
  it('取文件名(Windows / Unix 分隔符)', () => {
    expect(titleFromPath('C:\\Docs\\合同.pdf', [])).toBe('合同.pdf');
    expect(titleFromPath('/home/user/report.pdf', [])).toBe('report.pdf');
  });

  it('无路径时自动命名 pdf-N', () => {
    expect(titleFromPath(null, [])).toBe('pdf-1');
  });
});

describe('pdfDocsStore', () => {
  beforeEach(resetStore);

  it('openPdfFromSystem 追加 Tab 并激活', () => {
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'C:\\Docs\\a.pdf',
      base64: 'AAAA',
      size: 3,
    });
    const s = usePdfDocsStore.getState();
    expect(s.docs).toHaveLength(1);
    expect(s.docs[0].title).toBe('a.pdf');
    expect(s.activeDocId).toBe(s.docs[0].id);
    expect(s.docs[0].dirty).toBe(false);
  });

  it('同路径再打开:复用 Tab 并刷新字节', () => {
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'C:\\Docs\\a.pdf',
      base64: 'AAAA',
      size: 3,
    });
    const firstId = usePdfDocsStore.getState().docs[0].id;
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'c:/docs/a.pdf', // 分隔符/大小写差异视为同路径
      base64: 'BBBBBBBB',
      size: 6,
    });
    const s = usePdfDocsStore.getState();
    expect(s.docs).toHaveLength(1);
    expect(s.docs[0].id).toBe(firstId);
    expect(s.docs[0].base64).toBe('BBBBBBBB');
    expect(s.docs[0].size).toBe(6);
  });

  it('不同路径打开多个 Tab;激活态随最新', () => {
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'C:\\a.pdf',
      base64: 'A',
      size: 1,
    });
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'C:\\b.pdf',
      base64: 'B',
      size: 1,
    });
    const s = usePdfDocsStore.getState();
    expect(s.docs).toHaveLength(2);
    expect(s.activeDocId).toBe(s.docs[1].id);
  });

  it('markDirty 置位;commitSaved 清除并更新字节', () => {
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'C:\\a.pdf',
      base64: 'A',
      size: 1,
    });
    const id = usePdfDocsStore.getState().docs[0].id;
    usePdfDocsStore.getState().markDirty(id);
    expect(usePdfDocsStore.getState().docs[0].dirty).toBe(true);

    usePdfDocsStore.getState().commitSaved(id, 'SAVED', 5);
    const doc = usePdfDocsStore.getState().docs[0];
    expect(doc.dirty).toBe(false);
    expect(doc.base64).toBe('SAVED');
    expect(doc.size).toBe(5);
  });

  it('closeDoc 后激活态跳到相邻 Tab', () => {
    usePdfDocsStore.getState().openPdfFromSystem({ path: 'C:\\a.pdf', base64: 'A', size: 1 });
    usePdfDocsStore.getState().openPdfFromSystem({ path: 'C:\\b.pdf', base64: 'B', size: 1 });
    usePdfDocsStore.getState().openPdfFromSystem({ path: 'C:\\c.pdf', base64: 'C', size: 1 });
    const [a, b, c] = usePdfDocsStore.getState().docs;
    usePdfDocsStore.getState().closeDoc(b.id); // 关中间
    const s1 = usePdfDocsStore.getState();
    expect(s1.docs.map((d) => d.id)).toEqual([a.id, c.id]);
    expect(s1.activeDocId).toBe(c.id);

    usePdfDocsStore.getState().closeDoc(a.id); // 关相邻
    expect(usePdfDocsStore.getState().activeDocId).toBe(c.id);
    usePdfDocsStore.getState().closeDoc(c.id); // 全关
    const s2 = usePdfDocsStore.getState();
    expect(s2.docs).toHaveLength(0);
    expect(s2.activeDocId).toBeNull();
  });

  it('findDocByPath 按归一化路径查找', () => {
    usePdfDocsStore.getState().openPdfFromSystem({
      path: 'C:\\Docs\\表单.pdf',
      base64: 'A',
      size: 1,
    });
    const docs = usePdfDocsStore.getState().docs;
    expect(findDocByPath(docs, 'c:/docs/表单.PDF')).not.toBeNull();
    expect(findDocByPath(docs, 'C:\\other.pdf')).toBeNull();
  });
});

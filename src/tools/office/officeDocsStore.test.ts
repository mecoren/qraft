import { beforeEach, describe, expect, it } from 'vitest';
import {
  findOfficeDocByPath,
  officeKindFromPath,
  officeTitleFromPath,
  sameOfficePath,
  useOfficeDocsStore,
} from './officeDocsStore';

/** 重置 store 到初始空态(用例间隔离) */
function resetStore(): void {
  useOfficeDocsStore.setState({ docs: [], activeDocId: null });
}

describe('officeKindFromPath', () => {
  it('OOXML 扩展名映射到对应类别', () => {
    expect(officeKindFromPath('/docs/a.docx')).toBe('word');
    expect(officeKindFromPath('/docs/a.docm')).toBe('word');
    expect(officeKindFromPath('/docs/a.xlsx')).toBe('excel');
    expect(officeKindFromPath('/docs/a.xlsm')).toBe('excel');
    expect(officeKindFromPath('/docs/a.pptx')).toBe('powerpoint');
    expect(officeKindFromPath('/docs/a.pptm')).toBe('powerpoint');
  });

  it('旧二进制格式(doc/xls/ppt)归 legacy', () => {
    expect(officeKindFromPath('/docs/a.doc')).toBe('legacy');
    expect(officeKindFromPath('/docs/a.xls')).toBe('legacy');
    expect(officeKindFromPath('/docs/a.ppt')).toBe('legacy');
  });

  it('扩展名大小写不敏感;非白名单归 legacy', () => {
    expect(officeKindFromPath('/docs/A.DOCX')).toBe('word');
    expect(officeKindFromPath('/docs/a.txt')).toBe('legacy');
  });
});

describe('sameOfficePath', () => {
  it('分隔符与大小写不敏感', () => {
    expect(sameOfficePath('C:\\Docs\\A.docx', 'c:/docs/a.docx')).toBe(true);
    expect(sameOfficePath('C:\\Docs\\A.docx', 'C:\\Docs\\B.docx')).toBe(false);
  });
});

describe('officeTitleFromPath', () => {
  it('取文件名(Windows / Unix 分隔符),超长截断', () => {
    expect(officeTitleFromPath('C:\\Docs\\合同.docx')).toBe('合同.docx');
    expect(officeTitleFromPath('/home/user/report.xlsx')).toBe('report.xlsx');
    const long = `${'x'.repeat(50)}.pptx`;
    expect(officeTitleFromPath(`/home/user/${long}`)).toBe(`${'x'.repeat(40)}…`);
  });
});

describe('officeDocsStore', () => {
  beforeEach(resetStore);

  it('openOfficeFromSystem 追加 Tab 并激活,kind 由扩展名派生', () => {
    useOfficeDocsStore.getState().openOfficeFromSystem({
      path: 'C:\\Docs\\a.docx',
      base64: 'AAAA',
      size: 3,
    });
    const s = useOfficeDocsStore.getState();
    expect(s.docs).toHaveLength(1);
    expect(s.docs[0].kind).toBe('word');
    expect(s.activeDocId).toBe(s.docs[0].id);

    useOfficeDocsStore.getState().openOfficeFromSystem({
      path: 'C:\\Docs\\b.xlsx',
      base64: 'BBBB',
      size: 4,
    });
    const s2 = useOfficeDocsStore.getState();
    expect(s2.docs).toHaveLength(2);
    expect(s2.docs[1].kind).toBe('excel');
    expect(s2.activeDocId).toBe(s2.docs[1].id);
  });

  it('同路径复用 Tab:重开刷新字节并激活,不重复开', () => {
    useOfficeDocsStore.getState().openOfficeFromSystem({
      path: 'C:\\Docs\\a.docx',
      base64: 'AAAA',
      size: 3,
    });
    useOfficeDocsStore.getState().openOfficeFromSystem({
      path: 'c:/docs/A.DOCX',
      base64: 'NEWBYTES',
      size: 8,
    });
    const s = useOfficeDocsStore.getState();
    expect(s.docs).toHaveLength(1);
    expect(s.docs[0].base64).toBe('NEWBYTES');
    expect(s.docs[0].size).toBe(8);
    expect(s.activeDocId).toBe(s.docs[0].id);
  });

  it('switchDoc 切换激活;closeDoc 关闭后激活态跳相邻', () => {
    const open = (path: string) =>
      useOfficeDocsStore.getState().openOfficeFromSystem({ path, base64: 'A', size: 1 });
    open('C:/a.docx');
    open('C:/b.xlsx');
    open('C:/c.pptx');

    const [a, b, c] = useOfficeDocsStore.getState().docs;
    useOfficeDocsStore.getState().switchDoc(a.id);
    expect(useOfficeDocsStore.getState().activeDocId).toBe(a.id);

    // 关闭中间 Tab:激活跳到相邻(右侧优先,无右侧回左侧)
    useOfficeDocsStore.getState().switchDoc(b.id);
    useOfficeDocsStore.getState().closeDoc(b.id);
    const s = useOfficeDocsStore.getState();
    expect(s.docs.map((d) => d.id)).toEqual([a.id, c.id]);
    expect(s.activeDocId).toBe(c.id);

    // 关闭最后一个:激活回到剩余最后一个
    useOfficeDocsStore.getState().closeDoc(c.id);
    expect(useOfficeDocsStore.getState().activeDocId).toBe(a.id);

    // 全部关闭:空态
    useOfficeDocsStore.getState().closeDoc(a.id);
    expect(useOfficeDocsStore.getState().docs).toHaveLength(0);
    expect(useOfficeDocsStore.getState().activeDocId).toBeNull();
  });

  it('findOfficeDocByPath 按同路径语义查找', () => {
    useOfficeDocsStore.getState().openOfficeFromSystem({
      path: 'C:/Docs/a.docx',
      base64: 'A',
      size: 1,
    });
    const doc = useOfficeDocsStore.getState().docs[0];
    expect(findOfficeDocByPath(useOfficeDocsStore.getState().docs, 'c:\\docs\\A.DOCX')?.id).toBe(
      doc.id,
    );
    expect(findOfficeDocByPath(useOfficeDocsStore.getState().docs, 'C:/other.docx')).toBeNull();
  });
});

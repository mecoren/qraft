import { describe, it, expect } from 'vitest';
import {
  isMarkdownPath,
  isPdfPath,
  isOfficePath,
  isDropInsideEditorBox,
} from './open-file-routing';

describe('isMarkdownPath', () => {
  it('识别 .md / .markdown / .mdx 扩展名(大小写不敏感)', () => {
    expect(isMarkdownPath('C:\\docs\\README.md')).toBe(true);
    expect(isMarkdownPath('/home/user/notes.markdown')).toBe(true);
    expect(isMarkdownPath('/home/user/spec.mdx')).toBe(true);
    expect(isMarkdownPath('/home/user/README.MD')).toBe(true);
  });

  it('非 md 扩展名返回 false', () => {
    expect(isMarkdownPath('C:\\docs\\a.txt')).toBe(false);
    expect(isMarkdownPath('/home/user/main.rs')).toBe(false);
    expect(isMarkdownPath('/home/user/data.json')).toBe(false);
    // .md 后缀但不是扩展名(目录名/中间段)不算
    expect(isMarkdownPath('/home/user.md/back.txt')).toBe(false);
  });

  it('路径两侧空白被容忍', () => {
    expect(isMarkdownPath('  C:\\a\\b.md  ')).toBe(true);
    expect(isMarkdownPath('')).toBe(false);
  });
});

describe('isPdfPath', () => {
  it('识别 .pdf 扩展名(大小写不敏感)', () => {
    expect(isPdfPath('C:\\docs\\report.pdf')).toBe(true);
    expect(isPdfPath('/home/user/form.PDF')).toBe(true);
    expect(isPdfPath('/home/user/tax.Pdf')).toBe(true);
  });

  it('非 pdf 扩展名返回 false', () => {
    expect(isPdfPath('C:\\docs\\a.txt')).toBe(false);
    expect(isPdfPath('/home/user/scan.pdfx')).toBe(false);
    expect(isPdfPath('/home/user/pdffile')).toBe(false);
    // .pdf 出现在目录名而非扩展名
    expect(isPdfPath('/home/user.pdf/readme.txt')).toBe(false);
  });

  it('路径两侧空白被容忍', () => {
    expect(isPdfPath('  C:\\a\\b.pdf  ')).toBe(true);
    expect(isPdfPath('')).toBe(false);
  });
});

describe('isOfficePath', () => {
  it('识别 OOXML 扩展名(docx/docm/xlsx/xlsm/pptx/pptm)', () => {
    for (const ext of ['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm']) {
      expect(isOfficePath(`/docs/report.${ext}`)).toBe(true);
    }
  });

  it('识别 WPS / 旧二进制格式扩展名(doc/xls/ppt,大小写不敏感)', () => {
    expect(isOfficePath('C:\\docs\\report.doc')).toBe(true);
    expect(isOfficePath('/home/user/budget.xls')).toBe(true);
    expect(isOfficePath('/home/user/预算表.XLS')).toBe(true);
    expect(isOfficePath('/home/user/slides.Ppt')).toBe(true);
  });

  it('非 Office 扩展名 / 无扩展名返回 false', () => {
    expect(isOfficePath('/docs/report.txt')).toBe(false);
    expect(isOfficePath('/docs/report.pdf')).toBe(false);
    expect(isOfficePath('/docs/report')).toBe(false);
    expect(isOfficePath('/docs/report.docx~')).toBe(false);
    expect(isOfficePath('')).toBe(false);
  });

  it('路径两侧空白被容忍', () => {
    expect(isOfficePath('  /docs/report.pptx  ')).toBe(true);
  });
});

describe('isDropInsideEditorBox', () => {
  /** 构造 fake elementFromPoint:命中元素按 root 的类名走 closest 语义 */
  const fromPointWith = (insideEditor: boolean) => {
    const root = document.createElement('div');
    if (insideEditor) root.className = 'monaco-editor';
    return (x: number, y: number) => {
      void x;
      void y;
      return insideEditor ? root : document.createElement('div');
    };
  };

  it('落点命中 .monaco-editor 内的元素:返回 true(豁免分流)', () => {
    expect(isDropInsideEditorBox({ x: 100, y: 200 }, fromPointWith(true))).toBe(true);
  });

  it('落点命中编辑框外的普通元素:返回 false(走 Markdown 预览)', () => {
    expect(isDropInsideEditorBox({ x: 10, y: 10 }, fromPointWith(false))).toBe(false);
  });

  it('落点无元素命中(超出视口等):返回 false', () => {
    expect(isDropInsideEditorBox({ x: -5, y: 0 }, () => null)).toBe(false);
  });

  it('无落点坐标(文件关联/命令行打开):返回 false', () => {
    expect(isDropInsideEditorBox(undefined, fromPointWith(true))).toBe(false);
  });
});

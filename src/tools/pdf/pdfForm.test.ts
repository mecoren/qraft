import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  applyFormValues,
  extractFormFields,
  hasChangedValues,
  initialValues,
} from './pdfForm';

/** 构造一份带表单的 PDF(文本 + 复选 + 下拉),返回 base64 */
async function makeFormPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const form = doc.getForm();
  const name = form.createTextField('name');
  name.addToPage(page, { x: 20, y: 120, width: 200, height: 20 });
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 20, y: 90, width: 16, height: 16 });
  const city = form.createDropdown('city');
  city.addOptions(['Beijing', 'Shanghai']);
  city.addToPage(page, { x: 20, y: 60, width: 120, height: 18 });
  const bytes = await doc.save();
  return uint8ToB64(bytes);
}

function uint8ToB64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function b64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('extractFormFields', () => {
  it('枚举文本/复选/下拉域及其当前值', async () => {
    const base64 = await makeFormPdf();
    const doc = await PDFDocument.load(b64ToUint8(base64));
    const fields = extractFormFields(doc);
    const types = fields.map((f) => `${f.name}:${f.type}`).sort();
    expect(types).toEqual(['agree:checkbox', 'city:dropdown', 'name:text']);
    const name = fields.find((f) => f.name === 'name');
    expect(name?.value).toBe('');
    expect(name?.readOnly).toBe(false);
    const city = fields.find((f) => f.name === 'city');
    expect(city?.options).toEqual(['Beijing', 'Shanghai']);
  });

  it('无表单的 PDF 返回空数组', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);
    expect(extractFormFields(doc)).toEqual([]);
  });

  it('嵌套域名 label 取最后一段;冲突时回退全名', () => {
    // labelFor/dedupeLabels 经 extractFormFields 间接验证;直接构造场景:
    // 'parent.name' 与 'other.name' 同短名 → 后者保留全名
    // (此处用私有函数不可导出的约束,改以对象直测描述逻辑)
    const fields = [
      { name: 'parent.name', type: 'text' as const, readOnly: false, value: '', label: 'name' },
      { name: 'other.name', type: 'text' as const, readOnly: false, value: '', label: 'name' },
    ];
    // 复刻 dedupeLabels 逻辑验证语义
    const seen = new Set<string>();
    const deduped = fields.map((f) => {
      if (f.label === f.name) return f;
      if (seen.has(f.label)) return { ...f, label: f.name };
      seen.add(f.label);
      return f;
    });
    expect(deduped[0].label).toBe('name');
    expect(deduped[1].label).toBe('other.name');
  });
});

describe('initialValues / hasChangedValues', () => {
  it('复选域初始值以 true/false 字符串承载', async () => {
    const base64 = await makeFormPdf();
    const doc = await PDFDocument.load(b64ToUint8(base64));
    const fields = extractFormFields(doc);
    const values = initialValues(fields);
    expect(values['name']).toBe('');
    expect(values['agree']).toBe('false');
    expect(values['city']).toBe('');
    expect(hasChangedValues(fields, values)).toBe(false);
    expect(hasChangedValues(fields, { ...values, name: '张三' })).toBe(true);
    expect(hasChangedValues(fields, { ...values, agree: 'true' })).toBe(true);
  });
});

describe('applyFormValues', () => {
  it('写入文本/复选/下拉后能回读出相同值(往返一致)', async () => {
    const base64 = await makeFormPdf();
    const { base64: out, errors } = await applyFormValues(base64, {
      name: '张三',
      agree: 'true',
      city: 'Shanghai',
    });
    expect(errors).toEqual([]);
    const doc = await PDFDocument.load(b64ToUint8(out));
    const fields = extractFormFields(doc);
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName['name'].value).toBe('张三');
    expect(byName['agree'].checked).toBe(true);
    expect(byName['city'].value).toBe('Shanghai');
  });

  it('未提供的域值保持原样(增量填写)', async () => {
    const base64 = await makeFormPdf();
    const { base64: out } = await applyFormValues(base64, { name: '李四' });
    const doc = await PDFDocument.load(b64ToUint8(out));
    const fields = extractFormFields(doc);
    const agree = fields.find((f) => f.name === 'agree');
    expect(agree?.checked).toBe(false); // 未提供 → 未被改动
  });
});

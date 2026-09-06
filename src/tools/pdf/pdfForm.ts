/**
 * PDF 表单域逻辑 —— pdf-lib AcroForm 读写封装(纯逻辑,便于单测)
 *
 * 职责:
 * - `extractFormFields`:枚举 PDF 的全部 AcroForm 域(文本/复选/单选/下拉/
 *   选项列表),返回 UI 可渲染的字段描述(名称/类型/只读/选项/当前值)。
 * - `applyFormValues`:把表单面板的值写回 PDF 字节(覆盖保存的前置步骤)。
 *
 * 设计说明:
 * - 表单填写走 pdf-lib 的 `PDFForm` API(填充值 + 更新外观流),
 *   渲染视图(pdfjs)只读展示,两库各司其职。
 * - 嵌套域名(radio 组 / 子域 `parent.child`)统一取 fully qualified name;
 *   单选组共享一个条目,值取选中的 export value。
 */
import {
  PDFBool,
  PDFButton,
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  PDFDocument,
  type PDFField,
} from 'pdf-lib';

/** 表单字段类型(前端展示用;映射 pdf-lib 具体域类) */
export type PdfFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist' | 'button';

/** 单个表单域的 UI 描述 */
export interface PdfField {
  /** fully qualified 域名(唯一键) */
  name: string;
  type: PdfFieldType;
  /** 只读域(签名/计算字段等):面板禁用输入 */
  readOnly: boolean;
  /** 文本域当前值 / 复选 'Yes'|'Off' / 单选&下拉的已选 export value */
  value: string;
  /** 复选当前是否选中 */
  checked?: boolean;
  /** radio / dropdown / optionlist 的可选项(radio 为 export values) */
  options?: string[];
  /** 供 UI 展示的备选名(去层级前缀;与既有 label 冲突时保留全名) */
  label: string;
}

/** 由 pdf-lib 域实例派生 UI 描述(不含 label 冲突处理) */
function describeField(field: PDFField): PdfField | null {
  const name = field.getName();
  if (field instanceof PDFTextField) {
    return {
      name,
      type: 'text',
      readOnly: field.isReadOnly(),
      value: field.getText() ?? '',
      label: labelFor(name),
    };
  }
  if (field instanceof PDFCheckBox) {
    return {
      name,
      type: 'checkbox',
      readOnly: field.isReadOnly(),
      value: field.isChecked() ? 'Yes' : 'Off',
      checked: field.isChecked(),
      label: labelFor(name),
    };
  }
  if (field instanceof PDFRadioGroup) {
    return {
      name,
      type: 'radio',
      readOnly: field.isReadOnly(),
      value: field.getSelected() ?? '',
      options: field.getOptions(),
      label: labelFor(name),
    };
  }
  if (field instanceof PDFDropdown) {
    return {
      name,
      type: 'dropdown',
      readOnly: field.isReadOnly(),
      value: field.getSelected()[0] ?? '',
      options: field.getOptions(),
      label: labelFor(name),
    };
  }
  if (field instanceof PDFOptionList) {
    return {
      name,
      type: 'optionlist',
      readOnly: field.isReadOnly(),
      value: field.getSelected()[0] ?? '',
      options: field.getOptions(),
      label: labelFor(name),
    };
  }
  if (field instanceof PDFButton) {
    return {
      name,
      type: 'button',
      readOnly: field.isReadOnly(),
      value: '',
      label: labelFor(name),
    };
  }
  return null;
}

/** 展示名:取层级最后一段(无层级即原样) */
function labelFor(name: string): string {
  return name.includes('.') ? (name.split('.').pop() ?? name) : name;
}

/** 同名 label 冲突消解:短名已占用时回退全名(表单里 parent.a / other.a 并存) */
function dedupeLabels(fields: readonly PdfField[]): PdfField[] {
  const seen = new Set<string>();
  return fields.map((f) => {
    if (f.label === f.name) return f;
    if (seen.has(f.label)) return { ...f, label: f.name };
    seen.add(f.label);
    return f;
  });
}

/** 从 pdf-lib 文档枚举 UI 字段描述(顺序稳定:按文档出现顺序) */
export function extractFormFields(doc: PDFDocument): PdfField[] {
  const form = doc.getForm();
  const fields: PdfField[] = [];
  for (const field of form.getFields()) {
    const described = describeField(field);
    if (described) fields.push(described);
  }
  return dedupeLabels(fields);
}

/** 表单值面板状态:域名 → 值(复选存 'true'/'false' 字符串便于受控组件) */
export type FormValues = Record<string, string>;

/** 由字段描述初始化表单值面板(button 域无值不参与) */
export function initialValues(fields: readonly PdfField[]): FormValues {
  const values: FormValues = {};
  for (const f of fields) {
    if (f.type === 'checkbox') values[f.name] = f.checked ? 'true' : 'false';
    else if (f.type !== 'button') values[f.name] = f.value;
  }
  return values;
}

/** 表单值是否有别于初始值(dirty 判定;跳过未收录的域) */
export function hasChangedValues(fields: readonly PdfField[], values: FormValues): boolean {
  const initial = initialValues(fields);
  for (const key of Object.keys(initial)) {
    if ((values[key] ?? '') !== initial[key]) return true;
  }
  return false;
}

/**
 * 把表单值写回 PDF 字节(覆盖保存的核心步骤)。
 * 逐域 try/catch:单个域写失败(加密文档/畸形域)跳过并计入 errors 返回,
 * 不让整次保存失败。
 *
 * 外观流:可编码值(拉丁/WinAnsi 覆盖)由 pdf-lib 重建外观流;值含中文等
 * 不可编码字符时置 AcroForm 的 `NeedAppearances` 标志并跳过重建
 * (`save` 也会按需内部重建,须整体关闭以免抛错),交由阅读器
 * (Acrobat/浏览器/Preview)打开时自行排版;表单值本身已正确写入,
 * 所有标准阅读器均能显示/回读。
 */
export async function applyFormValues(
  base64: string,
  values: FormValues,
): Promise<{ base64: string; errors: string[] }> {
  const doc = await PDFDocument.load(base64ToUint8(base64));
  const form = doc.getForm();
  const errors: string[] = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    const value = values[name];
    if (value === undefined) continue;
    try {
      if (field instanceof PDFTextField) {
        field.setText(value);
      } else if (field instanceof PDFCheckBox) {
        if (value === 'true') field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (value) field.select(value);
      } else if (field instanceof PDFDropdown) {
        if (value) field.select(value);
        else field.clear();
      } else if (field instanceof PDFOptionList) {
        if (value) field.select(value);
      }
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // 值含标准 14 字体不可编码字符(中文/emoji 等):置 needAppearances,
  // 外观流交给阅读器;save 时须关闭内置的外观重建,否则同样抛错。
  // 判定口径:超出 WinAnsi 单字节覆盖(U+00FF 以上)即视为不可编码。
  const hasUnencodable = Object.values(values).some((v) => {
    for (const ch of v) {
      if (ch.codePointAt(0)! > 0xff) return true;
    }
    return false;
  });
  let updateFieldAppearances = true;
  if (hasUnencodable) {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
    updateFieldAppearances = false;
  } else {
    try {
      form.updateFieldAppearances();
    } catch {
      form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
      updateFieldAppearances = false;
    }
  }
  const bytes = await doc.save({ updateFieldAppearances });
  return { base64: uint8ToBase64(bytes), errors };
}

/** base64 → Uint8Array(atob;合法 base64 输入,长度对齐) */
function base64ToUint8(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Uint8Array → base64(分块避免栈溢出,与 lib/file-utils 同策略) */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

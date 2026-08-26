/**
 * 文本编码注册表 —— 编辑器状态栏「文件编码」切换与展示
 *
 * 与 Rust 端 commands/fs.rs 的 ENCODING_IDS 对齐:
 * - id 为 encoding_rs 的 whatwg label 小写形式(另加 utf-8-bom,写入时自动补 BOM)
 * - label 用于状态栏与选择列表展示
 */

export interface TextEncodingOption {
  /** 编码标识(Rust 端 fs_write_file_encoded 的 encoding 参数) */
  id: string;
  /** 展示名 */
  label: string;
  /** 展示名的 i18n 键(存在时组件层优先用 t(labelKey) 渲染) */
  labelKey?: string;
}

/** 支持的文件编码(顺序即选择列表顺序;label 为 zh 缺省,en 走 labelKey) */
export const TEXT_ENCODINGS: ReadonlyArray<TextEncodingOption> = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-8-bom', label: 'UTF-8 with BOM' },
  { id: 'gb18030', label: 'GB18030 (GBK)' },
  { id: 'big5', label: 'Big5 (繁体中文)', labelKey: 'chrome.encoding.big5' },
  { id: 'shift_jis', label: 'Shift-JIS (日语)', labelKey: 'chrome.encoding.shift_jis' },
  { id: 'euc-kr', label: 'EUC-KR (韩语)', labelKey: 'chrome.encoding.euc_kr' },
  { id: 'windows-1252', label: 'Windows-1252 (Latin-1)' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
];

/** 默认编码标识 */
export const DEFAULT_ENCODING_ID = 'utf-8';

/** 由编码标识取展示名;未知/缺省回退 UTF-8(仅返回 id 兜底,不翻译) */
export function encodingLabel(id: string | null | undefined): string {
  return TEXT_ENCODINGS.find((e) => e.id === id)?.label ?? 'UTF-8';
}

/** 编码标识是否受支持 */
export function isKnownEncoding(id: string): boolean {
  return TEXT_ENCODINGS.some((e) => e.id === id);
}

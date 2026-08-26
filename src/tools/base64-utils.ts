/**
 * Base64 转换工具的模式定义
 *
 * 统一整合 base64.guru/converter 的 Encoders 与 Decoders 全部功能。
 *
 * - Encoders(10 种):Text / URL / CSS / HTML / Hex(文本类,走 Rust 后端)+
 *   File / Image / Audio / Video / PDF(文件类,前端 FileReader)
 * - Decoders(9 种):Text / ASCII / Hex / Basic Auth(文本类,走 Rust 后端)+
 *   File / Image / Audio / Video / PDF(二进制类,Rust 校验嗅探 + 前端 Blob 预览)
 *
 * 文本类模式经 IPC 调用 Rust 的 base64_codec 工具执行;
 * 文件类模式由前端读取文件 / 构造 Blob,仅在解码二进制时借用 Rust 校验与 MIME 嗅探。
 */
import {
  CodeXml,
  FileCode2,
  FileText,
  FileType,
  Hash,
  Image as ImageIcon,
  KeyRound,
  Link,
  Music,
  Type,
  Video,
  type LucideIcon,
} from 'lucide-react';

export type Direction = 'encode' | 'decode';

/** 模式输入形态:text = 双 CodeEditor;file = 拖放区/预览区 */
export type ModeKind = 'text' | 'file';

export interface Base64Mode {
  /** 模式唯一 ID,同一方向内不可重复 */
  id: string;
  /** 显示名称(非中文名直接存字面量) */
  label: string;
  /** 中文名的 i18n 键(tools.base64_codec.*);存在时优先于 label 渲染 */
  labelKey?: string;
  /** 输入区占位 / 描述的 i18n 键(tools.base64_codec.*) */
  hintKey: string;
  /** 输入形态 */
  kind: ModeKind;
  /** 传给 Rust base64_codec 的 mode 参数(仅文本类与二进制解码使用) */
  rustMode: 'text' | 'hex' | 'ascii' | 'basic_auth' | 'binary';
  /** 文件类模式的 input accept;文本类省略 */
  accept?: string;
  /** 图标 */
  icon: LucideIcon;
}

export const ENCODE_MODES: readonly Base64Mode[] = [
  {
    id: 'text',
    label: 'Text',
    hintKey: 'tools.base64_codec.mode_encode_text_hint',
    kind: 'text',
    rustMode: 'text',
    icon: Type,
  },
  {
    id: 'url',
    label: 'URL',
    hintKey: 'tools.base64_codec.mode_encode_url_hint',
    kind: 'text',
    rustMode: 'text',
    icon: Link,
  },
  {
    id: 'css',
    label: 'CSS',
    hintKey: 'tools.base64_codec.mode_encode_css_hint',
    kind: 'text',
    rustMode: 'text',
    icon: FileCode2,
  },
  {
    id: 'html',
    label: 'HTML',
    hintKey: 'tools.base64_codec.mode_encode_html_hint',
    kind: 'text',
    rustMode: 'text',
    icon: CodeXml,
  },
  {
    id: 'hex',
    label: 'Hex',
    hintKey: 'tools.base64_codec.mode_encode_hex_hint',
    kind: 'text',
    rustMode: 'hex',
    icon: Hash,
  },
  {
    id: 'file',
    labelKey: 'tools.base64_codec.mode_encode_file_label',
    label: '文件',
    hintKey: 'tools.base64_codec.mode_encode_file_hint',
    kind: 'file',
    rustMode: 'binary',
    icon: FileText,
  },
  {
    id: 'image',
    labelKey: 'tools.base64_codec.mode_encode_image_label',
    label: '图片',
    hintKey: 'tools.base64_codec.mode_encode_image_hint',
    kind: 'file',
    rustMode: 'binary',
    accept: 'image/*',
    icon: ImageIcon,
  },
  {
    id: 'audio',
    labelKey: 'tools.base64_codec.mode_encode_audio_label',
    label: '音频',
    hintKey: 'tools.base64_codec.mode_encode_audio_hint',
    kind: 'file',
    rustMode: 'binary',
    accept: 'audio/*',
    icon: Music,
  },
  {
    id: 'video',
    labelKey: 'tools.base64_codec.mode_encode_video_label',
    label: '视频',
    hintKey: 'tools.base64_codec.mode_encode_video_hint',
    kind: 'file',
    rustMode: 'binary',
    accept: 'video/*',
    icon: Video,
  },
  {
    id: 'pdf',
    label: 'PDF',
    hintKey: 'tools.base64_codec.mode_encode_pdf_hint',
    kind: 'file',
    rustMode: 'binary',
    accept: 'application/pdf',
    icon: FileType,
  },
] as const;

export const DECODE_MODES: readonly Base64Mode[] = [
  {
    id: 'text',
    label: 'Text',
    hintKey: 'tools.base64_codec.mode_decode_text_hint',
    kind: 'text',
    rustMode: 'text',
    icon: Type,
  },
  {
    id: 'ascii',
    label: 'ASCII',
    hintKey: 'tools.base64_codec.mode_decode_ascii_hint',
    kind: 'text',
    rustMode: 'ascii',
    icon: FileText,
  },
  {
    id: 'hex',
    label: 'Hex',
    hintKey: 'tools.base64_codec.mode_decode_hex_hint',
    kind: 'text',
    rustMode: 'hex',
    icon: Hash,
  },
  {
    id: 'basic_auth',
    label: 'Basic Auth',
    hintKey: 'tools.base64_codec.mode_decode_basic_auth_hint',
    kind: 'text',
    rustMode: 'basic_auth',
    icon: KeyRound,
  },
  {
    id: 'file',
    labelKey: 'tools.base64_codec.mode_decode_file_label',
    label: '文件',
    hintKey: 'tools.base64_codec.mode_decode_file_hint',
    kind: 'file',
    rustMode: 'binary',
    icon: FileText,
  },
  {
    id: 'image',
    labelKey: 'tools.base64_codec.mode_decode_image_label',
    label: '图片',
    hintKey: 'tools.base64_codec.mode_decode_image_hint',
    kind: 'file',
    rustMode: 'binary',
    icon: ImageIcon,
  },
  {
    id: 'audio',
    labelKey: 'tools.base64_codec.mode_decode_audio_label',
    label: '音频',
    hintKey: 'tools.base64_codec.mode_decode_audio_hint',
    kind: 'file',
    rustMode: 'binary',
    icon: Music,
  },
  {
    id: 'video',
    labelKey: 'tools.base64_codec.mode_decode_video_label',
    label: '视频',
    hintKey: 'tools.base64_codec.mode_decode_video_hint',
    kind: 'file',
    rustMode: 'binary',
    icon: Video,
  },
  {
    id: 'pdf',
    label: 'PDF',
    hintKey: 'tools.base64_codec.mode_decode_pdf_hint',
    kind: 'file',
    rustMode: 'binary',
    icon: FileType,
  },
] as const;

/** 按方向取模式列表 */
export function getModes(direction: Direction): readonly Base64Mode[] {
  return direction === 'encode' ? ENCODE_MODES : DECODE_MODES;
}

/** 按方向与 ID 查询模式元数据;找不到返回 undefined */
export function getMode(direction: Direction, id: string): Base64Mode | undefined {
  return getModes(direction).find((m) => m.id === id);
}

/** 该方向是否支持 URL-safe 开关(仅文本类模式) */
export function supportsUrlSafe(direction: Direction, id: string): boolean {
  const mode = getMode(direction, id);
  return mode?.kind === 'text';
}

/** 该方向是否支持 Hex 大小写开关(仅解码 hex 模式) */
export function supportsHexCase(direction: Direction, id: string): boolean {
  return direction === 'decode' && id === 'hex';
}

/** 该方向是否支持 Data URL 前缀开关(仅文件类编码) */
export function supportsDataUrl(direction: Direction, id: string): boolean {
  return direction === 'encode' && getMode(direction, id)?.kind === 'file';
}

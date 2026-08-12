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
  /** 显示名称 */
  label: string;
  /** 输入区占位 / 描述 */
  hint: string;
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
  { id: 'text', label: 'Text', hint: '输入要编码为 Base64 的文本', kind: 'text', rustMode: 'text', icon: Type },
  { id: 'url', label: 'URL', hint: '输入 URL 字符串,编码为 Base64', kind: 'text', rustMode: 'text', icon: Link },
  { id: 'css', label: 'CSS', hint: '输入 CSS 代码,编码为 Base64', kind: 'text', rustMode: 'text', icon: FileCode2 },
  { id: 'html', label: 'HTML', hint: '输入 HTML 代码,编码为 Base64', kind: 'text', rustMode: 'text', icon: CodeXml },
  {
    id: 'hex',
    label: 'Hex',
    hint: '输入十六进制字节序列(可含空格,如 48 65 6c 6c 6f),编码为 Base64',
    kind: 'text',
    rustMode: 'hex',
    icon: Hash,
  },
  { id: 'file', label: '文件', hint: '拖放或选择任意文件,编码为 Base64', kind: 'file', rustMode: 'binary', icon: FileText },
  { id: 'image', label: '图片', hint: '拖放或选择图片文件,编码为 Base64', kind: 'file', rustMode: 'binary', accept: 'image/*', icon: ImageIcon },
  { id: 'audio', label: '音频', hint: '拖放或选择音频文件,编码为 Base64', kind: 'file', rustMode: 'binary', accept: 'audio/*', icon: Music },
  { id: 'video', label: '视频', hint: '拖放或选择视频文件,编码为 Base64', kind: 'file', rustMode: 'binary', accept: 'video/*', icon: Video },
  { id: 'pdf', label: 'PDF', hint: '拖放或选择 PDF 文件,编码为 Base64', kind: 'file', rustMode: 'binary', accept: 'application/pdf', icon: FileType },
] as const;

export const DECODE_MODES: readonly Base64Mode[] = [
  { id: 'text', label: 'Text', hint: '粘贴 Base64,解码为 UTF-8 纯文本', kind: 'text', rustMode: 'text', icon: Type },
  { id: 'ascii', label: 'ASCII', hint: '粘贴 Base64,逐字节解码为 ASCII/Latin-1 文本', kind: 'text', rustMode: 'ascii', icon: FileText },
  { id: 'hex', label: 'Hex', hint: '粘贴 Base64,解码为十六进制字节序列', kind: 'text', rustMode: 'hex', icon: Hash },
  {
    id: 'basic_auth',
    label: 'Basic Auth',
    hint: '粘贴 Basic 认证头(可带 Basic 前缀),解码为 用户名:密码',
    kind: 'text',
    rustMode: 'basic_auth',
    icon: KeyRound,
  },
  { id: 'file', label: '文件', hint: '粘贴 Base64,还原为二进制文件下载', kind: 'file', rustMode: 'binary', icon: FileText },
  { id: 'image', label: '图片', hint: '粘贴 Base64 / data URL,预览图片', kind: 'file', rustMode: 'binary', icon: ImageIcon },
  { id: 'audio', label: '音频', hint: '粘贴 Base64 / data URL,播放音频', kind: 'file', rustMode: 'binary', icon: Music },
  { id: 'video', label: '视频', hint: '粘贴 Base64 / data URL,播放视频', kind: 'file', rustMode: 'binary', icon: Video },
  { id: 'pdf', label: 'PDF', hint: '粘贴 Base64 / data URL,预览 PDF', kind: 'file', rustMode: 'binary', icon: FileType },
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

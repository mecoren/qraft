/**
 * 系统打开文件的 md / pdf / office 分流 —— 纯逻辑辅助
 *
 * 「打开或拖入 .md 文件时自动进入 Markdown 编辑器」「打开或拖入 .pdf
 * 文件时自动进入 PDF 工具」「打开或拖入 Office 文档(docx/xlsx/pptx 及
 * WPS 旧格式 doc/xls/ppt)时自动进入 Office 工具」的判定拆成纯函数,
 * 便于单测覆盖;DOM 依赖(elementFromPoint)由调用方(App.tsx)注入。
 * 判定口径与 markdown-editor-pane 的 isMarkdownDocument 保持一致:
 * 扩展名 .md / .markdown / .mdx(大小写不敏感);PDF 为 .pdf,与 Rust 端
 * `shell::file_open::is_pdf_path` 同口径;Office 白名单与 Rust 端
 * `shell::file_open::is_office_path` / `OFFICE_FILE_EXTS` 同口径。
 */

/** 判断路径是否指向 Markdown 文档(.md / .markdown / .mdx) */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path.trim());
}

/** 判断路径是否指向 PDF 文档(.pdf,大小写不敏感) */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path.trim());
}

/**
 * Office 文档支持的扩展名白名单(小写;判定大小写不敏感)。
 * - OOXML:docx / docm / xlsx / xlsm / pptx / pptm(渲染库可解析)
 * - WPS 兼容旧二进制格式:doc / xls / ppt(前端展示转换指引)
 * 顺序与展示无关,仅做成员判定;与 Rust 端 OFFICE_FILE_EXTS 保持同口径。
 */
const OFFICE_EXTS: readonly string[] = [
  'docx',
  'docm',
  'xlsx',
  'xlsm',
  'pptx',
  'pptm',
  'doc',
  'xls',
  'ppt',
];

/** 判断路径是否指向 Office 文档(扩展名白名单,大小写不敏感) */
export function isOfficePath(path: string): boolean {
  const ext = path.trim().split('.').pop() ?? '';
  return OFFICE_EXTS.includes(ext.toLowerCase());
}

/**
 * 判断拖放落点是否在文本编辑器的编辑框内(Monaco 编辑区)。
 *
 * 落点命中 `.monaco-editor`(Monaco 根节点)即视为「直接拖入编辑框」:
 * 此时用户意图是把文件内容作为纯文本插进当前编辑器,不走 Markdown 预览。
 * 无落点坐标(文件关联双击/命令行打开)或命中元素为 null 时返回 false。
 */
export function isDropInsideEditorBox(
  dropPosition: { x: number; y: number } | undefined,
  elementFromPoint: (x: number, y: number) => (Element | null) | null | undefined,
): boolean {
  if (!dropPosition) return false;
  const el = elementFromPoint(dropPosition.x, dropPosition.y);
  return el instanceof Element && el.closest('.monaco-editor') !== null;
}

/**
 * 媒体摄入工具 id:这些工具根容器统一拦截拖放/粘贴(图片/视频直接摄入)。
 * OS 层拖放落点命中其工作区(`ToolPanel` 渲染的 `[data-tool-id]` 容器)时,
 * 全局分流静默:二进制不再弹「仍要打开」、文本不再抢跳编辑器,
 * 摄入与类型反馈由工具自身的 HTML5 拖放处理完成(同源触发)。
 */
export const MEDIA_DROP_TOOL_IDS: readonly string[] = [
  'qrcode_tool',
  'image_converter',
  'png_compressor',
  'image_metadata',
  'color_blindness_simulator',
  'video_to_gif',
];

/**
 * 判断拖放落点是否在指定工具工作区内(`[data-tool-id]` 容器)。
 *
 * 与 `isDropInsideEditorBox` 同口径的落点判定,只是命中目标从
 * `.monaco-editor` 换成工具容器:命中即视为用户意图把文件交给该工具,
 * 全局分流应放行、不抢跳。keepalive 隐藏的工具为 `display:none`,
 * `elementFromPoint` 恒命中不了,天然只对可见工具生效。
 */
export function isDropInsideToolBox(
  dropPosition: { x: number; y: number } | undefined,
  elementFromPoint: (x: number, y: number) => (Element | null) | null | undefined,
  ...toolIds: string[]
): boolean {
  if (!dropPosition || toolIds.length === 0) return false;
  const el = elementFromPoint(dropPosition.x, dropPosition.y);
  if (!(el instanceof Element)) return false;
  return toolIds.some((id) => el.closest(`[data-tool-id="${id}"]`) !== null);
}

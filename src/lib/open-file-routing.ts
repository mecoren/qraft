/**
 * 系统打开文件的 md / pdf 分流 —— 纯逻辑辅助
 *
 * 「打开或拖入 .md 文件时自动进入 Markdown 预览工具」「打开或拖入 .pdf
 * 文件时自动进入 PDF 工具」的判定拆成纯函数,便于单测覆盖;DOM 依赖
 * (elementFromPoint)由调用方(App.tsx)注入。
 * 判定口径与 markdown-preview-pane 的 isMarkdownDocument 保持一致:
 * 扩展名 .md / .markdown / .mdx(大小写不敏感);PDF 为 .pdf,与 Rust 端
 * `shell::file_open::is_pdf_path` 同口径。
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

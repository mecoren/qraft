/**
 * 拖放 / 剪贴板媒体文件提取:图片·视频类工具共用。
 *
 * 两条路径分开(不要合并成一个"万能入口"):
 * - 拖放只读 `dataTransfer.files`(浏览器/OS 拖放文件的稳定通道);
 *   类型过滤与报错由各工具既有的 `intake` / `loadFile` 负责,保持旧行为不变。
 * - 粘贴读 `files` + `items`:截图工具 / 浏览器「复制图片」把位图放在
 *   `items`(经 `getAsFile` 取 `File`),资源管理器复制文件走 `files`;
 *   无命中返回空数组,调用方直接 return 放行,不 preventDefault,
 *   避免干扰编辑器内的纯文本粘贴。
 */

/** 图片类型守卫(作 `clipboardMediaFiles` 的 accept 传入) */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** 视频类型守卫(作 `clipboardMediaFiles` 的 accept 传入) */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

/** 拖放:取 `dataTransfer.files` 原样列表 */
export function transferFiles(dt: Pick<DataTransfer, 'files'> | null | undefined): File[] {
  if (!dt?.files) return [];
  return Array.from(dt.files);
}

/**
 * 粘贴:从 `files` + `items` 收集命中 `accept` 的文件并去重。
 * `items` 中 `kind !== 'file'`(拖选文本等)与 `getAsFile()` 为空的直接跳过。
 */
export function clipboardMediaFiles(
  dt: Pick<DataTransfer, 'files' | 'items'> | null | undefined,
  accept: (file: File) => boolean,
): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files) {
    for (const file of Array.from(dt.files)) {
      if (accept(file) && !out.includes(file)) out.push(file);
    }
  }
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && accept(file) && !out.includes(file)) out.push(file);
    }
  }
  return out;
}

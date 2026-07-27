/**
 * 系统字体列表加载
 *
 * 通过 Tauri IPC 调用 Rust 端 `list_system_fonts` 命令获取系统字体。
 * Rust 端使用 font-kit 枚举系统字体(与 wait-home 一致)。
 *
 * 设计说明:
 * - 失败时返回空数组而非抛错,UI 显示"系统默认"兜底项
 * - 提供 FontInfo 类型,与 Rust 端 FontInfo 结构对齐(camelCase 序列化)
 */

export interface FontInfo {
  /** 字体族标识符(传给 CSS font-family) */
  family: string;
  /** 用户可读的显示名 */
  displayName: string;
}

/**
 * 调用 Rust list_system_fonts 命令
 *
 * 失败时返回空数组,UI 显示"系统默认"兜底。
 * 成功时返回 FontInfo 列表(已按 display_name 排序)。
 */
export async function listSystemFonts(): Promise<FontInfo[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const fonts = await invoke<FontInfo[]>('list_system_fonts');
    // 防御:确保返回数组(后端可能返回非数组值或 undefined)
    return Array.isArray(fonts) ? fonts : [];
  } catch {
    // Rust 命令未注册或调用失败时,返回空数组,UI 显示"系统默认"
    return [];
  }
}

/**
 * markdown_preview → markdown_editor 一次性 id 迁移。
 *
 * 去除旧 id 是有损变更(收藏/最近使用存的是 toolId 字符串):本函数在应用
 * 启动时跑一次,把 localStorage `qraft_ui_v1` 中的旧 id 换成新 id。
 * 文档数据不受影响(DocsStore/偏好持久化 key 保持不变)。
 * Rust 端 config.json 内的残留旧 id 走既有未知 id 忽略逻辑,不处理。
 */

export const OLD_MARKDOWN_TOOL_ID = 'markdown_preview';
export const NEW_MARKDOWN_TOOL_ID = 'markdown_editor';

const UI_STORAGE_KEY = 'qraft_ui_v1';
const MIGRATION_FLAG = 'qraft_markdown_id_migrated_v1';

function remapList(list: unknown, from: string, to: string): unknown {
  if (!Array.isArray(list)) return list;
  const next = list.map((id) => (id === from ? to : id));
  return [...new Set(next)];
}

/** 执行迁移(幂等,无 localStorage 环境直接返回) */
export function migrateMarkdownToolId(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (window.localStorage.getItem(MIGRATION_FLAG)) return;
    const raw = window.localStorage.getItem(UI_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Record<string, unknown>;
      let touched = false;
      for (const key of ['favorites', 'recents']) {
        const list = data[key];
        if (Array.isArray(list) && list.includes(OLD_MARKDOWN_TOOL_ID)) {
          data[key] = remapList(list, OLD_MARKDOWN_TOOL_ID, NEW_MARKDOWN_TOOL_ID);
          touched = true;
        }
      }
      if (touched) window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(data));
    }
    window.localStorage.setItem(MIGRATION_FLAG, '1');
  } catch {
    // 存储不可读/不可写(隐私模式等):跳过,旧收藏点击落空由工具缺失兜底
  }
}

/**
 * 全局搜索索引 —— 静态构建 + 线性匹配
 *
 * 条目来源:
 * - tool        : 由 TOOL_CATALOG 自动生成(工具名称/描述/关键词)
 * - tool-section: TOOL_ANCHORS 声明的工具内部区块(配置/输入/输出/操作)
 * - setting     : 设置 6 大分区(主题/字体/通用/文本编辑器/快捷键/更新)
 * - setting-field: 设置各分区内的字段(可精确跳转定位)
 * - page        : 应用页面(欢迎/历史/管理扩展/设置/关于)
 *
 * searchIndex(query) 大小写不敏感匹配 title / description / keywords,
 * 按 SEARCH_ENTRY_KINDS 顺序分组返回;空查询返回全量。
 */

import { TOOL_CATALOG, getCatalogEntry, getCategoryById } from '@/lib/tool-catalog';
import {
  TOOL_ANCHORS,
  SETTING_SECTIONS,
  SETTING_FIELDS,
  PAGE_ENTRIES,
  type SettingsMenuId,
} from './search-anchors';
import type { AppView } from '@/store/uiStore';

export type SearchEntryKind = 'tool' | 'tool-section' | 'setting' | 'setting-field' | 'page';

/** 分组展示顺序 */
export const SEARCH_ENTRY_KINDS: readonly SearchEntryKind[] = [
  'tool',
  'tool-section',
  'setting',
  'setting-field',
  'page',
];

/** 搜索结果的跳转目标 */
export interface SearchTarget {
  /** 目标视图 */
  view: AppView;
  /** view === 'tool' 时为目标工具 id */
  toolId?: string;
  /** 完整锚点值(如 `${toolId}:input` 或设置字段锚点),用于 DOM 定位高亮 */
  anchor?: string;
  /** 设置弹窗目标菜单 */
  settingsMenu?: SettingsMenuId;
  /** 文本搜索:目标编辑器 tab id(文本编辑器工作区) */
  tabId?: string;
  /** 文本搜索:查询关键字,用于编辑器内匹配高亮 */
  textQuery?: string;
}

/** 单条搜索结果 */
export interface SearchEntry {
  id: string;
  kind: SearchEntryKind;
  title: string;
  description?: string;
  keywords: string[];
  /** 分组标题(分类名 / 工具名 / 分区名) */
  group: string;
  target: SearchTarget;
}

/** 全部条目(模块加载时构建一次) */
const ALL_ENTRIES: readonly SearchEntry[] = buildAllEntries();

function buildAllEntries(): SearchEntry[] {
  const entries: SearchEntry[] = [];

  // —— 工具级条目 ——
  for (const entry of TOOL_CATALOG) {
    const view: AppView = entry.special === 'settings' ? 'settings' : entry.special === 'extensions' ? 'extensions' : 'tool';
    entries.push({
      id: `tool:${entry.id}`,
      kind: 'tool',
      title: entry.name,
      description: entry.description,
      keywords: [...entry.keywords],
      group: getCategoryById(entry.category).label,
      target: { view, toolId: entry.id },
    });
  }

  // —— 工具区块条目 ——
  for (const [toolId, anchors] of Object.entries(TOOL_ANCHORS)) {
    const tool = getCatalogEntry(toolId);
    const group = tool?.name ?? toolId;
    for (const a of anchors) {
      entries.push({
        id: `${toolId}:${a.key}`,
        kind: 'tool-section',
        title: a.title,
        description: a.description,
        keywords: a.keywords ?? [],
        group,
        target: { view: 'tool', toolId, anchor: `${toolId}:${a.key}` },
      });
    }
  }

  // —— 设置分区 ——
  for (const s of SETTING_SECTIONS) {
    entries.push({
      id: `setting:${s.menuId}`,
      kind: 'setting',
      title: s.title,
      description: s.description,
      keywords: [...s.keywords],
      group: '设置',
      target: { view: 'settings', settingsMenu: s.menuId, anchor: `settings:${s.menuId}` },
    });
  }

  // —— 设置字段 ——
  for (const f of SETTING_FIELDS) {
    const section = SETTING_SECTIONS.find((s) => s.menuId === f.menuId);
    entries.push({
      id: `setting-field:${f.menuId}:${f.key}`,
      kind: 'setting-field',
      title: f.title,
      description: f.description,
      keywords: [...f.keywords],
      group: section?.title ?? '设置',
      target: {
        view: 'settings',
        settingsMenu: f.menuId,
        anchor: `settings:${f.menuId}:${f.key}`,
      },
    });
  }

  // —— 页面 ——
  for (const p of PAGE_ENTRIES) {
    entries.push({
      id: `page:${p.view}`,
      kind: 'page',
      title: p.title,
      description: p.description,
      keywords: [...p.keywords],
      group: '页面',
      target: { view: p.view },
    });
  }

  return entries;
}

/** 判断条目是否命中查询 */
function matches(entry: SearchEntry, q: string): boolean {
  if (entry.title.toLowerCase().includes(q)) return true;
  if (entry.description && entry.description.toLowerCase().includes(q)) return true;
  return entry.keywords.some((k) => k.toLowerCase().includes(q));
}

/**
 * 按查询返回分组搜索结果。
 * 空查询返回全量;无匹配时返回空 Map(不含空数组分组)。
 */
export function searchIndex(query: string): Map<SearchEntryKind, SearchEntry[]> {
  const q = query.trim().toLowerCase();
  const result = new Map<SearchEntryKind, SearchEntry[]>();
  for (const kind of SEARCH_ENTRY_KINDS) {
    const hit = ALL_ENTRIES.filter(
      (e) => e.kind === kind && (q === '' || matches(e, q)),
    );
    if (hit.length > 0) result.set(kind, hit);
  }
  return result;
}

/** 全量条目(供测试与调试) */
export function getAllSearchEntries(): readonly SearchEntry[] {
  return ALL_ENTRIES;
}

/**
 * 全局搜索索引 —— 静态构建 + 模糊匹配(fzf 风格)
 *
 * 条目来源:
 * - tool        : 由 TOOL_CATALOG 自动生成(工具名称/描述/关键词)
 * - tool-section: TOOL_ANCHORS 声明的工具内部区块(配置/输入/输出/操作)
 * - setting     : 设置 6 大分区(主题/字体/通用/文本编辑器/快捷键/更新)
 * - setting-field: 设置各分区内的字段(可精确跳转定位)
 * - page        : 应用页面(欢迎/历史/管理扩展/设置/关于)
 *
 * searchIndex(query) 大小写不敏感模糊匹配 title / description / keywords
 * (子串包含优先,缩写子序列兜底,见 fuzzy-match),按 SEARCH_ENTRY_KINDS
 * 顺序分组返回,组内按相关度降序;空查询返回全量(保持目录原顺序)。
 */

import { TOOL_CATALOG, getCatalogEntry, getCategoryById, pickText } from '@/lib/tool-catalog';
import { t } from '@/i18n';
import {
  TOOL_ANCHORS,
  SETTING_SECTIONS,
  SETTING_FIELDS,
  PAGE_ENTRIES,
  type SettingsMenuId,
} from './search-anchors';
import { fuzzyScore, NO_MATCH } from './fuzzy-match';
import type { AppView } from '@/store/uiStore';
import type { TextSearchOptions } from './editor-text-search';

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
  /** 文本搜索:匹配选项(大小写/整词/正则),编辑器高亮与列表同口径 */
  textSearchOptions?: TextSearchOptions;
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
  /** 双语匹配域(zh+en+keywords 拼接);命中判断优先使用,展示不渲染 */
  matchText?: string;
}

/** 全部条目(模块加载时构建一次;语言切换后经 rebuildSearchIndex 重建) */
let ALL_ENTRIES: readonly SearchEntry[] = buildAllEntries();

/** 语言切换后重建显示字段(title/description/group 随 locale 走) */
export function rebuildSearchIndex(): void {
  ALL_ENTRIES = buildAllEntries();
}

function buildAllEntries(): SearchEntry[] {
  const entries: SearchEntry[] = [];

  // —— 工具级条目 ——
  for (const entry of TOOL_CATALOG) {
    const view: AppView =
      entry.special === 'settings'
        ? 'settings'
        : entry.special === 'extensions'
          ? 'extensions'
          : 'tool';
    entries.push({
      id: `tool:${entry.id}`,
      kind: 'tool',
      title: pickText(entry.name),
      description: pickText(entry.description),
      keywords: [...entry.keywords],
      group: pickText(getCategoryById(entry.category).label),
      matchText: [
        entry.name.zh,
        entry.name.en,
        entry.description.zh,
        entry.description.en,
        ...entry.keywords,
      ].join(' '),
      target: { view, toolId: entry.id },
    });
  }

  // —— 工具区块条目 ——
  for (const [toolId, anchors] of Object.entries(TOOL_ANCHORS)) {
    const tool = getCatalogEntry(toolId);
    const group = tool ? pickText(tool.name) : toolId;
    for (const a of anchors) {
      entries.push({
        id: `${toolId}:${a.key}`,
        kind: 'tool-section',
        title: pickText(a.title),
        description: a.description ? pickText(a.description) : undefined,
        keywords: a.keywords ?? [],
        group,
        matchText: [
          a.title.zh,
          a.title.en,
          a.description?.zh,
          a.description?.en,
          ...(a.keywords ?? []),
        ]
          .filter(Boolean)
          .join(' '),
        target: { view: 'tool', toolId, anchor: `${toolId}:${a.key}` },
      });
    }
  }

  // —— 设置分区 ——
  for (const s of SETTING_SECTIONS) {
    entries.push({
      id: `setting:${s.menuId}`,
      kind: 'setting',
      title: pickText(s.title),
      description: pickText(s.description),
      keywords: [...s.keywords],
      group: t('chrome.search.group_settings'),
      matchText: [s.title.zh, s.title.en, s.description.zh, s.description.en, ...s.keywords].join(
        ' ',
      ),
      target: { view: 'settings', settingsMenu: s.menuId, anchor: `settings:${s.menuId}` },
    });
  }

  // —— 设置字段 ——
  for (const f of SETTING_FIELDS) {
    const section = SETTING_SECTIONS.find((s) => s.menuId === f.menuId);
    entries.push({
      id: `setting-field:${f.menuId}:${f.key}`,
      kind: 'setting-field',
      title: pickText(f.title),
      description: f.description ? pickText(f.description) : undefined,
      keywords: [...f.keywords],
      group: section ? pickText(section.title) : t('chrome.search.group_settings'),
      matchText: [f.title.zh, f.title.en, f.description?.zh, f.description?.en, ...f.keywords]
        .filter(Boolean)
        .join(' '),
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
      title: pickText(p.title),
      description: pickText(p.description),
      keywords: [...p.keywords],
      group: t('chrome.search.group_pages'),
      matchText: [p.title.zh, p.title.en, p.description.zh, p.description.en, ...p.keywords].join(
        ' ',
      ),
      target: { view: p.view },
    });
  }

  return entries;
}

/**
 * 计算条目对查询的模糊得分:matchText(双语 zh+en+keywords 拼接)是
 * 首选匹配域,命中即返回;标题兜底(展示字段,随 locale 走,matchText
 * 已覆盖双语场景,兜底仅防御性保留)。
 */
function scoreOf(entry: SearchEntry, q: string): number {
  if (entry.matchText) {
    const s = fuzzyScore(q, entry.matchText.toLowerCase());
    if (s !== NO_MATCH) return s;
  }
  if (entry.title) {
    const s = fuzzyScore(q, entry.title.toLowerCase());
    if (s !== NO_MATCH) return s;
  }
  return NO_MATCH;
}

/**
 * 按查询返回分组搜索结果(组内按模糊相关度降序)。
 * 空查询返回全量(目录原顺序,便于浏览全部功能);
 * 无匹配时返回空 Map(不含空数组分组)。
 */
export function searchIndex(query: string): Map<SearchEntryKind, SearchEntry[]> {
  const q = query.trim().toLowerCase();
  const result = new Map<SearchEntryKind, SearchEntry[]>();
  for (const kind of SEARCH_ENTRY_KINDS) {
    if (q === '') {
      const all = ALL_ENTRIES.filter((e) => e.kind === kind);
      if (all.length > 0) result.set(kind, all);
      continue;
    }
    const scored: { entry: SearchEntry; score: number }[] = [];
    for (const e of ALL_ENTRIES) {
      if (e.kind !== kind) continue;
      const s = scoreOf(e, q);
      if (s !== NO_MATCH) scored.push({ entry: e, score: s });
    }
    if (scored.length === 0) continue;
    // 稳定排序:同分保持目录原顺序,组内相对顺序不因打分抖动
    scored.sort((a, b) => b.score - a.score);
    result.set(
      kind,
      scored.map((s) => s.entry),
    );
  }
  return result;
}

/** 全量条目(供测试与调试) */
export function getAllSearchEntries(): readonly SearchEntry[] {
  return ALL_ENTRIES;
}

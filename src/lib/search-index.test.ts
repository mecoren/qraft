/**
 * search-index 单元测试 —— 覆盖搜索索引的完整性、匹配规则与分组行为。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { searchIndex, type SearchEntry, SEARCH_ENTRY_KINDS, getAllSearchEntries } from './search-index';
import { TOOL_ANCHORS } from './search-anchors';
import { TOOL_CATALOG } from '@/lib/tool-catalog';

/** 递归收集目录下全部 .tsx 文件 */
function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectTsx(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const SRC_ROOT = resolve(__dirname, '..');

/** 汇总全部含锚点标注的源码(工具组件 + 设置 + 页面 + 统一组件) */
function collectAnchorSource(): string {
  const files = [
    ...collectTsx(join(SRC_ROOT, 'tools')),
    join(SRC_ROOT, 'components/SettingsPanel.tsx'),
    join(SRC_ROOT, 'components/SettingsDialog.tsx'),
    join(SRC_ROOT, 'components/ui/code-editor.tsx'),
    join(SRC_ROOT, 'components/config-card.tsx'),
    join(SRC_ROOT, 'pages/WelcomePage.tsx'),
    join(SRC_ROOT, 'pages/ExtensionsPage.tsx'),
  ];
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

/** 扁平化搜索结果,便于断言 */
function flatResults(query: string): SearchEntry[] {
  return [...searchIndex(query).values()].flat();
}

describe('searchIndex', () => {
  it('空查询返回按 kind 分组的全量条目', () => {
    const result = searchIndex('');
    for (const kind of SEARCH_ENTRY_KINDS) {
      expect(result.has(kind)).toBe(true);
    }
    const total = [...result.values()].flat().length;
    // 至少包含:全部工具 + 每个工具 ≥1 个区块 + 设置分区/字段 + 页面
    expect(total).toBeGreaterThan(TOOL_CATALOG.length + 20);
  });

  it('工具级条目覆盖全部目录工具(含特殊页面)', () => {
    const tools = searchIndex('').get('tool') ?? [];
    for (const entry of TOOL_CATALOG) {
      expect(tools.some((t) => t.target.toolId === entry.id)).toBe(true);
    }
  });

  it('按名称大小写不敏感匹配', () => {
    expect(flatResults('base64').some((e) => e.kind === 'tool' && e.title.includes('Base64'))).toBe(
      true,
    );
    expect(flatResults('BASE64').some((e) => e.kind === 'tool' && e.title.includes('Base64'))).toBe(
      true,
    );
  });

  it('按关键词匹配', () => {
    expect(flatResults('jwt').some((e) => e.kind === 'tool')).toBe(true);
    expect(flatResults('二维码').some((e) => e.kind === 'tool')).toBe(true);
  });

  it('按描述匹配', () => {
    expect(flatResults('十六进制').some((e) => e.kind === 'tool')).toBe(true);
  });

  it('每个工具至少声明一个区块锚点', () => {
    const sections = searchIndex('').get('tool-section') ?? [];
    const toolIds = new Set(TOOL_CATALOG.filter((e) => !e.special).map((e) => e.id));
    for (const id of toolIds) {
      expect(sections.some((s) => s.target.toolId === id)).toBe(true);
    }
  });

  it('区块锚点值全局唯一', () => {
    const sections = searchIndex('').get('tool-section') ?? [];
    const anchors = sections.map((s) => s.target.anchor).filter(Boolean) as string[];
    expect(anchors.length).toBeGreaterThan(0);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('TOOL_ANCHORS 声明的每个锚点都生成了区块条目', () => {
    const sections = searchIndex('').get('tool-section') ?? [];
    for (const [toolId, anchors] of Object.entries(TOOL_ANCHORS)) {
      for (const a of anchors) {
        const full = `${toolId}:${a.key}`;
        expect(
          sections.some((s) => s.target.toolId === toolId && s.target.anchor === full),
        ).toBe(true);
      }
    }
  });

  it('搜索到工具内部区块文本', () => {
    expect(
      flatResults('生成实体类').some(
        (e) => e.kind === 'tool-section' && e.target.toolId === 'json_formatter',
      ),
    ).toBe(true);
    expect(
      flatResults('特殊字符').some(
        (e) => e.kind === 'tool-section' && e.target.toolId === 'password_generator',
      ),
    ).toBe(true);
  });

  it('设置分区可检索并携带 settingsMenu', () => {
    const settings = flatResults('快捷键');
    expect(
      settings.some((e) => e.kind === 'setting' && e.target.settingsMenu === 'shortcuts'),
    ).toBe(true);
    const themeSettings = flatResults('主题');
    expect(
      themeSettings.some((e) => e.kind === 'setting' && e.target.settingsMenu === 'theme'),
    ).toBe(true);
  });

  it('设置字段可检索', () => {
    expect(flatResults('最大历史数').some((e) => e.kind === 'setting-field')).toBe(true);
    expect(flatResults('检查更新').some((e) => e.kind === 'setting-field')).toBe(true);
  });

  it('页面条目可检索', () => {
    expect(
      flatResults('历史').some((e) => e.kind === 'page' && e.target.view === 'history'),
    ).toBe(true);
    expect(
      flatResults('管理扩展').some((e) => e.kind === 'page' && e.target.view === 'extensions'),
    ).toBe(true);
    expect(
      flatResults('关于').some((e) => e.kind === 'page' && e.target.view === 'about'),
    ).toBe(true);
  });

  it('无匹配时返回空分组', () => {
    const result = searchIndex('不存在的关键字zzzz');
    expect([...result.values()].flat().length).toBe(0);
  });
});

describe('锚点一致性', () => {
  it('组件中的字面量搜索锚点均已声明(防止前缀错位/误标注)', () => {
    const declared = new Set(
      getAllSearchEntries()
        .map((e) => e.target.anchor)
        .filter((a): a is string => Boolean(a)),
    );
    const allSrc = collectAnchorSource();
    const literalRe = /(?:searchAnchor|data-search-anchor)\s*=\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = literalRe.exec(allSrc))) {
      const a = m[1];
      // 页面区块锚点(欢迎页/扩展页)作为页面内定位使用,索引未单独声明,属预期
      if (a.startsWith('welcome:') || a.startsWith('extensions:')) continue;
      expect(declared.has(a), `组件标注的锚点「${a}」未在 search-anchors 中声明`).toBe(true);
    }
  });

  it('所有声明的区块锚点都能在组件源码中找到标注(字面量或模板)', () => {
    const allSrc = collectAnchorSource();
    for (const entry of getAllSearchEntries()) {
      const anchor = entry.target.anchor;
      if (!anchor || entry.kind === 'page') continue;
      const parts = anchor.split(':');
      // 字面量标注 "toolId:key";或模板标注:
      // - 两段式 `toolId:${dynamic}`(如 text_compare:${target} / settings:${item.id})
      // - 三段式 `settings:menu:${dynamic}`(如 settings:shortcuts:${s.key})
      const tplTwo = '`' + parts[0] + ':${';
      const tplThree = '`' + parts.slice(0, 2).join(':') + ':${';
      const found =
        allSrc.includes(`"${anchor}"`) ||
        // 条件表达式标注,如 {showCompare ? 'text_editor:compare' : undefined}
        allSrc.includes(`'${anchor}'`) ||
        allSrc.includes(tplTwo) ||
        allSrc.includes(tplThree);
      expect(found, `锚点「${anchor}」未在组件源码中标注`).toBe(true);
    }
  });
});

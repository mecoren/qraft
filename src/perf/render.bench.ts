/**
 * 前端渲染/纯函数层性能基准(vitest bench)
 *
 * 覆盖三个高频交互面的纯计算成本(渲染前的数据加工,jsdom 下无真实布局,
 * 用作**相对回归基线**:同机同噪声下的趋势对比,不承诺绝对数值):
 * - `search-index 全量过滤`:命令面板/全局搜索的索引线性匹配
 * - `compileMatcher 大文本匹配`:搜索高亮/行内 <mark> 的单行多次命中
 * - `searchTabsText 多文件搜索`:跨文件查找(含本批新增的替换链入口)
 * - `replaceInContent 多文件替换`:跨文件查找替换的核心纯函数
 *
 * 运行:`pnpm bench`(vitest bench,结果即时打印;趋势回填 docs/performance-baseline.md)
 * 对照口径:PRD「小输入 <50ms」覆盖的是 Rust 执行链;前端数据加工层以
 * 「万行级输入在毫秒量级」为健康区间,>10% 退化触发告警(同 criterion 规则)。
 */
import { bench, describe } from 'vitest';
import { searchIndex } from '@/lib/search-index';
import { compileMatcher, replaceInContent, searchTabsText } from '@/lib/editor-text-search';
import type { EditorTab } from '@/tools/code-editor-workspace/schema';

/** 100 行 × 平均 80 字符的合成文件(多份,构造跨文件搜索规模) */
function synthTab(id: string, lineCount = 100): EditorTab {
  const lines = Array.from(
    { length: lineCount },
    (_, i) => `line ${i}: the quick brown fox jumps over value-${i % 7}`,
  );
  const content = lines.join('\n');
  return {
    id,
    title: `file-${id}.txt`,
    path: null,
    language: 'plaintext',
    content,
    savedContent: content,
    pinned: false,
  };
}

const tabs = Array.from({ length: 10 }, (_, i) => synthTab(`t${i}`));
const bigLine = 'value target '.repeat(600); // ~7.8k 字符单行,命中密集

describe('前端数据加工层基准(jsdom,相对回归基线)', () => {
  bench('search-index 全量过滤(空查询全索引)', () => {
    searchIndex('');
  });

  bench('search-index 模糊查询(jsf 缩写全索引打分排序)', () => {
    searchIndex('jsf');
  });

  bench('compileMatcher 单行 600 次命中(大小写不敏感)', () => {
    const matcher = compileMatcher('value', {});
    matcher?.(bigLine);
  });

  bench('searchTabsText 10 文件×100 行', () => {
    searchTabsText(tabs, 'value', 50, {});
  });

  bench('replaceInContent 10 文件全文替换', () => {
    for (const tab of tabs) {
      replaceInContent(tab.content, 'value-3', 'X', {});
    }
  });
});

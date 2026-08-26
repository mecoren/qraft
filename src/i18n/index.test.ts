import { beforeEach, describe, expect, it } from 'vitest';
import { changeLocale, t } from './index';

describe('i18n 核心模块', () => {
  beforeEach(() => {
    changeLocale('zh-CN');
  });

  it('默认 zh-CN,缺失键回退返回键名本身', () => {
    expect(t('chrome.app.name')).toBe('Qraft');
    expect(t('nonexistent.key.path')).toBe('nonexistent.key.path');
  });

  it('切换到 en-US 后取值随动,插值生效', () => {
    changeLocale('en-US');
    expect(t('chrome.sidebar.tools')).toBe('All tools');
    expect(t('chrome.toast.copied_with_preview', { preview: 'abc' })).toContain('abc');
    // Phase 2 后 en 已补全分类译文;回退机制由缺失键用例覆盖
    expect(t('catalog.categories.graphic')).toBe('Graphics');
  });

  it('工具片段命名空间经 glob 聚合加载(zh/en)', () => {
    expect(t('tools.hash_calculator.compute')).toBe('计算');
    changeLocale('en-US');
    expect(t('tools.hash_calculator.compute')).toBe('Compute');
    changeLocale('zh-CN');
  });
});

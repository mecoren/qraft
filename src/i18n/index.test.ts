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
    // 回退:en 缺失的键回退 zh-CN
    expect(t('catalog.categories.graphic')).toBe('图像处理');
  });
});

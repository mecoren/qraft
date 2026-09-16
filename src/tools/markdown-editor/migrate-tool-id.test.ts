import { beforeEach, describe, expect, it } from 'vitest';
import { migrateMarkdownToolId } from './migrate-tool-id';

describe('migrateMarkdownToolId', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('收藏与最近中的旧 id 换成新 id(去重+幂等)', () => {
    window.localStorage.setItem(
      'qraft_ui_v1',
      JSON.stringify({
        favorites: ['markdown_preview', 'base64_codec'],
        recents: ['markdown_preview'],
      }),
    );
    migrateMarkdownToolId();
    migrateMarkdownToolId();
    const data = JSON.parse(window.localStorage.getItem('qraft_ui_v1') ?? '{}') as Record<
      string,
      string[]
    >;
    expect(data.favorites).toEqual(['markdown_editor', 'base64_codec']);
    expect(data.recents).toEqual(['markdown_editor']);
  });

  it('无旧 id 时不改写数据但置迁移旗', () => {
    window.localStorage.setItem('qraft_ui_v1', JSON.stringify({ favorites: ['a'] }));
    migrateMarkdownToolId();
    const data = JSON.parse(window.localStorage.getItem('qraft_ui_v1') ?? '{}') as Record<
      string,
      string[]
    >;
    expect(data.favorites).toEqual(['a']);
    expect(window.localStorage.getItem('qraft_markdown_id_migrated_v1')).toBe('1');
  });
});

/**
 * PathBreadcrumb 单元测试
 *
 * 验证:
 * - POSIX 路径按 / 拆分为多段,末段为 BreadcrumbPage
 * - Windows 路径(C:\\...\\)按 / 与 \\ 拆分为多段
 * - 空路径不渲染
 * - 中段与末段之间出现 BreadcrumbSeparator
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathBreadcrumb } from './PathBreadcrumb';

describe('PathBreadcrumb', () => {
  it('POSIX 路径按 / 拆分,末段为当前页', () => {
    render(<PathBreadcrumb path="/home/user/foo.md" data-testid="bc" />);

    // 段 + 间隔: 段:home / sep / user / sep / foo.md
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('foo.md').tagName.toLowerCase()).toBe('span');
    expect(screen.getByText('foo.md')).toHaveAttribute('aria-current', 'page');
    // 中段不是 current page
    expect(screen.getByText('home')).not.toHaveAttribute('aria-current', 'page');
  });

  it('Windows 路径按 / 与 \\ 拆分', () => {
    const { container } = render(
      <PathBreadcrumb path={'C:\\Users\\wait\\Downloads\\PTS轨道.md'} data-testid="bc" />,
    );

    expect(screen.getByText('C:')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('wait')).toBeInTheDocument();
    expect(screen.getByText('Downloads')).toBeInTheDocument();
    // 5 段 + 4 个分隔符 = 9 个 <li>;直接 DOM 计数避免 a11y 角色过滤
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(9);
    // 末段为当前页(BreadcrumbPage role="link" + aria-disabled="true")
    const current = screen.getAllByRole('link', { hidden: true });
    expect(current.length).toBe(1);
  });

  it('空路径不渲染', () => {
    const { container } = render(<PathBreadcrumb path="" data-testid="bc" />);
    expect(container.firstChild).toBeNull();
  });

  it('仅有一个分隔符的根级路径渲染为单段', () => {
    render(<PathBreadcrumb path="/" data-testid="bc" />);
    // "/" 拆分后为空数组 → 返回 null
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('连续分隔符折叠为单个', () => {
    const { container } = render(<PathBreadcrumb path="/home//user///foo.md" data-testid="bc" />);
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('foo.md')).toBeInTheDocument();
    // 段数等于 3(连续分隔符合并);每段独占一个 <li>,分隔符单独 <li> → 5 个
    expect(container.querySelectorAll('li').length).toBe(5);
  });

  it('中段与末段之间出现 BreadcrumbSeparator(默认 ChevronRight)', () => {
    const { container } = render(<PathBreadcrumb path="/home/user/foo.md" data-testid="bc" />);
    // shadcn BreadcrumbSeparator 用 lucide ChevronRight SVG
    const separators = container.querySelectorAll('li[role="presentation"]');
    expect(separators.length).toBe(2); // home<->user, user<->foo.md
  });

  it('单行渲染:列表不换行(flex-nowrap),各段可收缩省略(窄屏不溢出工具栏)', () => {
    const { container } = render(
      <PathBreadcrumb path={'D:\\DevTools\\project\\qraft\\docs\\foo.md'} data-testid="bc" />,
    );
    // BreadcrumbList 默认 flex-wrap 会在固定高度工具栏内换行溢出,
    // 必须覆盖为 flex-nowrap 保证单行
    const list = container.querySelector('ol');
    expect(list).not.toBeNull();
    expect(list).toHaveClass('flex-nowrap');
    expect(list?.className).not.toContain('flex-wrap');
    // 段落 li 与内容 span 均可收缩(min-w-0),内容超宽时以省略号截断而非换行
    for (const li of container.querySelectorAll('ol > li:not([role="presentation"])')) {
      expect(li).toHaveClass('min-w-0');
    }
    expect(screen.getByText('foo.md')).toHaveClass('truncate');
    // 分隔符不参与收缩,保持箭头形状
    for (const sep of container.querySelectorAll('li[role="presentation"]')) {
      expect(sep).toHaveClass('shrink-0');
    }
  });
});

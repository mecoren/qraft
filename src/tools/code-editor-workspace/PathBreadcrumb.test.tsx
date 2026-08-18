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
});

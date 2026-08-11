import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from './button-group';
import { Button } from './button';

describe('ButtonGroup (shadcn implementation)', () => {
  it('renders a group with role=group and data-slot', () => {
    const { container } = render(
      <ButtonGroup aria-label="toolbar">
        <Button>1</Button>
        <Button>2</Button>
      </ButtonGroup>,
    );
    const group = container.querySelector('[data-slot="button-group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('role')).toBe('group');
  });

  it('Button emits data-slot="button" so group selectors can match', () => {
    render(<Button>hi</Button>);
    const btn = screen.getByRole('button', { name: 'hi' });
    expect(btn.getAttribute('data-slot')).toBe('button');
  });

  it('single-level group keeps rounded corners on first/last buttons via group classes', () => {
    // 断言容器携带圆角分发所需的关键类,防止回归导致"丑陋"渲染。
    const { container } = render(
      <ButtonGroup>
        <Button>a</Button>
        <Button>b</Button>
        <Button>c</Button>
      </ButtonGroup>,
    );
    const group = container.querySelector('[data-slot="button-group"]')!;
    expect(group.className).toContain('rounded-none');
    expect(group.className).toContain('rounded-l-md');
    expect(group.className).toContain('rounded-r-md');
    expect(group.className).toContain('-ml-px');
  });

  it('nested ButtonGroups get gap-2 spacing class on the outer container', () => {
    const { container } = render(
      <ButtonGroup>
        <ButtonGroup>
          <Button>a</Button>
        </ButtonGroup>
        <ButtonGroup>
          <Button>b</Button>
          <Button>c</Button>
        </ButtonGroup>
      </ButtonGroup>,
    );
    const outer = container.querySelector('[data-slot="button-group"]')!;
    expect(outer.className).toContain('gap-2');
    // 内外两层均为 button-group 容器
    expect(container.querySelectorAll('[data-slot="button-group"]').length).toBe(3);
  });

  it('renders Separator and Text sub-components', () => {
    const { container } = render(
      <ButtonGroup>
        <ButtonGroupText>Text</ButtonGroupText>
        <ButtonGroupSeparator />
      </ButtonGroup>,
    );
    expect(container.querySelector('[data-slot="button-group-text"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="button-group-separator"]')).not.toBeNull();
  });
});

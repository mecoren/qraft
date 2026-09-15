/**
 * ScrollArea 共享原语单测 —— 横向模式「滚轮直通横向滚动」
 *
 * 背景:全部工具 Tab 栏(文本编辑器 / JSON 格式化器 / Markdown 预览 / 文本比较 /
 * PDF / Office / Excel 工作表条)统一走本原语的横向模式,悬浮时滚轮直接横向
 * 滚动(Chrome 标签栏同款)。此处只测原语语义:
 * - 有横向溢出时:纵向 deltaY 转成横向滚动并吞掉事件(防穿透滚动底层内容);
 *   触控板横扫(deltaX)走同一通道
 * - 无溢出 / Ctrl·Cmd+滚轮(缩放手势)/ 纵向模式:不吞事件、不改 scrollLeft
 * - viewportRef 合并:原语内部要拿 Viewport 挂 wheel 监听,必须保证外部
 *   viewportRef(对象 / 函数两种形态)仍能收到节点——这是回归防线
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { ScrollArea } from './scroll-area';

/** 取 Radix Viewport(真实横向滚动容器,wheel 监听挂在它上面) */
function getViewport(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector('[data-radix-scroll-area-viewport]');
  if (!viewport) throw new Error('viewport not found');
  return viewport as HTMLElement;
}

/**
 * 覆盖 jsdom 布局属性:scrollWidth / clientWidth / scrollLeft 默认全 0,
 * 无法反映「有横向溢出」,须按用例钉死(scrollLeft 用 get/set 影子变量可写可读)
 */
function stubLayout(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  let scrollLeft = 0;
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (v: number) => {
      scrollLeft = v;
    },
  });
}

describe('ScrollArea 横向模式:滚轮直通横向滚动', () => {
  it('有横向溢出时,纵向滚轮 delta 转成横向滚动并吞掉事件', () => {
    const { container } = render(
      <ScrollArea orientation="horizontal">
        <div className="w-[2000px]">tabs</div>
      </ScrollArea>,
    );
    const viewport = getViewport(container);
    stubLayout(viewport, 2000, 300);

    fireEvent.wheel(viewport, { deltaY: 120 });
    expect(viewport.scrollLeft).toBe(120);
    // 吞掉事件:preventDefault 生效(passive:false 原生监听)
    // jsdom 对 wheel 不强制 passive,断言 defaultPrevented 即可验证拦截语义
    // (上一次事件的 defaultPrevented 无法事后读,这里滚第二次并即时校验)
    const evt = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    viewport.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(viewport.scrollLeft).toBe(240);
  });

  it('向上滚动(负 delta)向左滚动;触控板横扫(deltaX)走同一通道', () => {
    const { container } = render(
      <ScrollArea orientation="horizontal">
        <div className="w-[2000px]">tabs</div>
      </ScrollArea>,
    );
    const viewport = getViewport(container);
    stubLayout(viewport, 2000, 300);

    // 向下滚:scrollLeft 从 0 增加到 120
    const down = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    viewport.dispatchEvent(down);
    expect(viewport.scrollLeft).toBe(120);

    // 向上滚:从 120 回落到 0
    const up = new WheelEvent('wheel', { deltaY: -120, cancelable: true });
    viewport.dispatchEvent(up);
    expect(viewport.scrollLeft).toBe(0);

    // 触控板横扫:deltaY=0、deltaX≠0 走同一通道
    const sweep = new WheelEvent('wheel', { deltaY: 0, deltaX: 60, cancelable: true });
    viewport.dispatchEvent(sweep);
    expect(viewport.scrollLeft).toBe(60);
  });

  it('无横向溢出时不劫持滚轮(放行给祖先滚动容器)', () => {
    const { container } = render(
      <ScrollArea orientation="horizontal">
        <div>tabs</div>
      </ScrollArea>,
    );
    const viewport = getViewport(container);
    stubLayout(viewport, 300, 300);

    const evt = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    viewport.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
    expect(viewport.scrollLeft).toBe(0);
  });

  it('Ctrl/Cmd+滚轮(缩放手势)不劫持', () => {
    const { container } = render(
      <ScrollArea orientation="horizontal">
        <div className="w-[2000px]">tabs</div>
      </ScrollArea>,
    );
    const viewport = getViewport(container);
    stubLayout(viewport, 2000, 300);

    const evt = new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, cancelable: true });
    viewport.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
    expect(viewport.scrollLeft).toBe(0);
  });

  it('纵向模式(默认)不挂 wheel 监听,滚轮行为完全原生', () => {
    const { container } = render(
      <ScrollArea>
        <div>content</div>
      </ScrollArea>,
    );
    const viewport = getViewport(container);
    stubLayout(viewport, 2000, 300);

    const evt = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    viewport.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});

describe('ScrollArea viewportRef 合并(原语内部占用节点后的透传回归)', () => {
  it('对象形式 ref 仍能收到 Viewport 节点(工具栏读 scrollLeft / scrollTo 依赖它)', () => {
    const ref: { current: HTMLDivElement | null } = { current: null };
    const { container } = render(
      <ScrollArea orientation="horizontal" viewportRef={ref}>
        <div>tabs</div>
      </ScrollArea>,
    );
    expect(ref.current).toBe(getViewport(container));
  });

  it('函数形式 ref 仍会被调用并收到节点', () => {
    const fn = vi.fn();
    render(
      <ScrollArea orientation="horizontal" viewportRef={fn}>
        <div>tabs</div>
      </ScrollArea>,
    );
    expect(fn).toHaveBeenCalled();
    const node = fn.mock.calls[fn.mock.calls.length - 1]?.[0];
    expect(node).toBeInstanceOf(HTMLDivElement);
    expect(node?.hasAttribute('data-radix-scroll-area-viewport')).toBe(true);
  });
});

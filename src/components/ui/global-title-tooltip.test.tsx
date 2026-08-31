/**
 * global-title-tooltip 单元测试
 *
 * 目标:全局接管所有原生 DOM title 悬停提示,替换为与 Monaco 查找组件
 * (Ctrl+F)一致的自绘浮层(text-xs / bg-popover-layer / 无动画)。
 *
 * 关键行为契约:
 * - hover 带 title 的元素:移除 title(抑制浏览器原生提示)并展示统一浮层
 * - 离开元素:浮层移除且 title 原样还原(React DOM 不漂移 + 保留无障碍名称)
 * - 查找组件(.find-widget)由 monaco-find-close-tooltip 专属接管,全局层跳过
 * - 不阻断事件传播:页面上其他 hover 监听不受影响
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachGlobalTitleTooltip } from './global-title-tooltip';

const HINT_SELECTOR = '[data-title-hint]';

function createTitledButton(title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute('title', title);
  return btn;
}

function hover(el: Element, relatedTarget: Element | null = null): void {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget }));
}

/** 在指定鼠标坐标处悬停(验证浮层位置随鼠标变化) */
function hoverAt(el: Element, x: number, y: number): void {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
}

/** 桩替换元素矩形与视口尺寸(jsdom 无布局) */
function stubLayout(el: HTMLElement, rect: Record<string, number>, viewport?: { w: number; h: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0, toJSON: () => ({}), ...rect }),
  });
  if (viewport) {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: viewport.w });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: viewport.h });
  }
}

/** 还原视口尺寸桩,避免影响后续用例 */
function restoreViewport(): void {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 0 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 0 });
}

function leave(el: Element, relatedTarget: Element | null = null): void {
  el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget }));
}

function flushObserver(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('global-title-tooltip', () => {
  let handle: ReturnType<typeof attachGlobalTitleTooltip> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    // setup.ts 为虚拟列表测试全局 mock 了 offsetWidth/offsetHeight(800/600),
    // 本文件的定位断言依赖「无布局」语义(jsdom 原生返回 0):
    // 归零后浮层的实测尺寸二次钳制在测试中不生效,只验证翻转/跟随逻辑
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 0,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 0,
    });
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    document.body.innerHTML = '';
    // 还原 setup.ts 的全局 mock,保持与其他测试文件一致的环境语义
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 600,
    });
  });

  it('hover 带 title 的元素:展示统一浮层,悬停期间 title 被移除', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('复制');
    document.body.appendChild(btn);

    hover(btn);

    const hint = document.body.querySelector<HTMLElement>(HINT_SELECTOR);
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe('复制');
    // 悬停期间移除 title,浏览器原生提示不再出现
    expect(btn.hasAttribute('title')).toBe(false);
  });

  it('浮层样式与查找组件提示完全一致(共享 HINT_LAYER_CLASS)', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('样式');
    document.body.appendChild(btn);

    hover(btn);

    const hint = document.body.querySelector<HTMLElement>(HINT_SELECTOR);
    // 背景必须实心 bg-popover:半透明的 popover-layer 在 Mica 透出区会显形为透明
    expect(hint?.className).toContain('bg-popover');
    expect(hint?.className).not.toContain('popover-layer');
    expect(hint?.className).toContain('text-xs');
    // 真实投影用内联 shadow token:shadow-md utility 在本应用解析为全透明
    expect(hint?.style.boxShadow).toBe('var(--shadow-card-hover)');
  });

  it('离开元素:浮层移除且 title 原样还原', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('复制');
    document.body.appendChild(btn);

    hover(btn);
    expect(document.body.querySelector(HINT_SELECTOR)).not.toBeNull();

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    leave(btn, outside);

    expect(document.body.querySelector(HINT_SELECTOR)).toBeNull();
    expect(btn.getAttribute('title')).toBe('复制');
  });

  it('在元素内部的子节点间移动不重复创建浮层', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('加粗');
    const icon = document.createElement('span');
    btn.appendChild(icon);
    document.body.appendChild(btn);

    hover(btn);
    hover(icon);

    // 进入子节点仍在源元素内:浮层保持且只有一层
    expect(document.body.querySelectorAll(HINT_SELECTOR)).toHaveLength(1);
    expect(document.body.querySelector(HINT_SELECTOR)?.textContent).toBe('加粗');
  });

  it('空 title 无提示意义,不触发浮层也不动属性', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('');
    document.body.appendChild(btn);

    hover(btn);

    expect(document.body.querySelector(HINT_SELECTOR)).toBeNull();
    expect(btn.getAttribute('title')).toBe('');
  });

  it('查找组件(.find-widget)由专属模块接管,全局层跳过避免双重浮层', () => {
    handle = attachGlobalTitleTooltip();
    const widget = document.createElement('div');
    widget.className = 'find-widget';
    const btn = createTitledButton('Close (Escape)');
    widget.appendChild(btn);
    document.body.appendChild(widget);

    hover(btn);

    expect(document.body.querySelector(HINT_SELECTOR)).toBeNull();
    // title 不被全局层动到,交由 monaco-find-close-tooltip 处理
    expect(btn.hasAttribute('title')).toBe(true);
  });

  it('不阻断事件传播:元素上其他 mouseover 监听正常收到事件', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('复制');
    document.body.appendChild(btn);

    let otherListenerFired = false;
    btn.addEventListener('mouseover', () => {
      otherListenerFired = true;
    });

    hover(btn);

    expect(otherListenerFired).toBe(true);
    expect(document.body.querySelector(HINT_SELECTOR)).not.toBeNull();
  });

  it('悬停源被移出 DOM(如关闭 Tab)时浮层自动收起', async () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('关闭');
    document.body.appendChild(btn);

    hover(btn);
    expect(document.body.querySelector(HINT_SELECTOR)).not.toBeNull();

    btn.remove();
    await flushObserver();

    expect(document.body.querySelector(HINT_SELECTOR)).toBeNull();
  });

  it('切换悬停目标:浮层文案随之切换,旧目标 title 还原', () => {
    handle = attachGlobalTitleTooltip();
    const btnA = createTitledButton('保存');
    const btnB = createTitledButton('另存为');
    document.body.append(btnA, btnB);

    hover(btnA);
    expect(document.body.querySelector(HINT_SELECTOR)?.textContent).toBe('保存');

    leave(btnA, btnB);
    hover(btnB);

    expect(document.body.querySelectorAll(HINT_SELECTOR)).toHaveLength(1);
    expect(document.body.querySelector(HINT_SELECTOR)?.textContent).toBe('另存为');
    expect(btnA.getAttribute('title')).toBe('保存');
  });

  it('元素贴近视口底部:浮层翻转到元素上方,不被窗口底边遮挡', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('保存全部');
    // 元素底边 690,视口高 720:下方仅剩 30px,放不下浮层(预估高度 36px)
    stubLayout(btn, { top: 660, bottom: 690, left: 100, right: 140 }, { w: 1280, h: 720 });
    document.body.appendChild(btn);

    hoverAt(btn, 110, 670);

    const hint = document.body.querySelector<HTMLElement>(HINT_SELECTOR);
    expect(hint).not.toBeNull();
    const top = Number.parseFloat(hint?.style.top ?? '0');
    // 翻转到元素上缘之上,且预估高度内不越过视口底边
    expect(top).toBeLessThan(660);
    expect(top + 36).toBeLessThanOrEqual(720 - 8);
    restoreViewport();
  });

  it('视口中部元素:浮层仍默认显示在元素下方', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('复制');
    stubLayout(btn, { top: 200, bottom: 230, left: 100, right: 140 }, { w: 1280, h: 720 });
    document.body.appendChild(btn);

    hoverAt(btn, 110, 210);

    const hint = document.body.querySelector<HTMLElement>(HINT_SELECTOR);
    const top = Number.parseFloat(hint?.style.top ?? '0');
    expect(top).toBe(236); // rect.bottom + GAP
    restoreViewport();
  });

  it('浮层左缘跟随鼠标位置(clientX),而非固定在元素左缘', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('加粗');
    // 宽按钮:元素左缘 100,鼠标悬停在元素中部 clientX=260
    stubLayout(btn, { top: 40, bottom: 70, left: 100, right: 420, width: 320 });
    document.body.appendChild(btn);

    hoverAt(btn, 260, 50);

    const hint = document.body.querySelector<HTMLElement>(HINT_SELECTOR);
    expect(Number.parseFloat(hint?.style.left ?? '0')).toBe(266); // clientX + GAP
  });

  it('鼠标贴近视口右缘:浮层向左翻转,不越过右边界', () => {
    handle = attachGlobalTitleTooltip();
    const btn = createTitledButton('使用正则表达式');
    stubLayout(btn, { top: 40, bottom: 70, left: 100, right: 140 }, { w: 1080, h: 720 });
    document.body.appendChild(btn);

    hoverAt(btn, 1050, 50);

    const hint = document.body.querySelector<HTMLElement>(HINT_SELECTOR);
    const left = Number.parseFloat(hint?.style.left ?? '0');
    // 右侧放不下:翻转到鼠标左侧,右缘贴近 clientX-GAP(实测宽扩展),不被 200px 推远
    expect(left).toBe(1044); // 本文件把 offsetWidth 归零 → clientX(1050) - GAP(6)
    restoreViewport();
  });

  it('dispose 后不再接管:hover 无浮层、title 不被移除', () => {
    handle = attachGlobalTitleTooltip();
    handle.dispose();
    handle = null;

    const btn = createTitledButton('复制');
    document.body.appendChild(btn);
    hover(btn);

    expect(btn.hasAttribute('title')).toBe(true);
    expect(document.body.querySelector(HINT_SELECTOR)).toBeNull();
  });
});

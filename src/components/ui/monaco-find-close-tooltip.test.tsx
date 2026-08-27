/**
 * monaco-find-close-tooltip 单元测试
 *
 * 背景:Monaco 查找组件内控件的悬停提示来自 Monaco 自家 HoverService
 * 浮层,在窗口右上角边缘会被裁剪/遮挡。
 * 本模块用捕获阶段事件委托抑制 Monaco hover,并展示应用内统一自绘浮层,
 * 覆盖查找组件内全部带 aria-label/title 的可悬停控件(输入框除外)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachFindCloseTooltip } from './monaco-find-close-tooltip';

function createFindCloseButton(title = 'Close (Escape)'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'codicon codicon-widget-close';
  btn.setAttribute('title', title);
  // 真实 Monaco 0.56:aria-label 为完整文案(本地化后含快捷键),title 不存在
  btn.setAttribute('aria-label', title);
  return btn;
}

function createFindWidget(): HTMLDivElement {
  const widget = document.createElement('div');
  widget.className = 'find-widget';
  document.body.appendChild(widget);
  return widget;
}

function flushObserver(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('monaco-find-close-tooltip', () => {
  let handle: ReturnType<typeof attachFindCloseTooltip> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    document.body.innerHTML = '';
  });

  it('观察期内插入的关闭按钮:title 被移除并转移到 data 属性', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    root.appendChild(widget);
    widget.appendChild(createFindCloseButton());

    await flushObserver();
    const btn = root.querySelector('.codicon-widget-close') as HTMLButtonElement;
    expect(btn.hasAttribute('title')).toBe(false);
    expect(btn.dataset.findHintText).toBe('Close (Escape)');
    expect(btn.getAttribute('aria-label')).toBe('Close (Escape)');
  });

  it('挂载前已存在的关闭按钮同样被处理(补偿初始渲染)', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    const widget = createFindWidget();
    widget.appendChild(createFindCloseButton());
    root.appendChild(widget);
    document.body.appendChild(root);

    handle = attachFindCloseTooltip(root);
    await flushObserver();

    const btn = root.querySelector('.codicon-widget-close') as HTMLButtonElement;
    expect(btn.hasAttribute('title')).toBe(false);
    expect(btn.dataset.findHintText).toBe('Close (Escape)');
  });

  it('hover 关闭按钮(委托 mouseover)时展示浮层,文案来自转移后的 data 属性', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    const btn = createFindCloseButton();
    widget.appendChild(btn);
    root.appendChild(widget);
    await flushObserver();

    // 模拟真实 hover:mouseover 从按钮冒泡(捕获阶段的根节点监听会收到)
    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();

    const hint = document.body.querySelector<HTMLElement>('[data-find-close-hint]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe('Close (Escape)');
  });

  it('hover 图标子元素(按钮内部 target)同样触发浮层', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    const btn = createFindCloseButton();
    const icon = document.createElement('span');
    icon.className = 'codicon';
    btn.appendChild(icon);
    widget.appendChild(btn);
    root.appendChild(widget);
    await flushObserver();

    icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();
    expect(document.body.querySelector('[data-find-close-hint]')).not.toBeNull();
  });

  it('鼠标离开(委托 mouseout)后浮层移除', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    const btn = createFindCloseButton();
    widget.appendChild(btn);
    root.appendChild(widget);
    await flushObserver();

    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();
    expect(document.body.querySelector('[data-find-close-hint]')).not.toBeNull();

    btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    await flushObserver();
    expect(document.body.querySelector('[data-find-close-hint]')).toBeNull();
  });

  it('无 title 只有 aria-label 的按钮(Monaco 0.56 实际形态):文案回落到 aria-label', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    const btn = createFindCloseButton();
    btn.removeAttribute('title');
    widget.appendChild(btn);
    root.appendChild(widget);
    await flushObserver();

    expect(btn.dataset.findHintText).toBe('Close (Escape)');
    // aria-label 必须保留(无障碍依赖)
    expect(btn.getAttribute('aria-label')).toBe('Close (Escape)');

    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();
    expect(document.body.querySelector('[data-find-close-hint]')?.textContent).toBe(
      'Close (Escape)',
    );
  });

  it('捕获阶段抑制:按钮上后挂的 Monaco 监听收不到悬停事件', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    const btn = createFindCloseButton();
    widget.appendChild(btn);
    root.appendChild(widget);
    await flushObserver();

    // 模拟 Monaco 挂在按钮上的 hover 监听(晚于我们的捕获委托注册)
    let monacoFired = false;
    btn.addEventListener('mouseover', () => {
      monacoFired = true;
    });

    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();

    expect(monacoFired).toBe(false);
    expect(document.body.querySelector('[data-find-close-hint]')).not.toBeNull();
  });

  it('统一样式:查找组件内其他按钮(箭头/开关)同样获得自绘提示', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    const arrowUp = document.createElement('button');
    arrowUp.setAttribute('aria-label', '上一个匹配项');
    const regexToggle = document.createElement('button');
    regexToggle.setAttribute('title', '使用正则表达式');
    widget.append(arrowUp, regexToggle);
    root.appendChild(widget);
    await flushObserver();

    // 箭头按钮:title 缺失 → 回落 aria-label
    arrowUp.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();
    expect(document.body.querySelector('[data-find-close-hint]')?.textContent).toBe('上一个匹配项');

    // 悬停另一个控件时浮层文案切换为新目标
    regexToggle.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();
    expect(document.body.querySelector('[data-find-close-hint]')?.textContent).toBe(
      '使用正则表达式',
    );

    // 预处理:两按钮的 title 均被移除、aria-label 保留
    expect(regexToggle.hasAttribute('title')).toBe(false);
    expect(regexToggle.getAttribute('aria-label')).toBe('使用正则表达式');
  });

  it('输入框本体不触发提示也不抑制事件', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    const input = document.createElement('input');
    input.setAttribute('aria-label', '查找');
    let monacoFired = false;
    input.addEventListener('mouseover', () => {
      monacoFired = true;
    });
    widget.appendChild(input);
    root.appendChild(widget);
    await flushObserver();

    input.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();

    expect(monacoFired).toBe(true);
    expect(document.body.querySelector('[data-find-close-hint]')).toBeNull();
  });

  it('靠近视口右缘时浮层向内翻转,不越过右边界', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);

    const widget = createFindWidget();
    const btn = createFindCloseButton();
    // 模拟按钮贴近视口右缘(jsdom 无布局,getBoundingClientRect 用桩替换)
    Object.defineProperty(btn, 'getBoundingClientRect', {
      value: () => ({
        x: 1040,
        y: 10,
        top: 10,
        left: 1040,
        right: 1056,
        bottom: 26,
        width: 16,
        height: 16,
        toJSON: () => ({}),
      }),
    });
    widget.appendChild(btn);
    root.appendChild(widget);
    await flushObserver();
    // 视口宽度压窄到 1080,按钮 right=1056,右侧仅剩 24px,不足以放下浮层
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1080,
    });

    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();

    const hint = document.body.querySelector<HTMLElement>('[data-find-close-hint]');
    expect(hint).not.toBeNull();
    // fixed 定位:left+预估宽度不应超过视口宽度
    const left = Number.parseFloat(hint?.style.left ?? '0');
    expect(left + 200).toBeLessThanOrEqual(1080);
  });

  it('dispose 后停止观察与委托:新插入的按钮不再被处理、hover 无效', async () => {
    const root = document.createElement('div');
    root.className = 'monaco-editor';
    document.body.appendChild(root);
    handle = attachFindCloseTooltip(root);
    handle.dispose();
    handle = null;

    const widget = createFindWidget();
    const btn = createFindCloseButton();
    widget.appendChild(btn);
    root.appendChild(widget);
    await flushObserver();

    expect(btn.hasAttribute('title')).toBe(true);

    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushObserver();
    expect(document.body.querySelector('[data-find-close-hint]')).toBeNull();
  });
});

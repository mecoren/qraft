/**
 * 启动稳定后的空闲预取:把「首次进入才加载」的重型懒加载链
 * (Markdown 工具 → mermaid/katex/markdown-worker 等 vendor chunk)提前到空闲期,
 * 消除用户首次点击该工具时 >2MB 的磁盘读取尖峰。
 *
 * 约束:绝不影响冷启动 —— dev 直接短路;生产固定延迟(默认 3s)后再等浏览器空闲,
 * 且应用生命周期内只生效一次。loaders 由调用方显式注入(动态 import 闭包),
 * 保持本模块与工具依赖图零耦合、可单测。
 */

let scheduled = false;

export function scheduleIdlePrefetch(options?: {
  /** 测试注入;缺省取 import.meta.env.DEV */
  dev?: boolean;
  delayMs?: number;
  loaders?: Array<() => Promise<unknown>>;
}): void {
  const dev = options?.dev ?? import.meta.env.DEV;
  if (scheduled || dev) return;
  scheduled = true;

  const run = (): void => {
    for (const load of options?.loaders ?? []) {
      void load().catch(() => {});
    }
  };

  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => run(), { timeout: 5000 });
    } else {
      // 兜底(jsdom / 旧 WebView):延迟 200ms 近似空闲时机
      window.setTimeout(run, 200);
    }
  }, options?.delayMs ?? 3000);
}

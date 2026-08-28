# 差异计算移出主线程 —— 设计文档

## 关键技术决策

1. **Web Worker 执行 computeLineDiff（根因级解法）**
   jsdiff 行级 diff 是 O(ND)，成本随文档规模与修改点数量增长（实测 30k 行/1000 处
   ≈ 630ms），在主线程执行必然阻塞输入。唯一不牺牲功能的解法是移出主线程。
   采用 Vite 原生 module worker 模式：`new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' })`，
   worker 内独立 import `diff` 包，主线程 bundle 不变。

2. **小输入同步快路径（混合策略）**
   双侧输入均 < `DIFF_SYNC_MAX_CHARS`(30k 字符) 时直接同步计算：
   - 小文档实测 < 数 ms，异步往返反而不值得；
   - jsdom 测试环境无稳定 Worker，小输入同步路径保证既有测试零改动仍绿。

3. **请求路由：单调 id + 只取最新**
   输入经 `useDeferredValue` 天然去抖；worker 结果按请求 id 路由，
   只接受最新一次请求的响应，过期响应丢弃。计算期间保留上一次
   `diffResult`（统计与高亮不清空），避免闪烁。

4. **Worker 单例复用**
   每个 TextDiffView 实例持有（或模块级共享）一个 worker；实例卸载时终止。
   worker 不可用（如环境不支持）时降级为同步计算，功能不缺失。

## 实现步骤（≤5）

1. 新建 `src/components/text-diff/diff.worker.ts`：消息协议
   `{ id, original, modified, includeWordDiff } → { id, result: LineDiffResult }`。
2. 新建 `src/components/text-diff/diff-service.ts`：
   - `createDiffService()` 封装 worker 生命周期与请求路由；
   - 暴露 `compute(original, modified, opts): Promise<LineDiffResult>`；
   - Worker 缺失时同步降级；提供 `dispose()`。
3. 改造 `TextDiffView`：`diffResult` 从 `useMemo` 改为 state + effect；
   小输入同步、大输入经 service 异步；保留旧结果直至新结果到达。
4. 测试：
   - `diff-service.test.ts`：同步路径、worker 缺失降级、过期响应丢弃；
   - 既有 `diff-utils.test.ts` / `TextCompare.test.tsx` 不改断言语义；
   - 新增大输入用例：`waitFor` 统计徽标最终一致。
5. 验证：typecheck + eslint + vitest 全量 + 浏览器复测 longtask 对比
   （目标：由差异计算引起的 >100ms 长任务消失）。

## 预期风险与边界

- **Tauri WebView2 module worker**：WebView2 支持 ES module worker；Vite 构建产物
  需在 release 构建后人工验证一次 worker 加载（dev 已验证）。
- **装饰越界**：异步结果到达时模型可能已再次变化——`buildDiffDecorations` 已有
  行号/列号夹取与越界跳过逻辑，天然兼容。
- **内存**：worker 持有请求期间的两份文本副本，响应后释放；单例复用避免频繁创建。
- **语义不变**：`LineDiffResult` 结构与统计口径不变，装饰注入、i18n、testid 均不动。

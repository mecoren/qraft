/**
 * 差异计算服务 —— 小输入同步快路径 + 大输入 Web Worker 异步路径
 *
 * 背景(见 prd/text-diff-perf-worker/): jsdiff 行级 diff 是 O(ND),30k 行/
 * 1000 处修改实测单次 ~630ms,在主线程执行必然阻塞输入;worker 化是根因级解法。
 *
 * 路由策略:
 * - 双侧输入均 <= DIFF_SYNC_MAX_CHARS 时同步计算(小文档 < 数 ms,异步往返
 *   反而增加延迟,且 jsdom 测试环境无 Worker,同步路径保证既有测试稳定);
 * - 大输入走 module worker(diff.worker.ts),Worker 惰性创建、单例复用;
 * - Worker 构造失败(资源加载失败等)时永久降级为同步计算,功能不缺失;
 * - 响应按请求 id 路由,支持乱序;调用方(视图层)自行只采纳最新请求结果。
 */
import { computeLineDiff } from './diff-utils';
import type { LineDiffResult } from './diff-utils';
import type { DiffWorkerRequest, DiffWorkerResponse } from './diff.worker';

/** 小输入同步阈值(单侧字符数):低于该值同步计算更快、无感知延迟 */
export const DIFF_SYNC_MAX_CHARS = 30_000;

/** 双侧输入是否都足够小,可走同步快路径 */
export function isSmallDiff(original: string, modified: string): boolean {
  return original.length <= DIFF_SYNC_MAX_CHARS && modified.length <= DIFF_SYNC_MAX_CHARS;
}

/** 在途请求登记:请求参数留档,worker 致命错误时用于同步兜底重算 */
interface PendingRequest {
  resolve: (result: LineDiffResult) => void;
  original: string;
  modified: string;
  includeWordDiff: boolean;
}

export interface DiffService {
  /**
   * 计算两份文本差异。
   * @param includeWordDiff 是否计算行内词级差异(透传 computeLineDiff)
   */
  compute(original: string, modified: string, includeWordDiff: boolean): Promise<LineDiffResult>;
  /** 终止 worker;dispose 后再 compute 会按需重建(懒创建) */
  dispose(): void;
}

export function createDiffService(): DiffService {
  let worker: Worker | null = null;
  /** Worker 构造/运行失败后置 true,永久走同步降级,避免反复失败 */
  let workerDisabled = false;
  let nextId = 1;
  const pendingMap = new Map<number, PendingRequest>();

  const ensureWorker = (): Worker | null => {
    if (workerDisabled) return null;
    if (worker) return worker;
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<DiffWorkerResponse>) => {
        const entry = pendingMap.get(e.data.id);
        if (entry) {
          pendingMap.delete(e.data.id);
          entry.resolve(e.data.result);
        }
      };
      // worker 脚本加载失败等致命错误:在途请求同步兜底重算,
      // 置降级标记,本次会话内不再尝试创建 worker
      w.onerror = () => {
        workerDisabled = true;
        worker = null;
        w.terminate();
        const waiting = [...pendingMap.values()];
        pendingMap.clear();
        for (const entry of waiting) {
          entry.resolve(computeLineDiff(entry.original, entry.modified, { includeWordDiff: entry.includeWordDiff }));
        }
      };
      worker = w;
      return w;
    } catch {
      workerDisabled = true;
      return null;
    }
  };

  const compute = (
    original: string,
    modified: string,
    includeWordDiff: boolean,
  ): Promise<LineDiffResult> => {
    if (isSmallDiff(original, modified)) {
      return Promise.resolve(computeLineDiff(original, modified, { includeWordDiff }));
    }
    const w = ensureWorker();
    if (!w) {
      return Promise.resolve(computeLineDiff(original, modified, { includeWordDiff }));
    }
    const id = nextId++;
    return new Promise<LineDiffResult>((resolve) => {
      pendingMap.set(id, { resolve, original, modified, includeWordDiff });
      w.postMessage({ id, original, modified, includeWordDiff } satisfies DiffWorkerRequest);
    });
  };

  const dispose = (): void => {
    worker?.terminate();
    worker = null;
    pendingMap.clear();
  };

  return { compute, dispose };
}

export type { DiffWorkerRequest, DiffWorkerResponse };

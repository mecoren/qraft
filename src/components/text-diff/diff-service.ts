/**
 * 差异计算服务 —— Monaco 原生优先 + jsdiff 同步/Worker 兜底
 *
 * 背景:并排差异之前全走 jsdiff,同 hunk 内无关增删会被硬配成「修改行」,
 * 词级还是整词粒度。现优先隐藏 DiffEditor(advanced 算法,字符级
 * innerChanges),分组与词级精度与行内原生 DiffEditor 同源;Monaco 不可用
 * (jsdom/SSR/加载失败/单次超时)时回退原快慢路径,功能不缺失。
 *
 * 路由策略:
 * - 先试 Monaco 原生(monaco-diff-service,隐藏实例串行计算);
 * - 失败即回退 jsdiff:双侧输入均 <= DIFF_SYNC_MAX_CHARS 时同步计算
 *   (小文档 < 数 ms,且 jsdom 测试环境无 Monaco/Worker,同步路径保证
 *   既有测试稳定);大输入走 module worker(diff.worker.ts),Worker 惰性
 *   创建、单例复用;
 * - Worker 构造失败(资源加载失败等)时永久降级为同步计算;
 * - 响应按请求 id 路由,支持乱序;调用方(视图层)自行只采纳最新请求结果。
 */
import { computeLineDiff, type ComputeLineDiffOptions } from './diff-utils';
import type { LineDiffResult } from './diff-utils';
import type { DiffWorkerRequest, DiffWorkerResponse } from './diff.worker';
import { createMonacoDiffService, isMonacoDiffUsable } from './monaco-diff-service';

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
  diffOptions: ComputeLineDiffOptions;
}

export interface DiffService {
  /**
   * 计算两份文本差异。
   * @param diffOptions 计算选项(includeWordDiff / ignoreWhitespace / ignoreCase / ignoreEol)
   */
  compute(
    original: string,
    modified: string,
    diffOptions: ComputeLineDiffOptions,
  ): Promise<LineDiffResult>;
  /** 终止 worker;dispose 后再 compute 会按需重建(懒创建) */
  dispose(): void;
}

/**
 * jsdiff 快慢路径服务(混合调度的兜底分支):小输入同步,大输入 Worker。
 * 单测可直接构造本分支验证路由语义,不依赖 Monaco 是否可用。
 */
export function createJsDiffService(): DiffService {
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
          entry.resolve(computeLineDiff(entry.original, entry.modified, entry.diffOptions));
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
    diffOptions: ComputeLineDiffOptions,
  ): Promise<LineDiffResult> => {
    if (isSmallDiff(original, modified)) {
      return Promise.resolve(computeLineDiff(original, modified, diffOptions));
    }
    const w = ensureWorker();
    if (!w) {
      return Promise.resolve(computeLineDiff(original, modified, diffOptions));
    }
    const id = nextId++;
    return new Promise<LineDiffResult>((resolve) => {
      pendingMap.set(id, { resolve, original, modified, diffOptions });
      w.postMessage({ id, original, modified, diffOptions } satisfies DiffWorkerRequest);
    });
  };

  const dispose = (): void => {
    worker?.terminate();
    worker = null;
    pendingMap.clear();
  };

  return { compute, dispose };
}

/**
 * 混合差异服务(默认入口):Monaco 原生优先,失败回退 jsdiff 快慢路径。
 * dispose 后不再重建 Monaco(自动走 jsdiff,与 Worker 永久降级同模式);
 * TextDiffView 只在卸载时 dispose,无重建需求。
 */
export function createDiffService(): DiffService {
  const monacoService = createMonacoDiffService();
  const jsdiffService = createJsDiffService();

  const compute = (
    original: string,
    modified: string,
    diffOptions: ComputeLineDiffOptions,
  ): Promise<LineDiffResult> => {
    // Monaco 明确不可用(jsdom/SSR)时同步直走 jsdiff:保持原快慢路径的
    // 同步时序语义(首个大请求同步建 Worker),单测与旧行为零漂移
    if (!isMonacoDiffUsable()) return jsdiffService.compute(original, modified, diffOptions);
    return monacoService.compute(original, modified, diffOptions).catch(() => {
      // Monaco 加载失败/单次超时:回退 jsdiff,差异功能不缺失(精度回到旧口径)
      return jsdiffService.compute(original, modified, diffOptions);
    });
  };

  const dispose = (): void => {
    monacoService.dispose();
    jsdiffService.dispose();
  };

  return { compute, dispose };
}

export type { DiffWorkerRequest, DiffWorkerResponse };

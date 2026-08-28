/**
 * 差异计算 Web Worker 入口 —— 把 jsdiff 的 O(ND) 计算移出主线程
 *
 * 协议:
 * - 请求 DiffWorkerRequest: { id, original, modified, includeWordDiff }
 * - 响应 DiffWorkerResponse: { id, result: LineDiffResult }
 * id 由主线程单调递增分配,响应按 id 路由回对应 Promise,天然支持乱序/并发。
 *
 * 注意:本文件运行在 worker 作用域(self 非 window),不能 import 任何
 * 触碰 DOM 的模块;diff-utils.ts 是纯函数封装,可安全复用。
 */
import { computeLineDiff } from './diff-utils';
import type { LineDiffResult } from './diff-utils';

export interface DiffWorkerRequest {
  id: number;
  original: string;
  modified: string;
  includeWordDiff?: boolean;
}

export interface DiffWorkerResponse {
  id: number;
  result: LineDiffResult;
}

// DOM lib 下 self 被推断为 Window,这里收窄为 worker 场景实际需要的最小接口
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DiffWorkerRequest>) => void) | null;
  postMessage: (msg: DiffWorkerResponse) => void;
};

ctx.onmessage = (e: MessageEvent<DiffWorkerRequest>) => {
  const { id, original, modified, includeWordDiff } = e.data;
  const result = computeLineDiff(original, modified, { includeWordDiff });
  ctx.postMessage({ id, result });
};

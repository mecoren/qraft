/**
 * Markdown 粘贴图片资产 —— 落盘与渲染期引用解析
 *
 * 粘贴路径:编辑器 paste 事件截获图片文件 → base64 → IPC
 * `md_save_image_asset`(写 app_data/markdown_assets/)→ 在光标处插入
 * `![image](mdasset:img-xxx.png)` 引用。
 *
 * 渲染路径:`mdasset:` 引用在面板注入前替换为 data URL(纯本地读取,
 * 零网络);data URL 进缓存,未修改的图片在两阶段渲染间直接复用。
 * 非 Tauri 环境(浏览器 dev / 测试)保存失败时回退 base64 data URL
 * 直接内联,粘贴能力不断崖。
 */

import { safeInvoke } from '@/lib/ipc';
import { LruCache } from '@/lib/lru-cache';

/**
 * data URL 内存缓存:资产名 → data URL(会话级,图片不重复读盘)。
 * 双上限 LRU:条数 120 / 字节 32MB——旧「满 120 条全清」不看字节,
 * 一张 5MB 截图的 base64 就占 ~6.7MB,十几张大图可无界吃内存;
 * 全清还会让下一次渲染把全部图片重新读盘+重编码。
 */
const assetCache = new LruCache<string, string>({
  maxEntries: 120,
  maxBytes: 32 * 1024 * 1024,
});

/** 文件类型 → 扩展名白名单(与 Rust 侧 ALLOWED_EXTS 对齐) */
const IMAGE_EXT_BY_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** 字节 → base64(兼容中文与二进制,分块避免栈溢出) */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export interface PastedImageResult {
  /** 插入编辑器的 markdown 图片引用 */
  markdown: string;
  /** 是否已落盘( false = 回退 data URL 内联) */
  persisted: boolean;
}

/**
 * 保存一张粘贴图片并生成 markdown 引用。
 * IPC 失败(非 Tauri 环境 / 写盘失败)时回退 data URL 内联,返回 persisted=false。
 */
export async function savePastedImage(file: File): Promise<PastedImageResult | null> {
  const ext = IMAGE_EXT_BY_TYPE[file.type];
  if (!ext) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = bytesToBase64(bytes);
  if (base64.length === 0) return null;

  try {
    const res = await safeInvoke<string>('md_save_image_asset', { base64, ext });
    if (res.ok && res.value) {
      return { markdown: `![image](mdasset:${res.value})`, persisted: true };
    }
  } catch {
    // 保存失败走 data URL 回退
  }
  return {
    markdown: `![image](data:${file.type};base64,${base64})`,
    persisted: false,
  };
}

/**
 * 把 HTML 中的 `mdasset:` 图片引用替换为 data URL。
 * 逐个读取资产(带缓存);缺失资产替换为占位 span,不阻塞其余渲染。
 * 无 mdasset 引用时原样返回(零开销快路径)。
 */
export async function resolveAssetImages(html: string): Promise<string> {
  if (!html.includes('mdasset:')) return html;

  const names = new Set<string>();
  for (const m of html.matchAll(/mdasset:([A-Za-z0-9._-]+)/g)) {
    names.add(m[1] ?? '');
  }

  const urlByAsset = new Map<string, string>();
  await Promise.all(
    Array.from(names).map(async (name) => {
      if (!name) return;
      const cached = assetCache.get(name);
      if (cached) {
        urlByAsset.set(name, cached);
        return;
      }
      try {
        const res = await safeInvoke<string>('md_read_image_asset', { name });
        if (res.ok && res.value) {
          const ext = name.split('.').pop() ?? 'png';
          const url = `data:image/${ext};base64,${res.value}`;
          assetCache.set(name, url);
          urlByAsset.set(name, url);
        }
      } catch {
        // 读取失败:占位由下方替换分支处理
      }
    }),
  );

  return html.replace(/src="(mdasset:[^"]*)"/g, (_whole, ref: string) => {
    const name = ref.slice('mdasset:'.length);
    const url = urlByAsset.get(name);
    return url ? `src="${url}"` : `src="" alt="missing:${name}" data-md-blocked-src="${ref}"`;
  });
}

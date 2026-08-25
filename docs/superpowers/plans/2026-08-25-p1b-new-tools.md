# P1-b 高频新工具批次 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐竞品分析 §3.1 缺口中的 5 个纯前端高频工具:文本统计、ULID 生成器、Basic Auth 生成器、IPv4 子网计算器、JSON↔CSV 转换器。

**Architecture:** 每个工具 = 纯函数(可独立测试)+ 「新代统一布局」组件(ConfigSection/ConfigRow/CodeEditor/ResizablePanel,参照 HashCalculator)+ 四处注册(registry / tool-catalog / search-anchors / 测试)。全部无后端、无 IPC、无执行历史(与 NumberBaseConverter 同口径)。快捷键三件套统一接入 `useToolShortcutActions`。

**Tech Stack:** React 19 + zustand(无需)+ lucide-react(已验证图标名)。**不引入任何 npm 依赖**(ULID/CSV 手写)。

## Global Constraints

- 命令:`pnpm test -- <path>` / `pnpm typecheck` / `pnpm lint`
- 提交:conventional commits 中文;一工具一提交
- 注册点清单(每个工具必做,缺一会被既有测试拦截):
  1. `src/tools/<Component>.tsx` 组件(命名导出,`ToolProps` 契约)
  2. `src/tools/registry.ts` 追加 `registerTool('<id>', () => import('./<Component>').then(m => ({ default: m.<Component> })))`
  3. `src/lib/tool-catalog.ts` 追加 CatalogEntry(id/name/description/category/icon/keywords,**无 backendId**)
  4. `src/lib/search-anchors.ts` 的 TOOL_ANCHORS 追加 ≥1 锚点(search-index.test 强制)
- UI 文案中文;effect 内禁止同步 setState

---

### Task 1: 文本统计(text_statistics)

**Files:**
- Create: `src/tools/TextStatistics.tsx`
- Modify: registry.ts / tool-catalog.ts / search-anchors.ts
- Test: `src/tools/TextStatistics.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `src/tools/TextStatistics.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TextStatistics, computeStats } from './TextStatistics';

describe('computeStats', () => {
  it('统计字符/去空格字符/词数/行数/字节数', () => {
    const s = computeStats('hello 世界\nfoo bar');
    expect(s.chars).toBe(16);
    expect(s.lines).toBe(2);
    expect(s.bytes).toBe(Buffer.byteLength('hello 世界\nfoo bar', 'utf8'));
    expect(s.words).toBeGreaterThan(0);
  });

  it('空输入全零', () => {
    expect(computeStats('')).toEqual({ chars: 0, charsNoSpaces: 0, words: 0, lines: 0, bytes: 0 });
  });
});

describe('TextStatistics', () => {
  it('输入后即时显示统计结果', () => {
    render(<TextStatistics toolId="text_statistics" metadata={null as never} />);
    const box = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(box, { target: { value: 'hello' } });
    expect(screen.getByTestId('stat-chars')).toHaveTextContent('5');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/tools/TextStatistics.test.tsx`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**

创建 `src/tools/TextStatistics.tsx`:

```tsx
/**
 * 文本统计 —— 字符/词数/行数/字节 即时统计(纯前端,useMemo 实时计算)。
 */
import { useMemo, useState, type JSX } from 'react';
import { Sigma } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import type { ToolProps } from './registry';

export interface TextStats {
  chars: number;
  charsNoSpaces: number;
  words: number;
  lines: number;
  bytes: number;
}

export function computeStats(text: string): TextStats {
  const trimmed = text.replace(/\n$/, '');
  return {
    chars: text.length,
    charsNoSpaces: text.replace(/\s/g, '').length,
    words: (text.match(/\S+/g) ?? []).length,
    lines: trimmed === '' ? 0 : trimmed.split('\n').length,
    bytes: new TextEncoder().encode(text).length,
  };
}

const ROWS: ReadonlyArray<{ key: keyof TextStats; label: string }> = [
  { key: 'chars', label: '字符数' },
  { key: 'charsNoSpaces', label: '字符数(不含空白)' },
  { key: 'words', label: '词数' },
  { key: 'lines', label: '行数' },
  { key: 'bytes', label: '字节数(UTF-8)' },
];

export function TextStatistics({ toolId }: ToolProps): JSX.Element {
  const [text, setText] = useState('');
  const stats = useMemo(() => computeStats(text), [text]);
  const summary = ROWS.map((r) => `${r.label}: ${stats[r.key]}`).join('\n');

  return (
    <div className="flex h-full flex-col gap-3" data-testid="text-statistics">
      <ConfigSection title="" searchAnchor="text_statistics:config">
        <p className="px-4 py-2 text-xs text-muted-foreground">输入内容后即时统计,数据不出设备。</p>
      </ConfigSection>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={55} minSize={20}>
          <CodeEditor
            title="输入"
            value={text}
            onChange={(v) => setText(v)}
            showClear
            language="plaintext"
            searchAnchor="text_statistics:input"
            data-testid="input"
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={45} minSize={20}>
          <div className="flex h-full flex-col" data-testid="output">
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <span className="text-xs font-medium">统计结果</span>
              <CopyAction text={summary} testId="copy-stats" />
            </div>
            <div className="flex-1 overflow-auto p-3">
              <dl className="grid gap-2">
                {ROWS.map((r) => (
                  <div key={r.key} className="flex items-center justify-between rounded border px-3 py-1.5">
                    <dt className="text-xs text-muted-foreground">{r.label}</dt>
                    <dd className="font-mono text-sm" data-testid={`stat-${r.key}`}>
                      {stats[r.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
```

注:若 CodeEditor 不透传 `data-testid`,改用外层 div 包裹并放 testid(以 ui/code-editor.tsx 实际 props 为准,现有测试均依赖 `data-testid="input"` 可用,大概率直接支持)。

注册(`registry.ts` 纯前端区):

```ts
registerTool('text_statistics', () =>
  import('./TextStatistics').then((m) => ({ default: m.TextStatistics })),
);
```

catalog(tool-catalog.ts,text 分类注释块;icon import 加 `Sigma`):

```ts
{
  id: 'text_statistics',
  name: '文本统计',
  description: '统计字符、词数、行数与 UTF-8 字节数',
  category: 'text',
  icon: Sigma,
  keywords: ['word count', '字数统计', 'lines', 'bytes'],
},
```

anchors(search-anchors.ts TOOL_ANCHORS):

```ts
'text_statistics:config': ['文本统计', '统计'],
'text_statistics:input': ['输入'],
```

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/tools/TextStatistics.test.tsx src/lib/search-index.test.ts && pnpm typecheck && pnpm lint`

- [ ] **Step 5: Commit**

```bash
git add src/tools/TextStatistics.tsx src/tools/TextStatistics.test.tsx src/tools/registry.ts src/lib/tool-catalog.ts src/lib/search-anchors.ts
git commit -m "feat(tools): 新增文本统计工具(字符/词数/行数/字节)"
```

---

### Task 2: ULID 生成器(ulid_generator)

**Files:**
- Create: `src/tools/UlidGenerator.tsx`;Modify: 三处注册;Test: `src/tools/UlidGenerator.test.tsx`
- 额外:`tool-catalog.ts` 中 uuid_generator 条目的 keywords 移除 `'ulid'`(搜索归新工具)

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UlidGenerator, generateUlid, isValidUlid } from './UlidGenerator';

describe('generateUlid', () => {
  it('生成 26 位 Crockford Base32 大写串且时间部分单调', () => {
    const a = generateUlid();
    const b = generateUlid(Date.now() + 5);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // 同毫秒内前缀相等合法,跨毫秒必须不小于
    expect(b.slice(0, 10) >= a.slice(0, 10)).toBe(true);
  });

  it('isValidUlid 拒绝非法字符与错误长度', () => {
    expect(isValidUlid(generateUlid())).toBe(true);
    expect(isValidUlid('ILOUABCDEFJKLMNOPQRSTUVWXYZ')).toBe(false);
    expect(isValidUlid('ABC')).toBe(false);
  });
});

describe('UlidGenerator', () => {
  it('点击生成默认输出 5 行', () => {
    render(<UlidGenerator toolId="ulid_generator" metadata={null as never} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const out = screen.getByTestId('output').querySelector('textarea')!;
    expect(out.value.split('\n')).toHaveLength(5);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/tools/UlidGenerator.test.tsx` → FAIL

- [ ] **Step 3: 实现**

创建 `src/tools/UlidGenerator.tsx`(核心:48bit ms 时间戳 + 80bit 随机,Crockford Base32):

```tsx
/** ULID 生成器 —— 纯前端 crypto.getRandomValues,按毫秒时间戳有序。 */
import { useState, type JSX } from 'react';
import { FileDigit } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import type { ToolProps } from './registry';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 校验 26 位 Crockford Base32(不含 I/L/O/U) */
export function isValidUlid(s: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
}

/** 生成 ULID:前 10 字符 = 毫秒时间戳(48bit),后 16 字符 = 80bit 随机 */
export function generateUlid(now = Date.now()): string {
  let time = now;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ENCODING[time % 32]! + timePart;
    time = Math.floor(time / 32);
  }
  let randomPart = '';
  for (let i = 0; i < 16; i++) {
    randomPart += ENCODING[bytes[i]! & 31]!;
  }
  return timePart + randomPart;
}

export function UlidGenerator({ toolId }: ToolProps): JSX.Element {
  const [count, setCount] = useState(5);
  const [output, setOutput] = useState('');

  function handleGenerate(): void {
    const n = Math.min(100, Math.max(1, Math.floor(count) || 1));
    setOutput(Array.from({ length: n }, () => generateUlid()).join('\n'));
  }

  useToolShortcutActions(toolId, {
    execute: () => handleGenerate(),
    clearInput: () => setOutput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="ulid-generator">
      <ConfigSection title="" searchAnchor="ulid_generator:config">
        <ConfigRow label="数量" hint="1–100,每行一个">
          <Input
            aria-label="生成数量"
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-24"
          />
        </ConfigRow>
      </ConfigSection>
      <CodeEditor
        title="ULID"
        language="plaintext"
        readOnly
        value={output}
        data-testid="output"
        searchAnchor="ulid_generator:output"
        actions={
          <>
            <HeaderAction onClick={() => handleGenerate()}>生成</HeaderAction>
            {output && <CopyAction text={output} testId="copy-ulid" />}
          </>
        }
      />
    </div>
  );
}
```

(测试中的时间有序断言写法:`expect(b.slice(0, 10) >= a.slice(0, 10)).toBe(true)` —— 同毫秒内相等合法。)

注册:registry 同模板(id `ulid_generator`);catalog:

```ts
{
  id: 'ulid_generator',
  name: 'ULID 生成器',
  description: '生成按时间排序的 26 位 ULID 标识符',
  category: 'generator',
  icon: FileDigit,
  keywords: ['ulid', 'sortable id', '标识符'],
},
```

anchors:`'ulid_generator:config': ['ULID']`。uuid_generator keywords 删 `'ulid'`。

- [ ] **Step 4: 验证**

Run: `pnpm test -- src/tools/UlidGenerator.test.tsx src/lib/search-index.test.ts && pnpm typecheck && pnpm lint`

- [ ] **Step 5: Commit**

```bash
git add -A src/tools src/lib
git commit -m "feat(tools): 新增 ULID 生成器(Crockford Base32,时间有序)"
```

---

### Task 3: Basic Auth 生成器(basic_auth_generator)

**Files:** Create `src/tools/BasicAuthGenerator.tsx` + 三处注册 + Test

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BasicAuthGenerator, encodeBasicAuth } from './BasicAuthGenerator';

describe('encodeBasicAuth', () => {
  it('ASCII 凭据等价 btoa', () => {
    expect(encodeBasicAuth('user', 'pass')).toBe('Basic dXNlcjpwYXNz');
  });

  it('Unicode 凭据按 UTF-8 编码(RFC 7617 charset)', () => {
    expect(encodeBasicAuth('用户', '密码')).toBe(
      `Basic ${Buffer.from('用户:密码', 'utf8').toString('base64')}`,
    );
  });
});

describe('BasicAuthGenerator', () => {
  it('输入用户名密码后输出 Authorization 头', () => {
    render(<BasicAuthGenerator toolId="basic_auth_generator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'user' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'pass' } });
    expect(screen.getByTestId('auth-output').value ?? screen.getByTestId('auth-output').textContent)
      .toContain('dXNlcjpwYXNz');
  });
});
```

- [ ] **Step 2: 运行失败** → `pnpm test -- src/tools/BasicAuthGenerator.test.tsx` FAIL

- [ ] **Step 3: 实现**(单列布局,两个 LineEditor/Input + 只读输出)

```tsx
/** Basic Auth 生成器 —— user:password → Authorization 头(UTF-8 安全)。 */
import { useMemo, useState, type JSX } from 'react';
import { KeyRound } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import type { ToolProps } from './registry';

export function encodeBasicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

export function BasicAuthGenerator({ toolId }: ToolProps): JSX.Element {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const header = useMemo(() => encodeBasicAuth(user, password), [user, password]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="basic-auth-generator">
      <ConfigSection title="" searchAnchor="basic_auth_generator:config">
        <ConfigRow icon={KeyRound} label="用户名">
          <Input aria-label="用户名" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
        </ConfigRow>
        <ConfigRow icon={KeyRound} label="密码" hint="仅在本机内存中计算,不落盘不上传">
          <Input aria-label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </ConfigRow>
      </ConfigSection>
      <CodeEditor
        title="Authorization 头"
        language="plaintext"
        readOnly
        value={header}
        searchAnchor="basic_auth_generator:output"
        data-testid="auth-output"
        actions={<CopyAction text={header} testId="copy-auth" />}
      />
    </div>
  );
}
```

(`toolId` 未直接使用会有 unused 警告 → 接入 `useToolShortcutActions`:execute=undefined、clearInput=重置两输入、copyOutput=复制 header,顺带满足一致性。)

catalog(icon `KeyRound`,category `'encoder'`,keywords `['basic auth','authorization','认证头']`)、anchors `['Basic Auth','认证']`、registry 同模板。

- [ ] **Step 4–5:** 验证同上;`git commit -m "feat(tools): 新增 Basic Auth 生成器(UTF-8 安全)"`

---

### Task 4: IPv4 子网计算器(ipv4_subnet_calculator)

**Files:** Create `src/tools/Ipv4SubnetCalculator.tsx` + 三处注册 + Test

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Ipv4SubnetCalculator, parseCidr } from './Ipv4SubnetCalculator';

describe('parseCidr', () => {
  it('/24 解析网络地址/掩码/广播/可用主机范围与数量', () => {
    const r = parseCidr('192.168.1.10/24');
    expect(r).not.toBeNull();
    expect(r!.network).toBe('192.168.1.0');
    expect(r!.netmask).toBe('255.255.255.0');
    expect(r!.wildcard).toBe('0.0.0.255');
    expect(r!.broadcast).toBe('192.168.1.255');
    expect(r!.firstHost).toBe('192.168.1.1');
    expect(r!.lastHost).toBe('192.168.1.254');
    expect(r!.usableHosts).toBe(254);
  });

  it('/31 点对点与 /32 单机特殊口径', () => {
    expect(parseCidr('10.0.0.5/31')!.usableHosts).toBe(2);
    expect(parseCidr('10.0.0.5/32')!.usableHosts).toBe(1);
  });

  it('非法输入返回 null', () => {
    expect(parseCidr('999.1.1.1/24')).toBeNull();
    expect(parseCidr('abc')).toBeNull();
    expect(parseCidr('1.2.3.4/33')).toBeNull();
  });
});

describe('Ipv4SubnetCalculator', () => {
  it('输入 CIDR 渲染关键行', () => {
    render(<Ipv4SubnetCalculator toolId="ipv4_subnet_calculator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('CIDR'), { target: { value: '10.0.0.1/8' } });
    expect(screen.getByTestId('subnet-network')).toHaveTextContent('10.0.0.0');
    expect(screen.getByTestId('subnet-hosts')).toHaveTextContent('16,777,214');
  });
});
```

- [ ] **Step 2:** FAIL 确认

- [ ] **Step 3: 实现**(核心 uint32 位运算;数字格式化 `Intl.NumberFormat('en-US')`)

```tsx
/** IPv4 子网计算器 —— CIDR → 网络/掩码/广播/主机范围(纯位运算)。 */
import { useMemo, useState, type JSX } from 'react';
import { Network } from 'lucide-react';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import type { ToolProps } from './registry';

export interface SubnetInfo {
  network: string; netmask: string; wildcard: string; broadcast: string;
  firstHost: string; lastHost: string; totalAddrs: number; usableHosts: number;
}

export function parseIpv4(s: string): number | null {
  const parts = s.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function toIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function parseCidr(input: string): SubnetInfo | null {
  const m = input.trim().match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const ip = parseIpv4(m[1]!);
  const prefix = m[2] === undefined ? 32 : Number(m[2]);
  if (ip === null || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  const usable = prefix >= 31 ? total : total - 2;
  return {
    network: toIp(network),
    netmask: toIp(mask),
    wildcard: toIp(~mask >>> 0),
    broadcast: toIp(broadcast),
    firstHost: toIp(prefix >= 31 ? network : network + 1),
    lastHost: toIp(prefix >= 31 ? broadcast : broadcast - 1),
    totalAddrs: total,
    usableHosts: usable,
  };
}

const fmt = new Intl.NumberFormat('en-US');

export function Ipv4SubnetCalculator({ toolId }: ToolProps): JSX.Element {
  const [raw, setRaw] = useState('');
  const info = useMemo(() => parseCidr(raw), [raw]);
  const rows: Array<{ k: string; v: string; tid?: string }> = info
    ? [
        { k: '网络地址', v: `${info.network}/${raw.includes('/') ? raw.split('/')[1]! : '32'}`, tid: 'subnet-network' },
        { k: '子网掩码', v: info.netmask },
        { k: '反掩码', v: info.wildcard },
        { k: '广播地址', v: info.broadcast },
        { k: '第一个主机', v: info.firstHost },
        { k: '最后一个主机', v: info.lastHost },
        { k: '总地址数', v: fmt.format(info.totalAddrs) },
        { k: '可用主机数', v: fmt.format(info.usableHosts), tid: 'subnet-hosts' },
      ]
    : [];
  return (
    <div className="flex h-full flex-col gap-3" data-testid="ipv4-subnet-calculator">
      <ConfigSection title="" searchAnchor="ipv4_subnet_calculator:config">
        <ConfigRow icon={Network} label="CIDR" hint="如 192.168.1.10/24,省略前缀按 /32">
          <Input aria-label="CIDR" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.0.0.0/0" />
        </ConfigRow>
      </ConfigSection>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card p-3" data-testid="output">
        {!info && raw.trim() !== '' && (
          <p role="alert" className="text-sm text-destructive">无法解析的 CIDR 表达式</p>
        )}
        {info && (
          <dl className="grid gap-2">
            {rows.map((r) => (
              <div key={r.k} className="flex items-center justify-between rounded border px-3 py-1.5">
                <dt className="text-xs text-muted-foreground">{r.k}</dt>
                <dd className="flex items-center gap-2 font-mono text-sm" data-testid={r.tid}>
                  {r.v}
                  <CopyAction text={r.v} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
```

catalog(icon `Network`,category `'converter'`,keywords `['subnet','cidr','netmask','子网掩码']`),anchors `['子网','CIDR']`。

- [ ] **Step 4–5:** 验证;`git commit -m "feat(tools): 新增 IPv4 子网计算器"`

---

### Task 5: JSON↔CSV 转换器(json_csv_converter)

**Files:** Create `src/tools/JsonCsvConverter.tsx`(含 csv 序列化/状态机解析纯函数)+ 三处注册 + Test

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { JsonCsvConverter, jsonToCsv, csvToJson } from './JsonCsvConverter';

describe('jsonToCsv', () => {
  it('对象数组转 CSV,列取键并集,逗号/引号正确转义', () => {
    const csv = jsonToCsv([
      { name: 'a,b', age: 1 },
      { name: '"q"', note: 'line\nbreak' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('name,age,note');
    expect(lines[1]).toBe('"a,b",1,');
    expect(lines[2]).toBe('"""q""",,"line\nbreak"'); // 引号包裹内的换行原样保留
  });

  it('空数组返回空串', () => {
    expect(jsonToCsv([])).toBe('');
  });
});

describe('csvToJson', () => {
  it('状态机解析:引号内逗号/换行/转义引号', () => {
    const rows = csvToJson('a,b\r\n"x,1","y""z"\r\n2,3');
    expect(rows[1]).toEqual(['x,1', 'y"z']);
    expect(rows[2]).toEqual(['2', '3']);
  });

  it('首行为表头时输出对象数组', () => {
    const arr = csvToJson('name,age\nli,18', true);
    expect(arr).toEqual([{ name: 'li', age: '18' }]);
  });
});

describe('JsonCsvConverter', () => {
  it('JSON→CSV 方向端到端', () => {
    render(<JsonCsvConverter toolId="json_csv_converter" metadata={null as never} />);
    const input = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(input, { target: { value: '[{"a":1},{"a":2}]' } });
    const out = screen.getByTestId('output').querySelector('textarea')!;
    expect(out.value).toContain('a');
    expect(out.value).toContain('2');
  });
});
```

- [ ] **Step 2:** FAIL 确认

- [ ] **Step 3: 实现**(方向切换 Tabs:json_to_csv / csv_to_json;分隔符固定逗号,YAGNI)

```tsx
/** JSON↔CSV 转换器 —— RFC 4180 口径(引号/CRLF/转义),纯前端状态机解析。 */
import { useDeferredValue, useMemo, useState, type JSX } from 'react';
import { Table2 } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ToolProps } from './registry';

type Direction = 'json_to_csv' | 'csv_to_json';

function csvField(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 对象数组 → CSV(RFC 4180,CRLF 行尾,列取键并集) */
export function jsonToCsv(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) return '';
  const columns = [...new Set(items.flatMap((o) => Object.keys(o)))];
  const lines = [columns.map(csvField).join(',')];
  for (const o of items) lines.push(columns.map((c) => csvField(o[c])).join(','));
  return lines.join('\r\n');
}

/** CSV → 字符串二维数组(状态机:引号段内逗号/换行/CRLF/双引号转义均不切分) */
export function csvRows(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const push = () => { row.push(field); field = ''; };
  const endRow = () => { push(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      push();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
  }
  if (field !== '' || row.length > 0 || rows.length === 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** CSV → 对象数组(首行为表头;值一律字符串) */
export function csvToJson(text: string, header = true): Array<Record<string, string>> | string[][] {
  const rows = csvRows(text);
  if (!header) return rows;
  if (rows.length === 0) return [];
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

function flattenOneLevel(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return { value: value as never };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
  }
  return out;
}

export function JsonCsvConverter({ toolId }: ToolProps): JSX.Element {
  const [direction, setDirection] = useState<Direction>('json_to_csv');
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);

  const output = useMemo(() => {
    if (!deferred.trim()) return '';
    try {
      if (direction === 'json_to_csv') {
        const parsed: unknown = JSON.parse(deferred);
        const arr = Array.isArray(parsed) ? parsed.map(flattenOneLevel) : [flattenOneLevel(parsed)];
        return jsonToCsv(arr);
      }
      return JSON.stringify(csvToJson(deferred, true), null, 2);
    } catch (e) {
      return `转换失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [deferred, direction]);

  useToolShortcutActions(toolId, {
    clearInput: () => setText(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    <div className="flex h-full flex-col gap-3" data-testid="json-csv-converter">
      <ConfigSection title="" searchAnchor="json_csv_converter:config">
        <ConfigRow icon={Table2} label="方向">
          <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)}>
            <TabsList>
              <TabsTrigger value="json_to_csv">JSON → CSV</TabsTrigger>
              <TabsTrigger value="csv_to_json">CSV → JSON</TabsTrigger>
            </TabsList>
          </Tabs>
        </ConfigRow>
      </ConfigSection>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20}>
          <CodeEditor title={direction === 'json_to_csv' ? 'JSON 数组输入' : 'CSV 输入'} value={text}
            onChange={setText} showClear language="plaintext" data-testid="input"
            searchAnchor="json_csv_converter:input" />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50} minSize={20}>
          <CodeEditor title="输出" language={direction === 'csv_to_json' ? 'json' : 'plaintext'}
            readOnly value={output} data-testid="output" searchAnchor="json_csv_converter:output"
            actions={<>{output && <><CopyAction text={output} testId="copy-output" /><SendToMenuFallback /></>}</>} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// SendToMenu 为可选增强:若 P1-a 已合入,替换为 <SendToMenu text={output} currentToolId={toolId} />;
// 否则删掉该引用与 actions 中的片段,保持本任务不依赖 P1-a。
function SendToMenuFallback(): null { return null; }
```

实施注意:①若 P1-a(Task 1-6)已合入,直接 import 真 SendToMenu 并删除 fallback;②`HeaderAction` 若未使用则移出 imports(lint no-unused)。

catalog(icon `Table2`,category `'converter'`,keywords `['csv','excel','表格']`),anchors `['JSON CSV','转换']`。

- [ ] **Step 4–5:** `pnpm test -- src/tools/JsonCsvConverter.test.tsx src/lib/search-index.test.ts && pnpm typecheck && pnpm lint`;`git commit -m "feat(tools): 新增 JSON↔CSV 转换器(RFC 4180)"`

---

## 收尾任务

### Task 6: 全量回归 + 文档更新

- [ ] `pnpm test && pnpm typecheck && pnpm lint` 全绿
- [ ] README.md 工具箱一览表:转换器分类补「JSON↔CSV」「IPv4 子网」;生成器补「ULID」;文本处理补「文本统计」;编解码补「Basic Auth」
- [ ] Commit: `docs: README 工具清单同步 P1-b 新增五工具`

// 复刻 monaco-fold-summary.ts 的 computeFoldSummary(新算法)做黑盒验证
// region 语义 = Monaco 实际:end 行是最后一个内容行(不含 } / ])
function computeFoldSummary(getLine, startLine, endLine) {
  if (endLine <= startLine) return null;
  let depth = 0, commas = 0, nonWhitespace = 0, inString = false, escaped = false;
  let kind = null;
  for (let line = startLine; line <= endLine; line += 1) {
    const content = getLine(line);
    for (let i = 0; i < content.length; i += 1) {
      const ch = content[i];
      if (ch !== ' ' && ch !== '\t') nonWhitespace += 1;
      if (inString) {
        if (escaped) { escaped = false; }
        else if (ch === '\\') { escaped = true; }
        else if (ch === '"') { inString = false; }
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') {
        if (kind === null) kind = ch === '{' ? 'object' : 'array';
        depth += 1;
      } else if (ch === '}' || ch === ']') {
        depth -= 1;
      } else if (ch === ',' && depth === 1 && kind !== null) {
        commas += 1;
      }
    }
  }
  if (kind === null) return null;
  if (nonWhitespace <= 1) return null;
  return { count: commas + 1, kind };
}

const cases = [
  // 实际用户场景(region end = 最后一个内容行,不含 })
  { name: '对象 3 字段', lines: ['{', '  "a": 1,', '  "b": 2,', '  "c": 3', '}'], start: 1, end: 4, expect: { count: 3, kind: 'object' } },
  { name: '数组 5 项', lines: ['[', '  1, 2,', '  3,', '  4,', '  5', ']'], start: 1, end: 5, expect: { count: 5, kind: 'array' } },
  // 用户日志实测场景:单字段对象 { "2312312":"" },region [1,2]
  { name: '单字段对象(用户场景)', lines: ['{', '  "2312312":""', '}'], start: 1, end: 2, expect: { count: 1, kind: 'object' } },
  { name: '空对象 {}', lines: ['{', '}'], start: 1, end: 1, expect: null },
  { name: '空对象(带空白)', lines: ['{', '   ', '}'], start: 1, end: 2, expect: null },
  { name: '单字段对象', lines: ['{', '  "only": 1', '}'], start: 1, end: 2, expect: { count: 1, kind: 'object' } },
  { name: '紧凑对象(首行含字段)', lines: ['{ "a": 1,', '  "b": 2,', '  "c": 3', '}'], start: 1, end: 3, expect: { count: 3, kind: 'object' } },
  { name: '嵌套对象 - 外层(1 字段)', lines: ['{', '  "child": {', '    "x": 1,', '    "y": 2', '  }', '}'], start: 1, end: 5, expect: { count: 1, kind: 'object' } },
  { name: '嵌套对象 - 内层(2 字段)', lines: ['{', '  "child": {', '    "x": 1,', '    "y": 2', '  }', '}'], start: 2, end: 4, expect: { count: 2, kind: 'object' } },
  { name: '数组内嵌对象 - 外层(2 项)', lines: ['[', '  {', '    "a": 1', '  },', '  {', '    "b": 2', '  }', ']'], start: 1, end: 7, expect: { count: 2, kind: 'array' } },
  { name: '数组内嵌对象 - 第一个对象(1 字段)', lines: ['[', '  {', '    "a": 1', '  },', '  {', '    "b": 2', '  }', ']'], start: 2, end: 4, expect: { count: 1, kind: 'object' } },
  { name: '字符串内含逗号', lines: ['{', '  "key": "a,b,c",', '  "x": 1', '}'], start: 1, end: 3, expect: { count: 2, kind: 'object' } },
  { name: '字符串含转义引号', lines: ['{', '  "k": "a\\"b,c",', '  "x": 1', '}'], start: 1, end: 3, expect: { count: 2, kind: 'object' } },
  { name: '字符串内含括号', lines: ['{', '  "k": "{x}",', '  "x": 1', '}'], start: 1, end: 3, expect: { count: 2, kind: 'object' } },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = computeFoldSummary((n) => c.lines[n - 1], c.start, c.end);
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${c.name}`);
  if (!ok) {
    console.log(`  expect: ${JSON.stringify(c.expect)}`);
    console.log(`  got:    ${JSON.stringify(got)}`);
  }
  if (ok) pass += 1; else fail += 1;
}
console.log(`\n${pass}/${pass + fail} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
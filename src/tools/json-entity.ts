/**
 * JSON → 多语言实体类生成
 *
 * 支持语言:TypeScript / Java / Go / Rust / Python / C#
 *
 * 实现说明:
 * - 先把 JSON 值规约为中间类型树(JsonTypeNode):标量 / 数组(元素类型合并)/ 对象(命名结构体)
 * - 各语言 emitter 遍历类型树输出声明;嵌套对象按「键名 PascalCase + 去重」分配类型名,
 *   同形对象不合并(不同字段集生成独立类型,避免错误复用)
 * - 字段名按各语言命名习惯转换(TS 保留原样、Java/C# camel/Pascal、Go/Rust/Python snake),
 *   并在需要时输出 rename 注解(Go tag / Rust serde / C# JsonPropertyName)
 */

export type EntityLanguage = 'typescript' | 'java' | 'go' | 'rust' | 'python' | 'csharp';

/** 转换为菜单项(label 与顺序供 UI 使用) */
export const ENTITY_LANGUAGE_ITEMS: ReadonlyArray<{ id: EntityLanguage; label: string }> = [
  { id: 'typescript', label: 'TypeScript 类型' },
  { id: 'java', label: 'Java 类' },
  { id: 'go', label: 'Go 结构体' },
  { id: 'rust', label: 'Rust 结构体' },
  { id: 'python', label: 'Python dataclass' },
  { id: 'csharp', label: 'C# 类' },
];

// ============================================================
// 中间类型
// ============================================================

type ScalarKind = 'string' | 'int' | 'float' | 'bool' | 'null';

interface ScalarType {
  kind: 'scalar';
  scalar: ScalarKind;
}

interface ArrayType {
  kind: 'array';
  /** 元素类型;空数组或混合元素为 null(由 emitter 输出各语言的 any 列表) */
  item: JsonTypeNode | null;
}

interface RecordField {
  key: string;
  type: JsonTypeNode;
  /** 值直接为 null 时标记(影响可空类型输出) */
  nullable: boolean;
}

interface RecordType {
  kind: 'record';
  /** 分配到的唯一类型名(PascalCase) */
  name: string;
  fields: RecordField[];
}

/** any/混合类型兜底 */
interface AnyType {
  kind: 'any';
}

export type JsonTypeNode = ScalarType | ArrayType | RecordType | AnyType;

// ============================================================
// 名称工具
// ============================================================

/** 按非字母数字分段后做 PascalCase;数字开头补前缀 */
function toPascalCase(input: string): string {
  const parts = input.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const joined = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return /^[0-9]/.test(joined) ? `_${joined}` : joined || 'Field';
}

function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toSnakeCase(input: string): string {
  const parts = input.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return 'field';
  // 处理驼峰段:user Name -> user name
  const spaced = parts.map((p) => p.replace(/([a-z0-9])([A-Z])/g, '$1 $2')).join(' ');
  const snake = spaced
    .trim()
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .join('_');
  return /^[0-9]/.test(snake) ? `_${snake}` : snake || 'field';
}

/** 类型名分配器:同名追加序号去重 */
class NameScope {
  private readonly used = new Set<string>();

  allocate(base: string): string {
    const clean = base || 'Field';
    let name = clean;
    let i = 2;
    while (this.used.has(name)) name = `${clean}${i++}`;
    this.used.add(name);
    return name;
  }
}

// ============================================================
// JSON 值 → 类型树
// ============================================================

/** 由集合字段名推导元素类型名提示:常见英文复数转单数(orders→order),其余追加 Item */
function singularHint(name: string): string {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y');
  if (/(ch|sh|ss|x|z)es$/i.test(name)) return name.replace(/es$/i, '');
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.slice(0, -1);
  return `${name}Item`;
}

/**
 * 递归把 JSON 值转成类型树。
 * @param value 当前值
 * @param nameHint 类型命名字段(对象用其键名派生 PascalCase)
 */
function collectType(value: unknown, nameHint: string, scope: NameScope): JsonTypeNode {
  if (value === null) return { kind: 'scalar', scalar: 'null' };
  switch (typeof value) {
    case 'string':
      return { kind: 'scalar', scalar: 'string' };
    case 'boolean':
      return { kind: 'scalar', scalar: 'bool' };
    case 'number':
      return { kind: 'scalar', scalar: Number.isInteger(value) ? 'int' : 'float' };
    case 'object': {
      if (Array.isArray(value)) {
        // 合并元素类型:全部同形则取该类型,否则 any(记录形状取首个对象)
        let itemType: JsonTypeNode | null = null;
        let homogeneous = true;
        for (const el of value) {
          const t = collectType(el, singularHint(nameHint), scope);
          if (itemType === null) {
            itemType = t;
          } else if (!sameTypeShape(itemType, t)) {
            homogeneous = false;
            break;
          }
        }
        return { kind: 'array', item: homogeneous ? itemType : null };
      }
      const record: RecordType = {
        kind: 'record',
        name: scope.allocate(toPascalCase(nameHint)),
        fields: Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
          key,
          type: collectType(v, key, scope),
          nullable: v === null,
        })),
      };
      return record;
    }
    default:
      return { kind: 'any' };
  }
}

/** 粗粒度形状比较(数组元素同型判断):标量比种类(int/float 互通),记录比字段集,递归一层 */
function sameTypeShape(a: JsonTypeNode, b: JsonTypeNode): boolean {
  if (a.kind !== b.kind) {
    if (
      a.kind === 'scalar' &&
      b.kind === 'scalar' &&
      ((a.scalar === 'int' && b.scalar === 'float') || (a.scalar === 'float' && b.scalar === 'int'))
    ) {
      return true;
    }
    return false;
  }
  switch (a.kind) {
    case 'array': {
      const bb = b as ArrayType;
      if ((a.item === null) !== (bb.item === null)) return false;
      return a.item === null || sameTypeShape(a.item, bb.item!);
    }
    case 'record': {
      const bb = b as RecordType;
      if (a.fields.length !== bb.fields.length) return false;
      return a.fields.every((f, i) => f.key === bb.fields[i].key);
    }
    default:
      return true;
  }
}

/** 收集类型树中的全部 record 定义(根在前,深度优先);导出供测试断言使用 */
export function collectRecords(root: JsonTypeNode): RecordType[] {
  const out: RecordType[] = [];
  const walk = (node: JsonTypeNode): void => {
    if (node.kind === 'record') {
      out.push(node);
      for (const f of node.fields) walk(f.type);
    } else if (node.kind === 'array' && node.item) {
      walk(node.item);
    }
  };
  walk(root);
  return out;
}

// ============================================================
// 各语言 emitter
// ============================================================

const IND = '    ';

function tsFieldKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function emitTypeScript(root: JsonTypeNode, rootName: string): string {
  const blocks: string[] = [];

  function emitTsType(node: JsonTypeNode): string {
    switch (node.kind) {
      case 'scalar':
        switch (node.scalar) {
          case 'string':
            return 'string';
          case 'bool':
            return 'boolean';
          case 'int':
          case 'float':
            return 'number';
          case 'null':
            return 'null';
          default:
            return 'unknown';
        }
      case 'array':
        return node.item ? `${emitTsType(node.item)}[]` : 'unknown[]';
      case 'record': {
        const fields = node.fields
          .map((f) => {
            const base = emitTsType(f.type);
            // 基类型已为 null 时不再追加可空联合(避免 null | null)
            const suffix = f.nullable && base !== 'null' ? ' | null' : '';
            return `  ${tsFieldKey(f.key)}: ${base}${suffix};`;
          })
          .join('\n');
        blocks.unshift(`export interface ${node.name} {\n${fields}\n}`);
        return node.name;
      }
      default:
        return 'unknown';
    }
  }

  if (root.kind === 'record') {
    emitTsType(root);
  } else {
    blocks.unshift(`export type ${rootName} = ${emitTsType(root)};`);
  }
  return blocks.join('\n\n');
}

function emitJava(root: JsonTypeNode, _rootName: string): string {
  function javaBaseType(node: JsonTypeNode): string {
    switch (node.kind) {
      case 'scalar':
        switch (node.scalar) {
          case 'string':
            return 'String';
          case 'bool':
            return 'boolean';
          case 'int':
            return 'int';
          case 'float':
            return 'double';
          default:
            return 'Object';
        }
      case 'array':
        return `List<${node.item ? javaBaseType(node.item) : 'Object'}>`;
      case 'record':
        return node.name;
      default:
        return 'Object';
    }
  }

  if (root.kind !== 'record') {
    return `// 根节点不是 JSON 对象,无法生成 Java 类\n// 推断的根类型:${javaBaseType(root)}`;
  }

  const records: RecordType[] = [root];
  const walk = (node: JsonTypeNode): void => {
    if (node.kind === 'record') {
      records.push(node);
      for (const f of node.fields) walk(f.type);
    } else if (node.kind === 'array' && node.item) {
      walk(node.item);
    }
  };
  for (const f of root.fields) walk(f.type);

  const needsList =
    root.fields.some((f) => javaBaseType(f.type).startsWith('List<')) ||
    records.some((r) => r.fields.some((f) => javaBaseType(f.type).startsWith('List<')));
  const importLine = needsList ? 'import java.util.List;\n\n' : '';

  const isPrimitiveJava = (t: string): boolean => t === 'int' || t === 'double' || t === 'boolean';
  const boxPrimitive = (t: string): string => {
    switch (t) {
      case 'int':
        return 'Integer';
      case 'double':
        return 'Double';
      case 'boolean':
        return 'Boolean';
      default:
        return t;
    }
  };

  const classes = records
    .map((rec) => {
      const body = rec.fields
        .map((f) => {
          const type =
            f.nullable && isPrimitiveJava(javaBaseType(f.type))
              ? boxPrimitive(javaBaseType(f.type))
              : javaBaseType(f.type);
          return `    private ${type} ${toCamelCase(f.key)};`;
        })
        .join('\n');
      const accessors = rec.fields
        .map((f) => {
          const raw =
            f.nullable && isPrimitiveJava(javaBaseType(f.type))
              ? boxPrimitive(javaBaseType(f.type))
              : javaBaseType(f.type);
          const name = toCamelCase(f.key);
          const cap = name.charAt(0).toUpperCase() + name.slice(1);
          return [
            `    public ${raw} get${cap}() { return ${name}; }`,
            `    public void set${cap}(${raw} ${name}) { this.${name} = ${name}; }`,
          ].join('\n');
        })
        .join('\n');
      return `public class ${rec.name} {\n${body}\n\n${accessors}\n}`;
    })
    .join('\n\n');

  return `${importLine}${classes}`;
}

function emitGo(root: JsonTypeNode, _rootName: string): string {
  const GO_KEYWORDS = new Set([
    'break',
    'case',
    'chan',
    'const',
    'continue',
    'default',
    'defer',
    'else',
    'fallthrough',
    'for',
    'func',
    'go',
    'goto',
    'if',
    'import',
    'interface',
    'map',
    'package',
    'range',
    'return',
    'select',
    'struct',
    'switch',
    'type',
    'var',
  ]);

  const goFieldName = (key: string): string => {
    const name = toPascalCase(key);
    return GO_KEYWORDS.has(name.toLowerCase()) ? `${name}_` : name;
  };

  function goTypeName(node: JsonTypeNode): string {
    switch (node.kind) {
      case 'scalar':
        switch (node.scalar) {
          case 'string':
            return 'string';
          case 'bool':
            return 'bool';
          case 'int':
            return 'int64';
          case 'float':
            return 'float64';
          default:
            return 'any';
        }
      case 'array':
        return `[]${node.item ? goTypeName(node.item) : 'any'}`;
      case 'record':
        return node.name;
      default:
        return 'any';
    }
  }

  if (root.kind !== 'record') {
    return `// 根节点不是 JSON 对象,无法生成 Go 结构体\n// 推断的根类型:${goTypeName(root)}`;
  }

  const structs: string[] = [];
  const walk = (rec: RecordType): void => {
    const width = Math.max(...rec.fields.map((f) => goFieldName(f.key).length), 1);
    const fields = rec.fields
      .map((f) => {
        const name = goFieldName(f.key).padEnd(width);
        return `\t${name} ${goTypeName(f.type)} \`json:"${f.key}"\``;
      })
      .join('\n');
    structs.push(`type ${rec.name} struct {\n${fields}\n}`);
    for (const f of rec.fields) {
      if (f.type.kind === 'record') walk(f.type);
      else if (f.type.kind === 'array' && f.type.item?.kind === 'record') walk(f.type.item);
    }
  };
  walk(root);

  return structs.join('\n\n');
}

function emitRust(root: JsonTypeNode, _rootName: string): string {
  const RUST_KEYWORDS = new Set([
    'as',
    'async',
    'await',
    'box',
    'break',
    'const',
    'continue',
    'crate',
    'dyn',
    'else',
    'enum',
    'extern',
    'false',
    'fn',
    'for',
    'if',
    'impl',
    'in',
    'let',
    'loop',
    'match',
    'mod',
    'move',
    'mut',
    'pub',
    'ref',
    'return',
    'self',
    'static',
    'struct',
    'super',
    'trait',
    'true',
    'type',
    'unsafe',
    'use',
    'where',
    'while',
  ]);

  const rustFieldName = (key: string): string => {
    const raw = toSnakeCase(key);
    return RUST_KEYWORDS.has(raw) ? `${raw}_` : raw;
  };

  function rustBaseType(node: JsonTypeNode): string {
    switch (node.kind) {
      case 'scalar':
        switch (node.scalar) {
          case 'string':
            return 'String';
          case 'bool':
            return 'bool';
          case 'int':
            return 'i64';
          case 'float':
            return 'f64';
          default:
            return 'serde_json::Value';
        }
      case 'array':
        return `Vec<${node.item ? rustBaseType(node.item) : 'serde_json::Value'}>`;
      case 'record':
        return node.name;
      default:
        return 'serde_json::Value';
    }
  }

  if (root.kind !== 'record') {
    return `// 根节点不是 JSON 对象,无法生成 Rust 结构体\n// 推断的根类型:${rustBaseType(root)}`;
  }

  const structs: string[] = [];
  const walk = (rec: RecordType): void => {
    const fields = rec.fields
      .map((f) => {
        const name = rustFieldName(f.key);
        const ty = f.nullable ? `Option<${rustBaseType(f.type)}>` : rustBaseType(f.type);
        // 字段名与原键不一致(snake 转换/关键字后缀)时输出 serde rename
        const rename = f.key !== name ? `    #[serde(rename = "${f.key}")]\n` : '';
        return `${rename}    pub ${name}: ${ty},`;
      })
      .join('\n');
    structs.push(
      `#[derive(Debug, Clone, Default, Serialize, Deserialize)]\npub struct ${rec.name} {\n${fields}\n}`,
    );
    for (const f of rec.fields) {
      if (f.type.kind === 'record') walk(f.type);
      else if (f.type.kind === 'array' && f.type.item?.kind === 'record') walk(f.type.item);
    }
  };
  walk(root);

  return `use serde::{Deserialize, Serialize};\n\n${structs.join('\n\n')}`;
}

function emitPython(root: JsonTypeNode, _rootName: string): string {
  const PY_KEYWORDS = new Set([
    'False',
    'None',
    'True',
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
  ]);

  const pyFieldName = (key: string): string => {
    const raw = toSnakeCase(key);
    return PY_KEYWORDS.has(raw) ? `${raw}_` : raw;
  };

  function pyBaseType(node: JsonTypeNode): string {
    switch (node.kind) {
      case 'scalar':
        switch (node.scalar) {
          case 'string':
            return 'str';
          case 'bool':
            return 'bool';
          case 'int':
            return 'int';
          case 'float':
            return 'float';
          default:
            return 'Any';
        }
      case 'array':
        return `List[${node.item ? pyBaseType(node.item) : 'Any'}]`;
      case 'record':
        return node.name;
      default:
        return 'Any';
    }
  }

  if (root.kind !== 'record') {
    return `# 根节点不是 JSON 对象,无法生成 Python dataclass\n# 推断的根类型:${pyBaseType(root)}`;
  }

  // 收集依赖:是否用到 Optional / Any / List(字段级可空也要计入)
  let usesOptional = false;
  let usesAny = false;
  let usesList = false;
  const scanField = (f: RecordField): void => {
    if (f.nullable) usesOptional = true;
    scanDeps(f.type);
  };
  const scanDeps = (node: JsonTypeNode): void => {
    switch (node.kind) {
      case 'scalar':
        if (node.scalar === 'null') usesAny = true;
        break;
      case 'array':
        usesList = true;
        if (node.item) scanDeps(node.item);
        else usesAny = true;
        break;
      case 'record':
        for (const f of node.fields) scanField(f);
        break;
      default:
        usesAny = true;
    }
  };
  for (const f of root.fields) scanField(f);

  const imports: string[] = ['from dataclasses import dataclass, field'];
  const typingImports = [
    usesAny ? 'Any' : null,
    usesList ? 'List' : null,
    usesOptional ? 'Optional' : null,
  ].filter(Boolean) as string[];
  if (typingImports.length > 0) imports.push(`from typing import ${typingImports.join(', ')}`);

  function pyDefault(f: RecordField): string {
    if (f.nullable) return 'None';
    switch (f.type.kind) {
      case 'scalar':
        switch (f.type.scalar) {
          case 'string':
            return '""';
          case 'bool':
            return 'False';
          case 'int':
          case 'float':
            return '0';
          default:
            return 'None';
        }
      case 'array':
        return 'field(default_factory=list)';
      case 'record':
        return `field(default_factory=${f.type.name})`;
      default:
        return 'None';
    }
  }

  const classes: string[] = [];
  const walk = (rec: RecordType): void => {
    const fields = rec.fields
      .map((f) => {
        const name = pyFieldName(f.key);
        const ty = f.nullable ? `Optional[${pyBaseType(f.type)}]` : pyBaseType(f.type);
        return `${IND}${name}: ${ty} = ${pyDefault(f)}`;
      })
      .join('\n');
    classes.push(`@dataclass\nclass ${rec.name}:\n${fields}`);
    for (const f of rec.fields) {
      if (f.type.kind === 'record') walk(f.type);
      else if (f.type.kind === 'array' && f.type.item?.kind === 'record') walk(f.type.item);
    }
  };
  walk(root);

  return `${imports.join('\n')}\n\n\n${classes.join('\n\n')}`;
}

function emitCSharp(root: JsonTypeNode, _rootName: string): string {
  const CS_KEYWORDS = new Set([
    'abstract',
    'as',
    'base',
    'break',
    'byte',
    'case',
    'catch',
    'char',
    'checked',
    'class',
    'const',
    'decimal',
    'default',
    'do',
    'double',
    'else',
    'enum',
    'event',
    'explicit',
    'extern',
    'false',
    'finally',
    'fixed',
    'float',
    'for',
    'foreach',
    'goto',
    'if',
    'implicit',
    'in',
    'interface',
    'internal',
    'is',
    'lock',
    'long',
    'namespace',
    'new',
    'null',
    'object',
    'operator',
    'out',
    'override',
    'params',
    'private',
    'protected',
    'public',
    'readonly',
    'ref',
    'return',
    'sbyte',
    'sealed',
    'short',
    'sizeof',
    'stackalloc',
    'static',
    'string',
    'struct',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'uint',
    'ulong',
    'unchecked',
    'unsafe',
    'ushort',
    'using',
    'virtual',
    'void',
    'volatile',
    'while',
  ]);

  const csPropertyName = (key: string): string => {
    const name = toPascalCase(key);
    return CS_KEYWORDS.has(name) ? `@${name}` : name;
  };

  function csBaseType(node: JsonTypeNode): string {
    switch (node.kind) {
      case 'scalar':
        switch (node.scalar) {
          case 'string':
            return 'string';
          case 'bool':
            return 'bool';
          case 'int':
            return 'int';
          case 'float':
            return 'double';
          default:
            return 'object';
        }
      case 'array':
        return `List<${node.item ? csBaseType(node.item) : 'object'}>`;
      case 'record':
        return node.name;
      default:
        return 'object';
    }
  }

  if (root.kind !== 'record') {
    return `// 根节点不是 JSON 对象,无法生成 C# 类\n// 推断的根类型:${csBaseType(root)}`;
  }

  const classes: string[] = [];
  const walk = (rec: RecordType): void => {
    const fields = rec.fields
      .map((f) => {
        const name = csPropertyName(f.key);
        const ty = f.nullable ? `${csBaseType(f.type)}?` : csBaseType(f.type);
        // 属性名与原键不一致(Pascal 转换/关键字转义)时输出 System.Text.Json 注解
        const rename =
          name.replace(/^@/, '') !== f.key
            ? `    [System.Text.Json.Serialization.JsonPropertyName("${f.key}")]\n`
            : '';
        return `${rename}    public ${ty} ${name} { get; set; }`;
      })
      .join('\n');
    classes.push(`public class ${rec.name}\n{\n${fields}\n}`);
    for (const f of rec.fields) {
      if (f.type.kind === 'record') walk(f.type);
      else if (f.type.kind === 'array' && f.type.item?.kind === 'record') walk(f.type.item);
    }
  };
  walk(root);

  const needsUsing = classes.length > 0;
  const usingLine = needsUsing ? '' : '';
  return `${usingLine}${classes.join('\n\n')}`;
}

// ============================================================
// 入口
// ============================================================

/**
 * 由 JSON 值生成目标语言的实体类代码。
 *
 * 根节点不是对象时(数组/标量),返回带注释的推断类型说明。
 */
export function generateEntityCode(
  value: unknown,
  language: EntityLanguage,
  rootName = 'Root',
): string {
  const scope = new NameScope();
  const root = collectType(value, rootName, scope);

  switch (language) {
    case 'typescript':
      return emitTypeScript(root, rootName);
    case 'java':
      return emitJava(root, rootName);
    case 'go':
      return emitGo(root, rootName);
    case 'rust':
      return emitRust(root, rootName);
    case 'python':
      return emitPython(root, rootName);
    case 'csharp':
      return emitCSharp(root, rootName);
    default: {
      const exhaustive: never = language;
      throw new Error(`不支持的语言: ${String(exhaustive)}`);
    }
  }
}

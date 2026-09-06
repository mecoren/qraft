/**
 * 文件图标 —— 参考 VSCode 的处理方式,接入 Material Icon Theme
 *
 * 图标来源:npm 包 material-icon-theme(MIT,官方维护,
 * https://github.com/material-extensions/vscode-material-icon-theme)。
 *
 * 实现说明:
 * - 通过 Vite 的 `?url` 导入把用到的 SVG 打包为静态资源(按需引入,
 *   避免全量打包主题的 1200+ 图标);小体积 SVG 在构建时会被内联为
 *   data URI,不产生额外网络请求
 * - 查找分两层:`getFileIconName`(纯逻辑,可单测)返回主题图标名,
 *   `FILE_ICON_SRCS` 负责图标名 → 资源 URL 的解析(FileIcon 组件使用)
 * - 查找顺序对齐 VSCode 文件图标主题语义:
 *   1. 精确文件名(package.json → npm)
 *   2. 特殊前缀(.env.local 等派生环境文件)
 *   3. 扩展名(*.ts → typescript)
 *   4. 兜底为主题默认文件图标(file)
 * - 文件名 / 扩展名匹配均为大小写不敏感(与 Windows 习惯一致)
 */
import audioIcon from 'material-icon-theme/icons/audio.svg?url';
import babelIcon from 'material-icon-theme/icons/babel.svg?url';
import cIcon from 'material-icon-theme/icons/c.svg?url';
import certificateIcon from 'material-icon-theme/icons/certificate.svg?url';
import clojureIcon from 'material-icon-theme/icons/clojure.svg?url';
import cmakeIcon from 'material-icon-theme/icons/cmake.svg?url';
import consoleIcon from 'material-icon-theme/icons/console.svg?url';
import cppIcon from 'material-icon-theme/icons/cpp.svg?url';
import csharpIcon from 'material-icon-theme/icons/csharp.svg?url';
import cssIcon from 'material-icon-theme/icons/css.svg?url';
import dartIcon from 'material-icon-theme/icons/dart.svg?url';
import databaseIcon from 'material-icon-theme/icons/database.svg?url';
import dockerIcon from 'material-icon-theme/icons/docker.svg?url';
import editorconfigIcon from 'material-icon-theme/icons/editorconfig.svg?url';
import elixirIcon from 'material-icon-theme/icons/elixir.svg?url';
import erlangIcon from 'material-icon-theme/icons/erlang.svg?url';
import eslintIcon from 'material-icon-theme/icons/eslint.svg?url';
import fileIcon from 'material-icon-theme/icons/file.svg?url';
import fontIcon from 'material-icon-theme/icons/font.svg?url';
import fsharpIcon from 'material-icon-theme/icons/fsharp.svg?url';
import gitIcon from 'material-icon-theme/icons/git.svg?url';
import goIcon from 'material-icon-theme/icons/go.svg?url';
import gradleIcon from 'material-icon-theme/icons/gradle.svg?url';
import graphqlIcon from 'material-icon-theme/icons/graphql.svg?url';
import haskellIcon from 'material-icon-theme/icons/haskell.svg?url';
import htmlIcon from 'material-icon-theme/icons/html.svg?url';
import imageIcon from 'material-icon-theme/icons/image.svg?url';
import javaIcon from 'material-icon-theme/icons/java.svg?url';
import javascriptIcon from 'material-icon-theme/icons/javascript.svg?url';
import jestIcon from 'material-icon-theme/icons/jest.svg?url';
import jsonIcon from 'material-icon-theme/icons/json.svg?url';
import juliaIcon from 'material-icon-theme/icons/julia.svg?url';
import keyIcon from 'material-icon-theme/icons/key.svg?url';
import kotlinIcon from 'material-icon-theme/icons/kotlin.svg?url';
import lessIcon from 'material-icon-theme/icons/less.svg?url';
import licenseIcon from 'material-icon-theme/icons/license.svg?url';
import lockIcon from 'material-icon-theme/icons/lock.svg?url';
import logIcon from 'material-icon-theme/icons/log.svg?url';
import luaIcon from 'material-icon-theme/icons/lua.svg?url';
import makefileIcon from 'material-icon-theme/icons/makefile.svg?url';
import markdownIcon from 'material-icon-theme/icons/markdown.svg?url';
import nimIcon from 'material-icon-theme/icons/nim.svg?url';
import npmIcon from 'material-icon-theme/icons/npm.svg?url';
import ocamlIcon from 'material-icon-theme/icons/ocaml.svg?url';
import objectiveCIcon from 'material-icon-theme/icons/objective-c.svg?url';
import pascalIcon from 'material-icon-theme/icons/pascal.svg?url';
import perlIcon from 'material-icon-theme/icons/perl.svg?url';
import pdfIcon from 'material-icon-theme/icons/pdf.svg?url';
import phpIcon from 'material-icon-theme/icons/php.svg?url';
import pnpmIcon from 'material-icon-theme/icons/pnpm.svg?url';
import powershellIcon from 'material-icon-theme/icons/powershell.svg?url';
import powerpointIcon from 'material-icon-theme/icons/powerpoint.svg?url';
import prettierIcon from 'material-icon-theme/icons/prettier.svg?url';
import protoIcon from 'material-icon-theme/icons/proto.svg?url';
import pythonIcon from 'material-icon-theme/icons/python.svg?url';
import rIcon from 'material-icon-theme/icons/r.svg?url';
import reactIcon from 'material-icon-theme/icons/react.svg?url';
import rubyIcon from 'material-icon-theme/icons/ruby.svg?url';
import rustIcon from 'material-icon-theme/icons/rust.svg?url';
import sassIcon from 'material-icon-theme/icons/sass.svg?url';
import scalaIcon from 'material-icon-theme/icons/scala.svg?url';
import settingsIcon from 'material-icon-theme/icons/settings.svg?url';
import svgIcon from 'material-icon-theme/icons/svg.svg?url';
import svelteIcon from 'material-icon-theme/icons/svelte.svg?url';
import swiftIcon from 'material-icon-theme/icons/swift.svg?url';
import tableIcon from 'material-icon-theme/icons/table.svg?url';
import tailwindcssIcon from 'material-icon-theme/icons/tailwindcss.svg?url';
import terraformIcon from 'material-icon-theme/icons/terraform.svg?url';
import tomlIcon from 'material-icon-theme/icons/toml.svg?url';
import tsconfigIcon from 'material-icon-theme/icons/tsconfig.svg?url';
import typescriptIcon from 'material-icon-theme/icons/typescript.svg?url';
import videoIcon from 'material-icon-theme/icons/video.svg?url';
import viteIcon from 'material-icon-theme/icons/vite.svg?url';
import vitestIcon from 'material-icon-theme/icons/vitest.svg?url';
import vueIcon from 'material-icon-theme/icons/vue.svg?url';
import wordIcon from 'material-icon-theme/icons/word.svg?url';
import xmlIcon from 'material-icon-theme/icons/xml.svg?url';
import yamlIcon from 'material-icon-theme/icons/yaml.svg?url';
import zigIcon from 'material-icon-theme/icons/zig.svg?url';
import zipIcon from 'material-icon-theme/icons/zip.svg?url';

/** 图标名 → 打包后的 SVG 资源地址(Vite `?url` 导入产物) */
export const FILE_ICON_SRCS = {
  audio: audioIcon,
  babel: babelIcon,
  c: cIcon,
  certificate: certificateIcon,
  clojure: clojureIcon,
  cmake: cmakeIcon,
  console: consoleIcon,
  cpp: cppIcon,
  csharp: csharpIcon,
  css: cssIcon,
  dart: dartIcon,
  database: databaseIcon,
  docker: dockerIcon,
  editorconfig: editorconfigIcon,
  elixir: elixirIcon,
  erlang: erlangIcon,
  eslint: eslintIcon,
  file: fileIcon,
  font: fontIcon,
  fsharp: fsharpIcon,
  git: gitIcon,
  go: goIcon,
  gradle: gradleIcon,
  graphql: graphqlIcon,
  haskell: haskellIcon,
  html: htmlIcon,
  image: imageIcon,
  java: javaIcon,
  javascript: javascriptIcon,
  jest: jestIcon,
  json: jsonIcon,
  julia: juliaIcon,
  key: keyIcon,
  kotlin: kotlinIcon,
  less: lessIcon,
  license: licenseIcon,
  lock: lockIcon,
  log: logIcon,
  lua: luaIcon,
  makefile: makefileIcon,
  markdown: markdownIcon,
  nim: nimIcon,
  npm: npmIcon,
  ocaml: ocamlIcon,
  'objective-c': objectiveCIcon,
  pascal: pascalIcon,
  perl: perlIcon,
  pdf: pdfIcon,
  php: phpIcon,
  pnpm: pnpmIcon,
  powershell: powershellIcon,
  powerpoint: powerpointIcon,
  prettier: prettierIcon,
  proto: protoIcon,
  python: pythonIcon,
  r: rIcon,
  react: reactIcon,
  ruby: rubyIcon,
  rust: rustIcon,
  sass: sassIcon,
  scala: scalaIcon,
  settings: settingsIcon,
  svg: svgIcon,
  svelte: svelteIcon,
  swift: swiftIcon,
  table: tableIcon,
  tailwindcss: tailwindcssIcon,
  terraform: terraformIcon,
  toml: tomlIcon,
  tsconfig: tsconfigIcon,
  typescript: typescriptIcon,
  video: videoIcon,
  vite: viteIcon,
  vitest: vitestIcon,
  vue: vueIcon,
  word: wordIcon,
  xml: xmlIcon,
  yaml: yamlIcon,
  zig: zigIcon,
  zip: zipIcon,
} as const;

/** 图标名(FILE_ICON_SRCS 的键) */
export type FileIconName = keyof typeof FILE_ICON_SRCS;

/** 精确文件名(basename 小写)→ 图标名 */
const FILE_NAME_ICONS: Readonly<Record<string, FileIconName>> = {
  // 包管理 / 锁文件
  'package.json': 'npm',
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'yarn.lock': 'lock',
  // TS/JS 工程配置
  'tsconfig.json': 'tsconfig',
  'jsconfig.json': 'tsconfig',
  // 前端工具链配置
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'vitest.config.ts': 'vitest',
  'vitest.config.js': 'vitest',
  'jest.config.ts': 'jest',
  'jest.config.js': 'jest',
  'jest.config.json': 'jest',
  'tailwind.config.ts': 'tailwindcss',
  'tailwind.config.js': 'tailwindcss',
  '.babelrc': 'babel',
  '.editorconfig': 'editorconfig',
  '.prettierrc': 'prettier',
  // Git
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.gitconfig': 'git',
  '.gitkeep': 'git',
  // 构建
  dockerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.dockerignore': 'docker',
  makefile: 'makefile',
  'cmakelists.txt': 'cmake',
  // 元信息
  license: 'license',
  licence: 'license',
  'license.md': 'license',
  readme: 'markdown',
};

/** 特殊前缀(小写 basename startsWith)→ 图标名 */
const FILE_PREFIX_ICONS: ReadonlyArray<{ prefix: string; icon: FileIconName }> = [
  { prefix: '.env', icon: 'settings' }, // .env / .env.local / .env.production 等
  { prefix: 'eslint.config', icon: 'eslint' },
  { prefix: 'prettier.config', icon: 'prettier' },
];

/** 扩展名(含点,小写)→ 图标名 */
const FILE_EXT_ICONS: Readonly<Record<string, FileIconName>> = {
  // Web 前端
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'react',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'react',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.svg': 'svg',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'sass',
  '.sass': 'sass',
  '.less': 'less',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  // 编译型 / 脚本语言
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.dart': 'dart',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.scala': 'scala',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.php': 'php',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.m': 'objective-c',
  '.mm': 'objective-c',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.hs': 'haskell',
  '.zig': 'zig',
  '.nim': 'nim',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.ml': 'ocaml',
  '.r': 'r',
  '.jl': 'julia',
  '.pas': 'pascal',
  '.dpr': 'pascal',
  // 数据
  '.sql': 'database',
  '.db': 'database',
  '.sqlite': 'database',
  '.sqlite3': 'database',
  '.csv': 'table',
  '.proto': 'proto',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  // Shell / 终端
  '.sh': 'console',
  '.bash': 'console',
  '.zsh': 'console',
  '.fish': 'console',
  '.bat': 'console',
  '.cmd': 'console',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  // 构建工具
  '.gradle': 'gradle',
  '.gradle.kts': 'gradle',
  // 媒体
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.ico': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.avif': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
  // 文档 / 字体 / 归档
  '.pdf': 'pdf',
  '.doc': 'word',
  '.docx': 'word',
  '.docm': 'word',
  '.xls': 'table',
  '.xlsx': 'table',
  '.xlsm': 'table',
  '.ppt': 'powerpoint',
  '.pptx': 'powerpoint',
  '.pptm': 'powerpoint',
  '.ttf': 'font',
  '.otf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
  '.zip': 'zip',
  '.tar': 'zip',
  '.gz': 'zip',
  '.bz2': 'zip',
  '.7z': 'zip',
  '.rar': 'zip',
  // 其他
  '.log': 'log',
  '.lock': 'lock',
  '.crt': 'certificate',
  '.cer': 'certificate',
  '.pem': 'certificate',
  '.key': 'key',
};

/**
 * 按路径解析文件对应的 Material Icon Theme 图标名。
 *
 * @param path 文件完整路径或文件名(支持 `/` 与 `\` 分隔符);
 *             未保存到磁盘的新建 Tab 为 null,直接使用兜底图标
 * @returns 图标名(FILE_ICON_SRCS 的键);无匹配时为兜底名 'file'
 */
export function getFileIconName(path: string | null | undefined): FileIconName {
  const base = (path ? (path.split(/[\\/]/).pop() ?? '') : '').toLowerCase();

  const byName = FILE_NAME_ICONS[base];
  if (byName) return byName;

  const byPrefix = FILE_PREFIX_ICONS.find((e) => base.startsWith(e.prefix));
  if (byPrefix) return byPrefix.icon;

  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    const byExt = FILE_EXT_ICONS[base.slice(dot)];
    if (byExt) return byExt;
  }

  // 兜底:主题的通用文件图标(等价于 VSCode 无匹配时的默认图标)
  return 'file';
}

/** 图标名 → SVG 资源地址(未知名字回退到默认文件图标) */
export function getFileIconSrc(name: FileIconName): string {
  return FILE_ICON_SRCS[name] ?? FILE_ICON_SRCS.file;
}

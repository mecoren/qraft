/**
 * fileIcons 单元测试 —— Material Icon Theme 文件图标映射
 *
 * 验证(VSCode 语义的查找优先级):
 * - 精确文件名优先于扩展名(package.json → npm,而非 json)
 * - 特殊前缀匹配(.env.local → settings)
 * - 扩展名映射(*.ts → typescript,*.tsx → react)
 * - 大小写不敏感(README.MD、Main.TS)
 * - 兼容 / 与 \ 路径分隔符
 * - 未匹配时回退到主题默认文件图标(file)
 */
import { describe, expect, it } from 'vitest';
import { FILE_ICON_SRCS, getFileIconName, getFileIconSrc } from './fileIcons';

describe('getFileIconName 精确文件名', () => {
  it('package.json 映射为 npm 图标(文件名优先于扩展名)', () => {
    expect(getFileIconName('C:/dev/app/package.json')).toBe('npm');
  });

  it('pnpm-lock.yaml 映射为 pnpm 图标(而非 yaml)', () => {
    expect(getFileIconName('D:/repo/pnpm-lock.yaml')).toBe('pnpm');
  });

  it('.gitignore 映射为 git 图标(dotfile 无扩展名语义)', () => {
    expect(getFileIconName('D:/repo/.gitignore')).toBe('git');
  });

  it('Dockerfile 大小写不敏感', () => {
    expect(getFileIconName('dockerfile')).toBe('docker');
    expect(getFileIconName('Dockerfile')).toBe('docker');
  });
});

describe('getFileIconName 特殊前缀', () => {
  it('.env 及派生环境文件映射为 settings 图标', () => {
    expect(getFileIconName('.env')).toBe('settings');
    expect(getFileIconName('.env.local')).toBe('settings');
    expect(getFileIconName('.env.production')).toBe('settings');
  });
});

describe('getFileIconName 扩展名', () => {
  it('常见语言扩展名映射到对应图标', () => {
    expect(getFileIconName('src/main.ts')).toBe('typescript');
    expect(getFileIconName('src/App.tsx')).toBe('react');
    expect(getFileIconName('index.js')).toBe('javascript');
    expect(getFileIconName('styles.scss')).toBe('sass');
    expect(getFileIconName('README.md')).toBe('markdown');
    expect(getFileIconName('query.sql')).toBe('database');
    expect(getFileIconName('logo.png')).toBe('image');
  });

  it('大小写不敏感(Main.TS 与 main.ts 同图标)', () => {
    expect(getFileIconName('Main.TS')).toBe(getFileIconName('main.ts'));
    expect(getFileIconName('README.MD')).toBe(getFileIconName('readme.md'));
  });

  it('兼容反斜杠路径分隔符', () => {
    expect(getFileIconName('C:\\dev\\app\\main.ts')).toBe(getFileIconName('C:/dev/app/main.ts'));
  });
});

describe('getFileIconName 兜底', () => {
  it('未匹配的类型回退为主题默认文件图标', () => {
    expect(getFileIconName('unknown.xyz')).toBe('file');
    expect(getFileIconName('Makefile.am')).toBe('file');
  });
});

describe('getFileIconSrc / FILE_ICON_SRCS', () => {
  it('每个映射到的图标名都有对应的 SVG 资源(data URI 或打包路径)', () => {
    for (const name of ['npm', 'typescript', 'react', 'settings', 'git', 'pnpm']) {
      const src = getFileIconSrc(name as keyof typeof FILE_ICON_SRCS);
      expect(src.startsWith('data:image/svg+xml') || src.endsWith('.svg')).toBe(true);
    }
  });

  it('未知图标名回退到默认文件图标资源', () => {
    expect(getFileIconSrc('file')).toBe(FILE_ICON_SRCS.file);
  });
});

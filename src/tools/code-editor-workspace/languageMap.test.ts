import { describe, expect, it } from 'vitest';
import { inferLanguageFromPath, LANGUAGE_LABELS, QUICK_LANGUAGES } from './languageMap';

describe('inferLanguageFromPath', () => {
  it.each([
    ['/a/app.py', 'python'],
    ['/a/main.rs', 'rust'],
    ['/a/main.go', 'go'],
    ['/a/App.java', 'java'],
    ['/a/main.c', 'c'],
    ['/a/main.cpp', 'cpp'],
    ['/a/main.cs', 'csharp'],
    ['/a/index.php', 'php'],
    ['/a/main.swift', 'swift'],
    ['/a/Main.kt', 'kotlin'],
    ['/a/main.dart', 'dart'],
    ['/a/app.rb', 'ruby'],
    ['/a/main.lua', 'lua'],
    ['/a/analysis.r', 'r'],
    ['/a/script.pl', 'perl'],
    ['/a/Main.scala', 'scala'],
    ['/a/ViewController.m', 'objective-c'],
    ['/a/script.ps1', 'powershell'],
    ['/a/schema.graphql', 'graphql'],
    ['/a/main.tf', 'hcl'],
    ['/a/build.bat', 'bat'],
    ['/a/Program.fs', 'fsharp'],
    ['/a/script.jl', 'julia'],
    ['/a/message.proto', 'proto'],
    ['/a/program.pas', 'pascal'],
    ['/a/Module.vb', 'vb'],
    ['/a/core.clj', 'clojure'],
    ['/a/mix.ex', 'elixir'],
  ] as const)('infers %s → %s', (path, lang) => {
    expect(inferLanguageFromPath(path)).toBe(lang);
  });

  it('infers special filenames without extension', () => {
    expect(inferLanguageFromPath('/proj/Dockerfile')).toBe('dockerfile');
    expect(inferLanguageFromPath('/proj/Gemfile')).toBe('ruby');
    expect(inferLanguageFromPath('/proj/Rakefile')).toBe('ruby');
    expect(inferLanguageFromPath('/proj/Makefile')).toBe('shell');
  });

  it('is case-insensitive on the extension', () => {
    expect(inferLanguageFromPath('/a/APP.PY')).toBe('python');
  });

  it('falls back to plaintext for unknown types', () => {
    expect(inferLanguageFromPath('/a/file.xyz')).toBe('plaintext');
    expect(inferLanguageFromPath('/no-extension')).toBe('plaintext');
    expect(inferLanguageFromPath(null)).toBe('plaintext');
  });
});

describe('language catalog', () => {
  it('has a Chinese label for every quick language', () => {
    for (const { id } of QUICK_LANGUAGES) {
      expect(LANGUAGE_LABELS[id]).toBeTruthy();
    }
  });

  it('covers all major hot languages', () => {
    const ids = QUICK_LANGUAGES.map((l) => l.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'rust',
        'go',
        'python',
        'java',
        'c',
        'cpp',
        'csharp',
        'php',
        'swift',
        'kotlin',
        'dart',
        'ruby',
        'lua',
        'r',
        'perl',
        'scala',
        'objective-c',
        'powershell',
        'dockerfile',
        'graphql',
        'hcl',
        'bat',
        'fsharp',
        'julia',
        'proto',
        'pascal',
        'vb',
        'clojure',
        'elixir',
      ]),
    );
  });
});

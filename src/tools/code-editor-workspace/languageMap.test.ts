import { describe, expect, it } from 'vitest';
import {
  detectLanguageFromContent,
  inferLanguageFromPath,
  LANGUAGE_LABELS,
  QUICK_LANGUAGES,
} from './languageMap';

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

describe('detectLanguageFromContent', () => {
  it('detects JSON by successful parse (broken JSON 不误判)', () => {
    expect(detectLanguageFromContent('{\n  "a": 1\n}')).toBe('json');
    expect(detectLanguageFromContent('[1, 2, 3]')).toBe('json');
    expect(detectLanguageFromContent('{ not: valid')).toBeNull();
  });

  it('leniently detects JSON with comments / trailing commas via quoted keys', () => {
    // 严格 parse 失败但含 "key": 引号键名特征 → 仍识别为 json
    expect(detectLanguageFromContent('{\n  // 配置\n  "apiKey": "57d",\n  "b": 2,\n}')).toBe(
      'json',
    );
    expect(detectLanguageFromContent('[ { "id": 8353 }, ]')).toBe('json');
    // 无引号键名(JS 对象字面量)不误判
    expect(detectLanguageFromContent('{ apiKey: "57d" }')).toBeNull();
  });

  it('detects shebang scripts by interpreter', () => {
    expect(detectLanguageFromContent('#!/usr/bin/env python3\nprint(1)')).toBe('python');
    expect(detectLanguageFromContent('#!/bin/bash\necho hi')).toBe('shell');
    expect(detectLanguageFromContent('#!/usr/bin/env pwsh\nWrite-Host hi')).toBe('powershell');
    expect(detectLanguageFromContent('#!/usr/bin/env node\nconsole.log(1)')).toBe('javascript');
  });

  it('detects HTML / XML / diff', () => {
    expect(detectLanguageFromContent('<!DOCTYPE html>\n<html><body></body></html>')).toBe('html');
    expect(detectLanguageFromContent('<?xml version="1.0"?>\n<root/>')).toBe('xml');
    expect(detectLanguageFromContent('<note><to>x</to></note>')).toBe('xml');
    expect(
      detectLanguageFromContent('diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@'),
    ).toBe('diff');
  });

  it('detects YAML by document marker or repeated key lines', () => {
    expect(detectLanguageFromContent('---\nname: qraft\nversion: 2')).toBe('yaml');
    expect(detectLanguageFromContent('name: qraft\nversion: 2')).toBe('yaml');
  });

  it('detects Markdown / INI / Dockerfile / SQL', () => {
    expect(detectLanguageFromContent('# Title\n\nbody text')).toBe('markdown');
    expect(detectLanguageFromContent('```js\nconst a = 1;\n```')).toBe('markdown');
    expect(detectLanguageFromContent('[section]\nkey=value')).toBe('ini');
    expect(
      detectLanguageFromContent('FROM node:20\nRUN npm ci\nCMD ["node", "dist/index.js"]'),
    ).toBe('dockerfile');
    expect(detectLanguageFromContent('SELECT id, name\nFROM users')).toBe('sql');
  });

  it('returns null for empty or unrecognizable content', () => {
    expect(detectLanguageFromContent('')).toBeNull();
    expect(detectLanguageFromContent('   \n  ')).toBeNull();
    expect(detectLanguageFromContent('just some plain words here')).toBeNull();
  });
});

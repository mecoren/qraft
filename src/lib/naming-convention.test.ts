import { describe, it, expect } from 'vitest';
import {
  cycleNamingCase,
  detectConvention,
  splitWords,
  type NamingConventionId,
} from './naming-convention';

describe('naming-convention', () => {
  describe('splitWords', () => {
    it('splits kebab-case', () => {
      expect(splitWords('hello-world')).toEqual(['hello', 'world']);
    });
    it('splits snake_case', () => {
      expect(splitWords('hello_world')).toEqual(['hello', 'world']);
    });
    it('splits camelCase', () => {
      expect(splitWords('helloWorld')).toEqual(['hello', 'World']);
    });
    it('splits PascalCase', () => {
      expect(splitWords('HelloWorld')).toEqual(['Hello', 'World']);
    });
    it('splits space separated', () => {
      expect(splitWords('hello world')).toEqual(['hello', 'world']);
    });
  });

  describe('detectConvention', () => {
    it('detects camelCase', () => {
      expect(detectConvention('helloWorld')?.id).toBe('camelCase');
    });
    it('detects PascalCase', () => {
      expect(detectConvention('HelloWorld')?.id).toBe('CamelCase');
    });
    it('detects snake_case', () => {
      expect(detectConvention('hello_world')?.id).toBe('snake_case');
    });
    it('detects SNAKE_CASE', () => {
      expect(detectConvention('HELLO_WORLD')?.id).toBe('SNAKE_CASE');
    });
    it('detects kebab-case', () => {
      expect(detectConvention('hello-world')?.id).toBe('kebab-case');
    });
    it('detects space case', () => {
      expect(detectConvention('hello world')?.id).toBe('space case');
    });
    it('detects title case', () => {
      expect(detectConvention('Hello World')?.id).toBe('Camel Case');
    });
    it('returns null for unknown', () => {
      expect(detectConvention('hello')).toBeNull();
    });
  });

  describe('cycleNamingCase', () => {
    const enabled: NamingConventionId[] = ['snake_case', 'camelCase', 'SNAKE_CASE'];
    const order: NamingConventionId[] = ['snake_case', 'camelCase', 'SNAKE_CASE'];

    it('cycles to next enabled convention', () => {
      expect(cycleNamingCase('hello_world', enabled, order)).toBe('helloWorld');
      expect(cycleNamingCase('helloWorld', enabled, order)).toBe('HELLO_WORLD');
      expect(cycleNamingCase('HELLO_WORLD', enabled, order)).toBe('hello_world');
    });

    it('starts from first enabled when current is unknown', () => {
      expect(cycleNamingCase('hello-World', enabled, order)).toBe('hello_world');
    });

    it('toggles case when no convention is enabled', () => {
      expect(cycleNamingCase('hello_world', [], order)).toBe('HELLO_WORLD');
      expect(cycleNamingCase('HELLO_WORLD', [], order)).toBe('hello_world');
    });

    it('preserves single-letter words', () => {
      expect(cycleNamingCase('a_b', enabled, order)).toBe('aB');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { GhNotifyParser } from './gh-notify-parser.js';

describe('GhNotifyParser', () => {
  const parser = new GhNotifyParser();

  describe('parse', () => {
    it('should parse single unread notification', () => {
      const output = '•  2m   owner/repo  PullRequest  #123  mention  feat: add new feature';
      const result = parser.parse(output);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        repository: 'owner/repo',
        subjectType: 'PullRequest',
        subjectNumber: 123,
        subjectTitle: 'feat: add new feature',
        reason: 'mention',
        read: false,
      });
      expect(result[0].updatedAt).toBeInstanceOf(Date);
    });

    it('should parse single read notification', () => {
      const output = '✓  5h   owner/repo  Issue  #456  author  bug: something broke';
      const result = parser.parse(output);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        repository: 'owner/repo',
        subjectType: 'Issue',
        subjectNumber: 456,
        subjectTitle: 'bug: something broke',
        reason: 'author',
        read: true,
      });
    });

    it('should parse notification without issue number (Release)', () => {
      const output = '•  1d   owner/repo  Release  subscribed  v1.0.0';
      const result = parser.parse(output);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        repository: 'owner/repo',
        subjectType: 'Release',
        subjectNumber: null,
        subjectTitle: 'v1.0.0',
        reason: 'subscribed',
        read: false,
      });
    });

    it('should parse multiple notifications', () => {
      const output = `
✓  2m   owner/repo1  PullRequest  #123  mention  feat: add feature
•  5h   owner/repo2  Issue        #456  author   bug: fix this
✓  1d   owner/repo3  Release            subscribed  v1.0.0
      `.trim();

      const result = parser.parse(output);

      expect(result).toHaveLength(3);
      expect(result[0].repository).toBe('owner/repo1');
      expect(result[1].repository).toBe('owner/repo2');
      expect(result[2].repository).toBe('owner/repo3');
    });

    it('should handle truncated repository names', () => {
      const output = '•  2m   very-long-owner/ver...  PullRequest  #123  mention  feat: add feature';
      const result = parser.parse(output);

      expect(result).toHaveLength(1);
      expect(result[0].repository).toBe('very-long-owner/ver');
    });

    it('should skip invalid lines', () => {
      const output = `
✓  2m   owner/repo  PullRequest  #123  mention  valid line
This is invalid line
•  5h   owner/repo2  Issue  #456  author  another valid line
      `.trim();

      const result = parser.parse(output);

      expect(result).toHaveLength(2);
      expect(result[0].subjectNumber).toBe(123);
      expect(result[1].subjectNumber).toBe(456);
    });

    it('should handle empty output', () => {
      const result = parser.parse('');
      expect(result).toHaveLength(0);
    });
  });

  describe('parseTimeAgo', () => {
    it('should parse minutes correctly', () => {
      const output = '•  5m   owner/repo  Issue  #1  mention  test';
      const result = parser.parse(output);

      const now = new Date();
      const diff = now.getTime() - result[0].updatedAt.getTime();

      // Should be around 5 minutes (with some tolerance)
      expect(diff).toBeGreaterThan(4 * 60 * 1000);
      expect(diff).toBeLessThan(6 * 60 * 1000);
    });

    it('should parse hours correctly', () => {
      const output = '•  3h   owner/repo  Issue  #1  mention  test';
      const result = parser.parse(output);

      const now = new Date();
      const diff = now.getTime() - result[0].updatedAt.getTime();

      // Should be around 3 hours
      expect(diff).toBeGreaterThan(2.9 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(3.1 * 60 * 60 * 1000);
    });

    it('should parse days correctly', () => {
      const output = '•  2d   owner/repo  Issue  #1  mention  test';
      const result = parser.parse(output);

      const now = new Date();
      const diff = now.getTime() - result[0].updatedAt.getTime();

      // Should be around 2 days
      expect(diff).toBeGreaterThan(1.9 * 24 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(2.1 * 24 * 60 * 60 * 1000);
    });
  });
});

import { describe, expect, it } from 'vitest';
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
      const output =
        '•  2m   very-long-owner/ver...  PullRequest  #123  mention  feat: add feature';
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

    it('should parse long format time (21min ago)', () => {
      const output = '•  21min ago   owner/repo  Issue  #1  mention  test';
      const result = parser.parse(output);

      const now = new Date();
      const diff = now.getTime() - result[0].updatedAt.getTime();

      // Should be around 21 minutes
      expect(diff).toBeGreaterThan(20 * 60 * 1000);
      expect(diff).toBeLessThan(22 * 60 * 1000);
    });

    it('should parse long format time (2h ago)', () => {
      const output = '•  2h ago   owner/repo  Issue  #1  mention  test';
      const result = parser.parse(output);

      const now = new Date();
      const diff = now.getTime() - result[0].updatedAt.getTime();

      // Should be around 2 hours
      expect(diff).toBeGreaterThan(1.9 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(2.1 * 60 * 60 * 1000);
    });
  });

  describe('ANSI codes stripping', () => {
    it('should parse notification with ANSI color codes', () => {
      // Real output from gh notify with colors
      const output =
        '\x1b[35m●\x1b[0m  \x1b[90m21min ago\x1b[0m  \x1b[36mfixcik\x1b[0m/\x1b[1;36mgh-automation\x1b[0m  \x1b[1;37mPullRequest\x1b[0m  \x1b[0;32m#1\x1b[0m  \x1b[90mauthor\x1b[0m  feat: Initial implementation';
      const result = parser.parse(output);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        repository: 'fixcik/gh-automation',
        subjectType: 'PullRequest',
        subjectNumber: 1,
        subjectTitle: 'feat: Initial implementation',
        reason: 'author',
        read: false,
      });
    });

    it('should parse multiple notifications with ANSI codes', () => {
      const output = `\x1b[35m●\x1b[0m  \x1b[90m20min ago\x1b[0m  \x1b[36mowner\x1b[0m/\x1b[1;36mrepo1\x1b[0m  \x1b[1;37mPullRequest\x1b[0m  \x1b[0;32m#1\x1b[0m  \x1b[90mauthor\x1b[0m  feat: one
\x1b[35m \x1b[0m  \x1b[90m2h ago\x1b[0m  \x1b[36mowner\x1b[0m/\x1b[1;36mrepo2\x1b[0m  \x1b[1;37mIssue\x1b[0m  \x1b[0;32m#2\x1b[0m  \x1b[90mmention\x1b[0m  bug: two`;
      const result = parser.parse(output);

      expect(result).toHaveLength(2);
      expect(result[0].repository).toBe('owner/repo1');
      expect(result[1].repository).toBe('owner/repo2');
      expect(result[0].read).toBe(false); // ● symbol
      expect(result[1].read).toBe(true); // space symbol (read)
    });
  });
});

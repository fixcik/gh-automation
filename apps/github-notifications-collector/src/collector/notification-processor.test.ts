import { NotificationReason, SubjectType } from '@gh-automation/shared-types';
import { describe, expect, it } from 'vitest';
import type { ParsedNotification } from '../types/parsed-notification.js';
import { NotificationProcessor } from './notification-processor.js';

describe('NotificationProcessor', () => {
  const processor = new NotificationProcessor();

  describe('process', () => {
    it('should process notification with number', () => {
      const parsed: ParsedNotification = {
        repository: 'owner/repo',
        subjectType: 'PullRequest',
        subjectNumber: 123,
        subjectTitle: 'feat: add new feature',
        subjectUrl: null,
        reason: 'mention',
        read: false,
        updatedAt: new Date(),
      };

      const [result] = processor.process([parsed]);

      expect(result.notificationId).toBe('owner/repo:PullRequest:123');
      expect(result.repository).toBe('owner/repo');
      expect(result.subjectType).toBe(SubjectType.PULL_REQUEST);
      expect(result.subjectNumber).toBe(123);
      expect(result.reason).toBe(NotificationReason.MENTION);
      expect(result.read).toBe(false);
    });

    it('should process notification without number (Release)', () => {
      const parsed: ParsedNotification = {
        repository: 'owner/repo',
        subjectType: 'Release',
        subjectNumber: null,
        subjectTitle: 'v1.0.0',
        subjectUrl: null,
        reason: 'subscribed',
        read: true,
        updatedAt: new Date(),
      };

      const [result] = processor.process([parsed]);

      // ID должен содержать hash от title
      expect(result.notificationId).toMatch(/^owner\/repo:Release:\w+$/);
      expect(result.subjectType).toBe(SubjectType.RELEASE);
      expect(result.subjectNumber).toBeNull();
      expect(result.reason).toBe(NotificationReason.SUBSCRIBED);
    });

    it('should generate same ID for same notification without number', () => {
      const parsed: ParsedNotification = {
        repository: 'owner/repo',
        subjectType: 'Release',
        subjectNumber: null,
        subjectTitle: 'v1.0.0',
        subjectUrl: null,
        reason: 'subscribed',
        read: true,
        updatedAt: new Date(),
      };

      const [result1] = processor.process([parsed]);
      const [result2] = processor.process([parsed]);

      expect(result1.notificationId).toBe(result2.notificationId);
    });

    it('should map various subject types correctly', () => {
      const testCases = [
        { input: 'PullRequest', expected: SubjectType.PULL_REQUEST },
        { input: 'Issue', expected: SubjectType.ISSUE },
        { input: 'Release', expected: SubjectType.RELEASE },
        { input: 'Commit', expected: SubjectType.COMMIT },
        { input: 'Discussion', expected: SubjectType.DISCUSSION },
      ];

      testCases.forEach(({ input, expected }) => {
        const parsed: ParsedNotification = {
          repository: 'owner/repo',
          subjectType: input,
          subjectNumber: 1,
          subjectTitle: 'test',
          subjectUrl: null,
          reason: 'mention',
          read: false,
          updatedAt: new Date(),
        };

        const [result] = processor.process([parsed]);
        expect(result.subjectType).toBe(expected);
      });
    });

    it('should map various reasons correctly', () => {
      const testCases = [
        { input: 'mention', expected: NotificationReason.MENTION },
        { input: 'author', expected: NotificationReason.AUTHOR },
        { input: 'comment', expected: NotificationReason.COMMENT },
        { input: 'review_requested', expected: NotificationReason.REVIEW_REQUESTED },
        { input: 'subscribed', expected: NotificationReason.SUBSCRIBED },
      ];

      testCases.forEach(({ input, expected }) => {
        const parsed: ParsedNotification = {
          repository: 'owner/repo',
          subjectType: 'Issue',
          subjectNumber: 1,
          subjectTitle: 'test',
          subjectUrl: null,
          reason: input,
          read: false,
          updatedAt: new Date(),
        };

        const [result] = processor.process([parsed]);
        expect(result.reason).toBe(expected);
      });
    });

    it('should process multiple notifications', () => {
      const parsed: ParsedNotification[] = [
        {
          repository: 'owner/repo1',
          subjectType: 'PullRequest',
          subjectNumber: 1,
          subjectTitle: 'PR 1',
          subjectUrl: null,
          reason: 'mention',
          read: false,
          updatedAt: new Date(),
        },
        {
          repository: 'owner/repo2',
          subjectType: 'Issue',
          subjectNumber: 2,
          subjectTitle: 'Issue 2',
          subjectUrl: null,
          reason: 'author',
          read: true,
          updatedAt: new Date(),
        },
      ];

      const results = processor.process(parsed);

      expect(results).toHaveLength(2);
      expect(results[0].notificationId).toBe('owner/repo1:PullRequest:1');
      expect(results[1].notificationId).toBe('owner/repo2:Issue:2');
    });
  });
});

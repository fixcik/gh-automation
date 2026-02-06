import { NewGithubNotification } from '@gh-automation/database';
import { NotificationReason, SubjectType } from '@gh-automation/shared-types';
import { ParsedNotification } from '../types/parsed-notification.js';

/**
 * NotificationProcessor обрабатывает спарсенные нотификации:
 * - Генерирует детерминированный notification_id
 * - Валидирует enums
 * - Подготавливает данные для вставки в БД
 */
export class NotificationProcessor {
  process(parsed: ParsedNotification[]): NewGithubNotification[] {
    return parsed.map((p) => this.processOne(p));
  }

  private processOne(parsed: ParsedNotification): NewGithubNotification {
    const notificationId = this.generateNotificationId(parsed);

    return {
      notificationId,
      repository: parsed.repository,
      subjectType: this.mapSubjectType(parsed.subjectType),
      subjectNumber: parsed.subjectNumber,
      subjectTitle: parsed.subjectTitle,
      subjectUrl: parsed.subjectUrl,
      reason: this.mapReason(parsed.reason),
      read: parsed.read,
      updatedAt: parsed.updatedAt,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    };
  }

  /**
   * Генерирует детерминированный ID формата:
   * {repository}:{subjectType}:{subjectNumber|title-hash}
   *
   * Примеры:
   * - owner/repo:PullRequest:123
   * - owner/repo:Release:abc123 (hash от title для releases без номера)
   */
  private generateNotificationId(parsed: ParsedNotification): string {
    const { repository, subjectType, subjectNumber, subjectTitle } = parsed;

    if (subjectNumber !== null) {
      return `${repository}:${subjectType}:${subjectNumber}`;
    }

    // Для объектов без номера (Release, Commit) - используем hash от title
    const titleHash = this.simpleHash(subjectTitle);
    return `${repository}:${subjectType}:${titleHash}`;
  }

  /**
   * Простой хеш для генерации короткого ID
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Маппит субъект в валидный enum
   */
  private mapSubjectType(type: string): string {
    const normalized = type.toLowerCase();

    switch (normalized) {
      case 'pullrequest':
      case 'pull_request':
        return SubjectType.PULL_REQUEST;
      case 'issue':
        return SubjectType.ISSUE;
      case 'release':
        return SubjectType.RELEASE;
      case 'commit':
        return SubjectType.COMMIT;
      case 'discussion':
        return SubjectType.DISCUSSION;
      case 'repositoryvulnerabilityalert':
      case 'repository_vulnerability_alert':
        return SubjectType.REPOSITORY_VULNERABILITY_ALERT;
      default:
        return type; // Оставляем как есть, если неизвестный тип
    }
  }

  /**
   * Маппит reason в валидный enum
   */
  private mapReason(reason: string): string {
    const normalized = reason.toLowerCase();

    const mapping: Record<string, NotificationReason> = {
      assign: NotificationReason.ASSIGN,
      author: NotificationReason.AUTHOR,
      comment: NotificationReason.COMMENT,
      invitation: NotificationReason.INVITATION,
      manual: NotificationReason.MANUAL,
      mention: NotificationReason.MENTION,
      review_requested: NotificationReason.REVIEW_REQUESTED,
      security_alert: NotificationReason.SECURITY_ALERT,
      state_change: NotificationReason.STATE_CHANGE,
      subscribed: NotificationReason.SUBSCRIBED,
      team_mention: NotificationReason.TEAM_MENTION,
    };

    return mapping[normalized] || reason;
  }
}

import type { NotificationReason } from '../enums/notification-reason.enum';
import type { SubjectType } from '../enums/subject-type.enum';

export interface GithubNotificationEvent {
  eventId: string;
  eventType: 'github.notification.created' | 'github.notification.updated';
  aggregateType: 'GithubNotification';
  aggregateId: string;
  payload: {
    notificationId: string;
    repository: string;
    subjectType: SubjectType;
    subjectNumber: number | null;
    subjectTitle: string;
    subjectUrl: string | null;
    reason: NotificationReason;
    read: boolean;
    updatedAt: string; // ISO 8601
    firstSeenAt: string; // ISO 8601
    lastSeenAt: string; // ISO 8601
  };
  metadata?: {
    source?: string;
    [key: string]: unknown;
  };
  createdAt: string; // ISO 8601
}

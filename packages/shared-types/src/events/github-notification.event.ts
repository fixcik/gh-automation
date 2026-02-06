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
    updatedAt: Date;
    firstSeenAt: Date;
    lastSeenAt: Date;
  };
  metadata?: {
    source?: string;
    [key: string]: unknown;
  };
  createdAt: Date;
}

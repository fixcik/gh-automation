export interface ParsedNotification {
  repository: string;
  subjectType: string;
  subjectNumber: number | null;
  subjectTitle: string;
  subjectUrl: string | null;
  reason: string;
  read: boolean;
  updatedAt: Date;
}

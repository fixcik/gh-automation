import { ParsedNotification } from '../types/parsed-notification.js';

/**
 * GhNotifyParser парсит табличный вывод команды `gh notify -an <limit> -s`
 *
 * Формат вывода (примеры):
 * ✓  2m   owner/repo  PullRequest  #123  mention  feat: add new feature
 * ✓  5h   owner/repo  Issue        #456  author   bug: something broke
 * •  1d   owner/repo  Release            subscribed  v1.0.0
 *
 * Легенда:
 * ✓ - прочитано (read=true)
 * • - не прочитано (read=false)
 */
export class GhNotifyParser {
  private readonly LINE_REGEX = /^([✓•])\s+(\S+)\s+(\S+)\s+(\w+)\s+(?:#(\d+))?\s+(\w+)\s+(.+)$/;

  parse(output: string): ParsedNotification[] {
    const lines = output.trim().split('\n').filter(line => line.trim().length > 0);
    const notifications: ParsedNotification[] = [];

    for (const line of lines) {
      try {
        const parsed = this.parseLine(line);
        if (parsed) {
          notifications.push(parsed);
        }
      } catch (error) {
        // Skip invalid lines
        console.warn(`Failed to parse line: ${line}`, error);
      }
    }

    return notifications;
  }

  private parseLine(line: string): ParsedNotification | null {
    const match = line.match(this.LINE_REGEX);

    if (!match) {
      return null;
    }

    const [, readSymbol, timeAgo, repository, subjectType, numberStr, reason, title] = match;

    const read = readSymbol === '✓';
    const subjectNumber = numberStr ? parseInt(numberStr, 10) : null;
    const updatedAt = this.parseTimeAgo(timeAgo);

    // Clean up truncated repository names (если owner/repo обрезан)
    const cleanRepo = repository.endsWith('...') ? repository.slice(0, -3) : repository;

    return {
      repository: cleanRepo,
      subjectType,
      subjectNumber,
      subjectTitle: title.trim(),
      subjectUrl: null, // Будет заполнено позже через GitHub API
      reason,
      read,
      updatedAt,
    };
  }

  /**
   * Парсит относительное время (2m, 5h, 1d, 3w, 2mo, 1y) в Date
   */
  private parseTimeAgo(timeAgo: string): Date {
    const now = new Date();
    const match = timeAgo.match(/^(\d+)([mhdwMy])$/);

    if (!match) {
      // Если формат неизвестен, возвращаем текущее время
      return now;
    }

    const [, amountStr, unit] = match;
    const amount = parseInt(amountStr, 10);

    switch (unit) {
      case 'm': // minutes
        return new Date(now.getTime() - amount * 60 * 1000);
      case 'h': // hours
        return new Date(now.getTime() - amount * 60 * 60 * 1000);
      case 'd': // days
        return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
      case 'w': // weeks
        return new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
      case 'M': // months (approximation: 30 days)
        return new Date(now.getTime() - amount * 30 * 24 * 60 * 60 * 1000);
      case 'y': // years (approximation: 365 days)
        return new Date(now.getTime() - amount * 365 * 24 * 60 * 60 * 1000);
      default:
        return now;
    }
  }
}

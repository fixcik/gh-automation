import type { Logger } from '@gh-automation/logger';
import type { ParsedNotification } from '../types/parsed-notification.js';

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
  constructor(private readonly logger?: Logger) {}
  // Регулярка поддерживает оба формата времени: "2m" и "21min ago"
  private readonly LINE_REGEX =
    /^([✓•●\s])\s+(\S+(?:\s+ago)?)\s+(\S+)\s+(\w+)\s+(?:#(\d+))?\s+(\w+)\s+(.+)$/;
  // eslint-disable-next-line no-control-regex
  private readonly ANSI_REGEX = /\x1b\[[0-9;]*m/g;

  parse(output: string): ParsedNotification[] {
    const lines = output
      .trim()
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const notifications: ParsedNotification[] = [];

    for (const line of lines) {
      try {
        const parsed = this.parseLine(line);
        if (parsed) {
          notifications.push(parsed);
        }
      } catch (error) {
        // Skip invalid lines
        this.logger?.warn({ line, error }, 'Failed to parse line');
      }
    }

    return notifications;
  }

  /**
   * Удаляет ANSI escape-коды из строки
   */
  private stripAnsi(text: string): string {
    return text.replace(this.ANSI_REGEX, '');
  }

  private parseLine(line: string): ParsedNotification | null {
    // Убираем ANSI коды перед парсингом
    const cleanLine = this.stripAnsi(line);
    const match = cleanLine.match(this.LINE_REGEX);

    if (!match) {
      return null;
    }

    const [, readSymbol, timeAgo, repository, subjectType, numberStr, reason, title] = match;

    // Space or empty = read notification (gh notify shows no icon for read items in colored output)
    const read = readSymbol.trim() === '✓' || readSymbol.trim() === '';
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
   * Парсит относительное время (2m, 5h, 1d, 3w, 2mo, 1y, 21min ago, 2h ago) в Date
   */
  private parseTimeAgo(timeAgo: string): Date {
    const now = new Date();

    // Поддержка формата "21min ago", "2h ago", "3d ago"
    const longMatch = timeAgo.match(/^(\d+)(min|h|d|w|mo|y)\s+ago$/);
    if (longMatch) {
      const [, amountStr, unit] = longMatch;
      const amount = parseInt(amountStr, 10);
      return this.calculateTimeOffset(now, amount, unit);
    }

    // Поддержка короткого формата "2m", "5h", "1d"
    const shortMatch = timeAgo.match(/^(\d+)([mhdwMy])$/);
    if (shortMatch) {
      const [, amountStr, unit] = shortMatch;
      const amount = parseInt(amountStr, 10);
      return this.calculateTimeOffset(now, amount, unit);
    }

    // Если формат неизвестен, возвращаем текущее время
    return now;
  }

  private calculateTimeOffset(now: Date, amount: number, unit: string): Date {
    switch (unit) {
      case 'm':
      case 'min': // minutes
        return new Date(now.getTime() - amount * 60 * 1000);
      case 'h': // hours
        return new Date(now.getTime() - amount * 60 * 60 * 1000);
      case 'd': // days
        return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
      case 'w': // weeks
        return new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
      case 'M':
      case 'mo': // months (approximation: 30 days)
        return new Date(now.getTime() - amount * 30 * 24 * 60 * 60 * 1000);
      case 'y': // years (approximation: 365 days)
        return new Date(now.getTime() - amount * 365 * 24 * 60 * 60 * 1000);
      default:
        return now;
    }
  }
}

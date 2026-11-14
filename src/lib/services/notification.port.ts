/**
 * The doorway between the calendar engine and the platform's own
 * notifications. The engine decides WHAT to say and to WHOM; the platform
 * decides how it is delivered (its notifications table, bell icon, and so on)
 * and knows who its users are. The engine never talks to users directly.
 */
import type { Recipient } from '../calendar'

export interface RecipientEntry {
  userId: string
  recipient: Recipient
}

export interface OutgoingNotification {
  userId: string
  title: string
  message: string
  /** CALENDAR_REMINDER for a countdown, CALENDAR_CHANGE for a moved date. */
  type: 'CALENDAR_REMINDER' | 'CALENDAR_CHANGE'
  /** Where the notification should open. */
  link: string
}

export interface NotificationPort {
  /** Everyone who may receive calendar reminders, with their role. */
  listRecipients(): Promise<RecipientEntry[]>
  deliver(items: OutgoingNotification[]): Promise<void>
}

/** For tests and local use: keeps everything in memory. */
export class InMemoryNotificationPort implements NotificationPort {
  readonly delivered: OutgoingNotification[] = []
  constructor(private readonly recipients: RecipientEntry[] = []) {}
  async listRecipients() {
    return this.recipients
  }
  async deliver(items: OutgoingNotification[]) {
    this.delivered.push(...items)
  }
}

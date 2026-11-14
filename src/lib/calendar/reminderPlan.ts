/**
 * reminderPlan.ts - which reminders go out on a given day.
 *
 * The rule is simple and exact: a reminder goes out on the day that is
 * 30, 15 or 5 days before the date, and on no other day. A date entered
 * late never fires the countdowns it already missed. A reminder that was
 * sent is remembered, so running the job twice in one day sends nothing
 * the second time.
 *
 * A moved date is noticed by comparing with the last date seen; the people
 * affected get one "this has moved" message.
 */
import { addDays, compareISODate } from './date-utils'
import type { ISODate } from './date-utils'
import { REMINDER_GROUP_KEYS } from './calendarEvents'
import type { CalendarEvent, ReminderGroupKey } from './calendarEvents'
import { buildReminderMessage } from './reminderMessages'
import type { ReminderDays } from './reminderMessages'
import { REMINDER_THRESHOLDS_DAYS } from './reminders'

export interface GroupSetting {
  enabled: boolean
  send30: boolean
  send15: boolean
  send5: boolean
}
export type ReminderSettings = Record<ReminderGroupKey, GroupSetting>

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = Object.fromEntries(
  REMINDER_GROUP_KEYS.map((k) => [k, { enabled: true, send30: true, send15: true, send5: true }]),
) as ReminderSettings

export function thresholdEnabled(setting: GroupSetting, days: ReminderDays): boolean {
  if (!setting.enabled) return false
  return days === 30 ? setting.send30 : days === 15 ? setting.send15 : setting.send5
}

export interface DueReminder {
  /** Remembered once sent: item | days | date. Moves to a new key when the date moves. */
  dispatchKey: string
  event: CalendarEvent
  days: ReminderDays
}

export function dispatchKeyFor(event: CalendarEvent, days: ReminderDays): string {
  return `${event.key}|${days}|${event.date}`
}

/**
 * The countdown reminders due on `today`.
 * @param alreadySent keys already sent (never sent twice)
 */
export function dueRemindersOn(
  events: CalendarEvent[],
  settings: ReminderSettings,
  today: ISODate,
  alreadySent: ReadonlySet<string> = new Set(),
): DueReminder[] {
  const byKey = new Map(events.map((e) => [e.key, e]))
  const due: DueReminder[] = []
  for (const event of events) {
    const setting = settings[event.group]
    for (const days of REMINDER_THRESHOLDS_DAYS) {
      if (!thresholdEnabled(setting, days)) continue
      if (addDays(event.date, -days) !== today) continue
      const key = dispatchKeyFor(event, days)
      if (alreadySent.has(key)) continue
      // Stay quiet when another event on the same day says the same thing
      // and is going out at this same countdown.
      if (event.duplicateOf) {
        const twin = byKey.get(event.duplicateOf)
        if (twin && twin.date === event.date && thresholdEnabled(settings[twin.group], days)) continue
      }
      due.push({ dispatchKey: key, event, days })
    }
  }
  return due
}

export interface KnownDate {
  dueDate: ISODate
  name: string
  group: ReminderGroupKey
}

export interface MovedItem {
  event: CalendarEvent
  oldDate: ISODate
}

/**
 * Items whose date is different from the last date we saw. Only moves that
 * still matter are announced: either the old or the new date has to be today
 * or later. Items seen for the first time are never "moved".
 */
export function detectMovedItems(
  events: CalendarEvent[],
  known: ReadonlyMap<string, KnownDate>,
  settings: ReminderSettings,
  today: ISODate,
): MovedItem[] {
  const moved: MovedItem[] = []
  for (const event of events) {
    const before = known.get(event.key)
    if (!before || before.dueDate === event.date) continue
    if (!settings[event.group].enabled) continue
    if (compareISODate(event.date, today) < 0 && compareISODate(before.dueDate, today) < 0) continue
    moved.push({ event, oldDate: before.dueDate })
  }
  return moved
}

/** The "this has moved" message for one moved item, as a topic ready for
 *  `buildReminderMessage` / `reminderForRecipient`. */
export function movedTopic(m: MovedItem) {
  return { topic: 'DATE_MOVED' as const, itemName: m.event.name, oldDate: m.oldDate, newDate: m.event.date }
}

/** Preview of every message for one reminder, for the admin screen. */
export function previewDue(due: DueReminder) {
  return (['STUDENT', 'GRADE_12_STUDENT', 'TEACHER', 'HOMEROOM_TEACHER', 'GRADE_12_HOMEROOM_TEACHER', 'OFFICE'] as const).map(
    (audience) => ({ audience, message: buildReminderMessage(audience, due.event.topic, due.days) }),
  )
}

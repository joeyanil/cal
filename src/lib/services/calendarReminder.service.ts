import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { loadCalendarSource } from './calendarSource.service'
import type { NotificationPort, OutgoingNotification } from './notification.port'
import {
  DEFAULT_REMINDER_SETTINGS, REMINDER_GROUP_KEYS, REMINDER_GROUP_LABELS, REMINDER_THRESHOLDS_DAYS,
  addDays, collectCalendarEvents, detectMovedItems, dueRemindersOn, dispatchKeyFor, movedTopic,
  previewDue, reminderForRecipient, thresholdEnabled,
} from '../calendar'
import type { GroupSetting, ISODate, KnownDate, ReminderGroupKey, ReminderSettings } from '../calendar'

// ---------------------------------------------------------------------------
// Settings: which of the nine groups the school sends, and at which countdowns
// ---------------------------------------------------------------------------

export async function loadReminderSettings(supabase: SupabaseClient<Database>): Promise<ReminderSettings> {
  const { data, error } = await supabase.from('calendar_reminder_settings').select()
  if (error) throw new AppError('CALENDAR_REMINDER_SETTINGS_FAILED', 500, error.message)
  const settings: ReminderSettings = structuredClone(DEFAULT_REMINDER_SETTINGS)
  for (const r of data ?? []) {
    if ((REMINDER_GROUP_KEYS as readonly string[]).includes(r.group_key)) {
      settings[r.group_key as ReminderGroupKey] = { enabled: r.enabled, send30: r.send_30, send15: r.send_15, send5: r.send_5 }
    }
  }
  return settings
}

export async function getReminderSettings(supabase: SupabaseClient<Database>, ctx: AuthContext) {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const settings = await loadReminderSettings(supabase)
  return REMINDER_GROUP_KEYS.map((key) => ({ key, label: REMINDER_GROUP_LABELS[key], ...settings[key] }))
}

export const updateReminderSettingsSchema = z.object({
  groups: z
    .array(
      z.object({
        key: z.enum(REMINDER_GROUP_KEYS),
        enabled: z.boolean().optional(),
        send30: z.boolean().optional(),
        send15: z.boolean().optional(),
        send5: z.boolean().optional(),
      }),
    )
    .min(1),
})

export async function updateReminderSettings(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  input: z.input<typeof updateReminderSettingsSchema>,
) {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const parsed = updateReminderSettingsSchema.parse(input)
  for (const g of parsed.groups) {
    const patch: Database['public']['Tables']['calendar_reminder_settings']['Update'] = {}
    if (g.enabled !== undefined) patch.enabled = g.enabled
    if (g.send30 !== undefined) patch.send_30 = g.send30
    if (g.send15 !== undefined) patch.send_15 = g.send15
    if (g.send5 !== undefined) patch.send_5 = g.send5
    if (Object.keys(patch).length === 0) continue
    const { error } = await supabase.from('calendar_reminder_settings').update(patch).eq('group_key', g.key)
    if (error) throw new AppError('CALENDAR_REMINDER_SETTINGS_FAILED', 500, error.message)
  }
  return getReminderSettings(supabase, ctx)
}

// ---------------------------------------------------------------------------
// Preview for the admin: the full schedule, and the exact words
// ---------------------------------------------------------------------------

export async function previewReminders(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  today: ISODate,
) {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const source = await loadCalendarSource(supabase, academicYearId)
  const settings = await loadReminderSettings(supabase)
  const events = collectCalendarEvents(source)

  const schedule = events.flatMap((event) =>
    REMINDER_THRESHOLDS_DAYS.map((days) => ({
      key: dispatchKeyFor(event, days),
      group: event.group,
      name: event.name,
      eventDate: event.date,
      days,
      sendOn: addDays(event.date, -days),
      willSend: thresholdEnabled(settings[event.group], days),
    })),
  ).sort((a, b) => (a.sendOn < b.sendOn ? -1 : a.sendOn > b.sendOn ? 1 : 0))

  const dueToday = dueRemindersOn(events, settings, today).map((d) => ({
    name: d.event.name,
    group: d.event.group,
    days: d.days,
    messages: previewDue(d),
  }))
  return { today, schedule, dueToday }
}

// ---------------------------------------------------------------------------
// The daily job
// ---------------------------------------------------------------------------

export interface ReminderRunSummary {
  today: ISODate
  years: number
  remindersSent: number
  movedSent: number
  notifications: number
  /** Set when nothing was done on purpose (nobody to send to yet). */
  skipped: 'NO_RECIPIENTS' | null
}

/**
 * Run once a day (and safe to run again: nothing is ever sent twice).
 * Needs a service-role client: it reads every open year.
 *
 *  1. For every year that is not closed, work out the reminders due today.
 *  2. Announce dates that moved since the last run.
 *  3. Hand the messages to the platform through the notification port.
 *  4. Remember what was sent and the dates seen.
 */
export async function runDailyReminders(
  admin: SupabaseClient<Database>,
  port: NotificationPort,
  today: ISODate,
): Promise<ReminderRunSummary> {
  const summary: ReminderRunSummary = { today, years: 0, remindersSent: 0, movedSent: 0, notifications: 0, skipped: null }

  const { data: years, error: yErr } = await admin.from('academic_years').select('id').neq('status', 'CLOSED')
  if (yErr) throw new AppError('CALENDAR_REMINDER_JOB_FAILED', 500, yErr.message)

  const settings = await loadReminderSettings(admin)
  const recipients = await port.listRecipients()
  // Nobody to send to (for example the platform is not connected yet):
  // do nothing, and remember nothing, so no reminder is lost.
  if (recipients.length === 0) return { ...summary, skipped: 'NO_RECIPIENTS' }

  for (const y of years ?? []) {
    summary.years++
    const source = await loadCalendarSource(admin, y.id)
    const events = collectCalendarEvents(source)

    const { data: sentRows, error: sErr } = await admin
      .from('calendar_reminder_dispatch')
      .select('dispatch_key')
      .eq('academic_year_id', y.id)
    if (sErr) throw new AppError('CALENDAR_REMINDER_JOB_FAILED', 500, sErr.message)
    // Stored keys carry the year in front so two years never clash.
    const prefix = `${y.id}|`
    const strip = (k: string) => (k.startsWith(prefix) ? k.slice(prefix.length) : k)
    const sent = new Set((sentRows ?? []).map((r) => strip(r.dispatch_key)))

    const { data: knownRows, error: kErr } = await admin
      .from('calendar_reminder_known_dates')
      .select()
      .eq('academic_year_id', y.id)
    if (kErr) throw new AppError('CALENDAR_REMINDER_JOB_FAILED', 500, kErr.message)
    const known = new Map<string, KnownDate>(
      (knownRows ?? []).map((r) => [
        strip(r.item_key),
        { dueDate: r.due_date as ISODate, name: r.item_name, group: r.group_key as ReminderGroupKey },
      ]),
    )

    // Moved dates first, so people hear about a change before the countdown.
    for (const m of detectMovedItems(events, known, settings, today)) {
      const topic = movedTopic(m)
      const items: OutgoingNotification[] = []
      for (const r of recipients) {
        const msg = reminderForRecipient(r.recipient, m.event, 30, topic)
        if (msg) {
          items.push({ userId: r.userId, title: msg.title, message: msg.body, type: 'CALENDAR_CHANGE', link: `/calendar/${y.id}/year` })
        }
      }
      if (items.length > 0) await port.deliver(items)
      summary.movedSent++
      summary.notifications += items.length
    }

    for (const due of dueRemindersOn(events, settings, today, sent)) {
      const items: OutgoingNotification[] = []
      for (const r of recipients) {
        const msg = reminderForRecipient(r.recipient, due.event, due.days)
        if (msg) {
          items.push({ userId: r.userId, title: msg.title, message: msg.body, type: 'CALENDAR_REMINDER', link: `/calendar/${y.id}/year` })
        }
      }
      if (items.length > 0) await port.deliver(items)
      const { error } = await admin
        .from('calendar_reminder_dispatch')
        .upsert(
          { dispatch_key: prefix + due.dispatchKey, academic_year_id: y.id, group_key: due.event.group, sent_on: today },
          { onConflict: 'dispatch_key', ignoreDuplicates: true },
        )
      if (error) throw new AppError('CALENDAR_REMINDER_JOB_FAILED', 500, error.message)
      summary.remindersSent++
      summary.notifications += items.length
    }

    // Remember every date seen, so the next run can notice a move.
    if (events.length > 0) {
      const { error } = await admin.from('calendar_reminder_known_dates').upsert(
        events.map((e) => ({ item_key: prefix + e.key, academic_year_id: y.id, group_key: e.group, item_name: e.name, due_date: e.date })),
        { onConflict: 'item_key' },
      )
      if (error) throw new AppError('CALENDAR_REMINDER_JOB_FAILED', 500, error.message)
    }
  }
  return summary
}

export type { GroupSetting }

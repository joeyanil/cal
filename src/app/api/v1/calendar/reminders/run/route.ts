import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { timingSafeEqual } from 'node:crypto'
import { AppError } from '@/lib/errors/AppError'
import { createAdminClient } from '@/lib/supabase/admin'
import { runDailyReminders } from '@/lib/services/calendarReminder.service'
import { getNotificationPort } from '@/lib/services/notification.adapter'
import { dateParam } from '@/lib/services/today'

/**
 * `POST /api/v1/calendar/reminders/run` - the daily reminder job.
 * Called once a day by a scheduler (not by a person), so it is protected by a
 * secret instead of a sign-in: send the header `x-calendar-job-secret`.
 * Safe to call again the same day; nothing is sent twice.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = process.env.CALENDAR_JOB_SECRET
    const given = req.headers.get('x-calendar-job-secret')
    const a = Buffer.from(given ?? '')
    const b = Buffer.from(secret ?? '')
    if (!secret || !given || a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('CALENDAR_REMINDER_JOB_FORBIDDEN', 403)
    const today = dateParam(req.nextUrl.searchParams.get('date'))
    return ok(await runDailyReminders(createAdminClient(), getNotificationPort(), today))
  })
}

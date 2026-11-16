import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getReminderSettings, updateReminderSettings } from '@/lib/services/calendarReminder.service'

/** `GET` - the nine reminder groups and whether each is on, and at 30/15/5 days. */
export async function GET() {
  return handleRoute(async () => {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getReminderSettings(supabase, ctx))
  })
}

/** `PUT { groups: [{ key, enabled?, send30?, send15?, send5? }] }` */
export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await updateReminderSettings(supabase, ctx, await req.json()))
  })
}

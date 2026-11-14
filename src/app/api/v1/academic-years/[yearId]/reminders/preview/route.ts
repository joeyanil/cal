import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { previewReminders } from '@/lib/services/calendarReminder.service'
import { dateParam } from '@/lib/services/today'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../reminders/preview?date=...` - the full reminder schedule of the
 *  year and the exact words that would go out on `date` (default today). */
export async function GET(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await previewReminders(supabase, ctx, yearId, dateParam(req.nextUrl.searchParams.get('date'))))
  })
}

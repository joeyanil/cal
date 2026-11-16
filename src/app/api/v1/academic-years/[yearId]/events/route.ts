import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getCalendarEvents } from '@/lib/services/calendarStatus.service'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../events` - every dated item of the year, in order. */
export async function GET(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getCalendarEvents(supabase, ctx, yearId))
  })
}

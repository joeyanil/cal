import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getPosition } from '@/lib/services/calendarStatus.service'
import { dateParam } from '@/lib/services/today'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../position?date=...` - where are we in the year, and the countdown
 *  to everything coming. `date` defaults to today at the school. */
export async function GET(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getPosition(supabase, ctx, yearId, dateParam(req.nextUrl.searchParams.get('date'))))
  })
}

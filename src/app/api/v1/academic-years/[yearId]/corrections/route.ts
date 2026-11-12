import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { applyCalendarCorrection } from '@/lib/services/calendarCorrection.service'

interface Params {
  params: Promise<{ yearId: string }>
}

/** Requires `calendar.correct_history` — the only path past a CLOSED
 *  year or half of the year. The date is simply updated: no reason, no record. */
export async function POST(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    return ok(await applyCalendarCorrection(supabase, ctx, yearId, body), 201)
  })
}

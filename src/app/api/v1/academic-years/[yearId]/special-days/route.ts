import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { createSpecialDay, listSpecialDays } from '@/lib/services/specialDay.service'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../special-days` - the special days of a year. */
export async function GET(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await listSpecialDays(supabase, ctx, yearId))
  })
}

/** `POST .../special-days` - add one. The body says whether students come. */
export async function POST(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await createSpecialDay(supabase, ctx, yearId, await req.json()), 201)
  })
}

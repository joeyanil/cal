import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { deleteSpecialDay, updateSpecialDay } from '@/lib/services/specialDay.service'

interface Params {
  params: Promise<{ yearId: string; id: string }>
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId, id } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await updateSpecialDay(supabase, ctx, yearId, id, await req.json()))
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId, id } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    await deleteSpecialDay(supabase, ctx, yearId, id)
    return ok({ deleted: true })
  })
}

import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors/AppError'
import { getDayStatus } from '@/lib/services/calendarStatus.service'
import { dateParam } from '@/lib/services/today'
import { GRADES } from '@/lib/calendar'
import type { Grade } from '@/lib/calendar'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../day-status?date=2027-03-05&grade=12` - is it a school day, and is
 *  attendance available (for that grade)? `date` defaults to today at the
 *  school; leave `grade` out for the whole school. */
export async function GET(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const date = dateParam(req.nextUrl.searchParams.get('date'))
    const rawGrade = req.nextUrl.searchParams.get('grade')
    let grade: Grade | null = null
    if (rawGrade !== null && rawGrade !== '') {
      const g = Number(rawGrade)
      if (!(GRADES as readonly number[]).includes(g)) throw new AppError('VALIDATION_ERROR', 422, 'Query parameter "grade" must be 9, 10, 11 or 12.')
      grade = g as Grade
    }
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getDayStatus(supabase, ctx, yearId, date, grade))
  })
}

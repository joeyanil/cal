import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors/AppError'
import { getSchoolDaysInPeriod } from '@/lib/services/calendarStatus.service'
import { GRADES, isValidISODate } from '@/lib/calendar'
import type { Grade, ISODate } from '@/lib/calendar'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../school-days?from=...&to=...&grade=10&enrolledFrom=...` - how many
 *  school days in the period (grade and enrolledFrom are optional). */
export async function GET(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const q = req.nextUrl.searchParams
    const need = (name: string) => {
      const v = q.get(name)
      if (!v || !isValidISODate(v)) throw new AppError('VALIDATION_ERROR', 422, `Query parameter "${name}" must be a valid date (YYYY-MM-DD).`)
      return v as ISODate
    }
    const from = need('from')
    const to = need('to')
    const enrolled = q.get('enrolledFrom')
    if (enrolled && !isValidISODate(enrolled)) throw new AppError('VALIDATION_ERROR', 422, 'Query parameter "enrolledFrom" must be a valid date.')
    const rawGrade = q.get('grade')
    let grade: Grade | null = null
    if (rawGrade) {
      if (!(GRADES as readonly number[]).includes(Number(rawGrade))) throw new AppError('VALIDATION_ERROR', 422, 'Query parameter "grade" must be 9, 10, 11 or 12.')
      grade = Number(rawGrade) as Grade
    }
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getSchoolDaysInPeriod(supabase, ctx, yearId, from, to, grade, (enrolled as ISODate) || null))
  })
}

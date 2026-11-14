import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getYearExportRows } from '@/lib/services/calendarStatus.service'
import { YEAR_EXPORT_COLUMNS, yearExportToCsv } from '@/lib/calendar'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../export?format=csv` downloads the whole year as a spreadsheet file.
 *  `format=json` (the default) returns the rows, for the platform's own PDF
 *  and Excel export. */
export async function GET(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const rows = await getYearExportRows(supabase, ctx, yearId)
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      return new NextResponse(yearExportToCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="school-year-calendar.csv"',
        },
      })
    }
    return ok({ columns: YEAR_EXPORT_COLUMNS, rows })
  })
}

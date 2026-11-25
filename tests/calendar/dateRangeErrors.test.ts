import { describe, expect, it } from 'vitest'
import { setSemesterDates } from '../../src/lib/services/semester.service'
import { updateAcademicYearBoundary } from '../../src/lib/services/academicYear.service'

// These mistakes are caught before the database is even asked, so a stand-in is enough.
const ctx = { user: { id: 'u', user_type: 'ADMIN', status: 'ACTIVE', email: null }, permissions: new Set(['calendar.manage']), supabaseUid: 'x' } as never
const db = {} as never

describe('reversed dates get a clear message, not a server error', () => {
  it('a school year that ends before it starts', async () => {
    await expect(updateAcademicYearBoundary(db, ctx, 'y', { startDate: '2027-07-01', endDate: '2026-09-01' } as never)).rejects.toMatchObject({
      code: 'CALENDAR_DATE_RANGE_INVALID', httpStatus: 422,
    })
  })
  it('a semester that ends before it starts', async () => {
    await expect(setSemesterDates(db, ctx, 'y', 1, { startDate: '2027-01-31', endDate: '2026-09-14' } as never)).rejects.toMatchObject({
      code: 'CALENDAR_DATE_RANGE_INVALID', httpStatus: 422,
    })
  })
})

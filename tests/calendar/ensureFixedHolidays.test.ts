import { describe, expect, it } from 'vitest'
import { ensureFixedHolidays } from '../../src/lib/services/holiday.service'
import { proposeFixedHolidayOccurrences } from '../../src/lib/calendar'

/** A tiny stand-in for the database that only counts what is asked of it. */
function fakeDb(existing: Array<{ holiday_type_key: string; source: string; confirmed_at: string | null }>, batchFails = false) {
  const calls: string[] = []
  const client = {
    from: () => ({
      select: () => {
        calls.push('read')
        return { eq: async () => ({ data: existing, error: null }) }
      },
      upsert: (rows: unknown) => {
        const batch = Array.isArray(rows)
        calls.push(batch ? `write-batch:${(rows as unknown[]).length}` : 'write-one')
        return Promise.resolve({ error: batch && batchFails ? { message: 'unknown holiday' } : null })
      },
      update: () => {
        calls.push('confirm')
        return { eq: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }
      },
    }),
  }
  return { client: client as never, calls }
}

const proposals = proposeFixedHolidayOccurrences('y1', 2019)
const complete = proposals.map((p) => ({ holiday_type_key: p.holidayTypeKey, source: 'AUTO_PROPOSED', confirmed_at: '2026-01-01' }))

describe('the permanent-holiday check no longer slows every page', () => {
  it('when nothing is missing it makes exactly one read and no writes', async () => {
    const { client, calls } = fakeDb(complete)
    await ensureFixedHolidays(client, 'y1', 2019, 'u1')
    expect(calls).toEqual(['read'])
  })
  it('adds all missing holidays in one write, then confirms them', async () => {
    const { client, calls } = fakeDb([])
    await ensureFixedHolidays(client, 'y1', 2019, 'u1')
    expect(calls).toEqual(['read', `write-batch:${proposals.length}`, 'confirm'])
  })
  it('confirms leftover unconfirmed rows without re-adding anything', async () => {
    const { client, calls } = fakeDb(complete.map((r, i) => (i === 0 ? { ...r, confirmed_at: null } : r)))
    await ensureFixedHolidays(client, 'y1', 2019, 'u1')
    expect(calls).toEqual(['read', 'confirm'])
  })
  it('if the batch is refused it falls back to one at a time, so the rest still go in', async () => {
    const { client, calls } = fakeDb([], true)
    await ensureFixedHolidays(client, 'y1', 2019, 'u1')
    expect(calls.filter((c) => c === 'write-one')).toHaveLength(proposals.length)
  })
})

describe('when the caller already has the rows', () => {
  it('makes no call at all if nothing is missing, and says nothing changed', async () => {
    const { client, calls } = fakeDb([])
    const changed = await ensureFixedHolidays(client, 'y1', 2019, 'u1', complete)
    expect(calls).toEqual([])
    expect(changed).toBe(false)
  })
  it('reports a change when it had to add something', async () => {
    const { client } = fakeDb([])
    expect(await ensureFixedHolidays(client, 'y1', 2019, 'u1', [])).toBe(true)
  })
})

// @vitest-environment jsdom
/**
 * Screen bugs found by rendering every page in a real browser. Each test pins
 * one of them so it cannot quietly come back.
 * Needs (not saved in package.json):  npm i --no-save jsdom @testing-library/react @testing-library/dom
 * Run:  npx vitest run --config tests-integration/vitest.config.ts tests-integration/ui
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { SetupWizard } from '@/components/calendar/SetupWizard'
import { YearStatusCard } from '@/components/calendar/YearStatusCard'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'
import { fixedHolidaysFor } from '@/lib/calendar'

const Y = 2020
const blankYear: any = { id: 'y', yearEc: Y, name: '2020 E.C.', startDate: E(Y, 1, 5), endDate: E(Y, 10, 30), isDefaultBoundary: true, status: 'PREPARING' }
const blankSems: any = [1, 2].map((order) => ({ id: 's' + order, academicYearId: 'y', order, startDate: null, endDate: null, status: 'UPCOMING' }))
let calls: { url: string; method: string; body: any }[] = []
beforeEach(() => {
  calls = []
  global.fetch = vi.fn(async (u: any, i: any) => {
    calls.push({ url: String(u), method: i?.method, body: i?.body ? JSON.parse(i.body) : null })
    return { json: async () => ({ success: true, data: {} }) } as any
  }) as any
})
afterEach(cleanup)
const mount = () =>
  render(<SetupWizard yearId="y" year={blankYear} semesters={blankSems} holidays={fixedHolidaysFor('y', Y, []) as any} notObserved={[]} exams={[]} studentReturn={null} />)
const dateSelects = () => Array.from(document.querySelectorAll('select[aria-label$="(E.C.)"]')) as HTMLSelectElement[]

describe('setup wizard', () => {
  it('a step starts with empty pickers; values from the previous step must not carry over', async () => {
    mount()
    expect(dateSelects().map((s) => s.value)).toEqual(['1', '5', '10', '30']) // step 1 shows the year dates
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await waitFor(() => expect(document.body.textContent).toMatch(/Step 2 of 6/i))
    expect(dateSelects().map((s) => s.value)).toEqual(['', '', '', '', '', '', '', '']) // semesters are blank, not the year dates
  })

  it('accepting the default school-year dates without changing them still saves (confirms) them', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: '/api/v1/academic-years/y' })
    expect(calls[0].body.startDate).toBe(E(Y, 1, 5))
  })

  it('the Review step shows no tick while nothing has been entered', () => {
    mount()
    const last = document.querySelector('nav[aria-label="Setup steps"] li:last-child') as HTMLElement
    expect(last.querySelector('svg')).toBeNull()
  })
})

describe('year status card', () => {
  it('does not offer "ready" while items are missing, and says why', () => {
    render(<YearStatusCard yearId="y" status="PREPARING" blockers={3} />)
    expect((screen.getByRole('button', { name: /mark calendar as ready/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toMatch(/3 items still need attention/)
  })
  it('offers it once nothing is missing', () => {
    render(<YearStatusCard yearId="y" status="PREPARING" blockers={0} />)
    expect((screen.getByRole('button', { name: /mark calendar as ready/i }) as HTMLButtonElement).disabled).toBe(false)
  })
})

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Panel } from '../ui/panel'
import { Button } from '../ui/button'
import { localizeMessage } from '@/lib/calendar'
import type { AcademicYearStatus } from '@/lib/calendar'

const STEPS: Record<
  Exclude<AcademicYearStatus, 'CLOSED'>,
  { next: 'READY' | 'ACTIVE' | 'CLOSED'; heading: string; body: string; button: string; confirm?: string }
> = {
  PREPARING: {
    next: 'READY',
    heading: 'Still being set up',
    body: 'When every date is entered and nothing needs fixing, mark the calendar as ready. Other parts of K2 can then rely on it.',
    button: 'Mark calendar as ready',
  },
  READY: {
    next: 'ACTIVE',
    heading: 'Ready to use',
    body: 'The calendar is complete. Make it the active year when this school year begins. Only one year can be active at a time.',
    button: 'Make this the active year',
    confirm: 'Make this the active year? Any other active year must be closed first.',
  },
  ACTIVE: {
    next: 'CLOSED',
    heading: 'Active — this is the school year in use',
    body: 'When the year is over you can close it. A closed year is locked, and any later change needs a formal correction.',
    button: 'Close this year',
    confirm: 'Close this year? It will be locked and this cannot be undone.',
  },
}

export function YearStatusCard({ yearId, status, blockers = 0 }: { yearId: string; status: AcademicYearStatus; blockers?: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  if (status === 'CLOSED') {
    return (
      <Panel title="Year status">
        <p className="text-sm text-muted-foreground">This year is closed and locked. Any change now needs a formal correction.</p>
      </Panel>
    )
  }
  const step = STEPS[status]

  async function advance() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/academic-years/${yearId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: step.next }),
      })
      const body = await res.json()
      if (!body.success) {
        const code = body.error?.code
        throw new Error(
          code === 'CALENDAR_YEAR_NOT_READY'
            ? 'Not ready yet. Finish the items listed under Validation below, then try again.'
            : code === 'CALENDAR_SECOND_ACTIVE_YEAR'
              ? 'Another year is already active. Close it first.'
              : localizeMessage(body.error?.message ?? 'Could not change the status.'),
        )
      }
      setConfirming(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the status.')
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Year status">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{step.heading}</p>
          <p className="text-sm text-muted-foreground">{step.body}</p>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-error-text">
            {error}
          </p>
        )}
        {status === 'PREPARING' && blockers > 0 && (
          <p className="text-sm text-muted-foreground">
            {blockers} {blockers === 1 ? 'item still needs' : 'items still need'} attention. They are listed under Validation below. Finish them first, then this button turns on.
          </p>
        )}
        {confirming && step.confirm ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="w-full text-sm text-foreground">{step.confirm}</p>
            <Button type="button" onClick={advance} loading={busy} loadingText="Saving…">
              Yes, continue
            </Button>
            <Button type="button" level="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => (step.confirm ? setConfirming(true) : void advance())}
            loading={busy}
            loadingText="Saving…"
            disabled={status === 'PREPARING' && blockers > 0}
          >
            {step.button}
          </Button>
        )}
      </div>
    </Panel>
  )
}

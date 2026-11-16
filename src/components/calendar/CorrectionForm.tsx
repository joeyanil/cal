'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EthiopianDateField } from './EthiopianDateField'
import { formatEthiopian } from '@/lib/calendar'
import type { ISODate } from '@/lib/calendar'

export interface CorrectableFact {
  id: string
  label: string
  factKind: string
  factSemesterOrder: 1 | 2 | null
  factHolidayTypeKey: string | null
  factExamTypeKey: string | null
  current: ISODate
}

export function CorrectionForm({ yearId, ethiopianYear, facts }: { yearId: string; ethiopianYear: number; facts: CorrectableFact[] }) {
  const router = useRouter()
  const [factId, setFactId] = useState(facts[0]?.id ?? '')
  const [date, setDate] = useState<ISODate | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const fact = facts.find((f) => f.id === factId)

  async function submit() {
    if (!fact) return
    if (!date) return setError('Please enter the new date.')
    if (!window.confirm(`Change "${fact.label}" to ${formatEthiopian(date)}? The date is changed straight away and no record of the old date is kept.`)) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/v1/academic-years/${yearId}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factKind: fact.factKind, factSemesterOrder: fact.factSemesterOrder, factHolidayTypeKey: fact.factHolidayTypeKey,
          factExamTypeKey: fact.factExamTypeKey, correctedValue: date,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Something went wrong.')
      setDone(`Done. "${fact.label}" is now ${formatEthiopian(date)}.`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (facts.length === 0) return <p className="text-sm text-muted-foreground">There are no dates to correct.</p>
  return (
    <div className="space-y-4">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Which date is wrong?
        <select
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          value={factId}
          onChange={(e) => { setFactId(e.target.value); setDone(null) }}
        >
          {facts.map((f) => (
            <option key={f.id} value={f.id}>{f.label}: {formatEthiopian(f.current)}</option>
          ))}
        </select>
      </label>
      <div key={factId}>
        <EthiopianDateField label="The correct date" name="correct" ethiopianYear={ethiopianYear} onValueChange={setDate} />
      </div>
      {error && <p className="text-sm text-error-text">{error}</p>}
      {done && <p className="text-sm text-foreground">{done}</p>}
      <button type="button" disabled={busy} onClick={submit} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {busy ? 'Saving…' : 'Change the date'}
      </button>
    </div>
  )
}

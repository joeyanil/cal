'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '../ui/button'

export function CreateYearForm() {
  const router = useRouter()
  const [yearEc, setYearEc] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingId, setExistingId] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setExistingId(null)
    try {
      const res = await fetch('/api/v1/academic-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearEc: Number(yearEc) }),
      })
      const body = await res.json()
      if (!body.success) {
        setExistingId(body.error.details?.existingYearId ?? null)
        throw new Error(body.error.message)
      }
      router.push(`/calendar/${body.data.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the academic year.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Ethiopian year
        <input
          required
          type="number"
          value={yearEc}
          onChange={(e) => setYearEc(e.target.value)}
          placeholder="2019"
          className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <Button type="submit" loading={busy} loadingText="Creating…">
        Create year
      </Button>
      {error && (
        <span className="w-full text-sm text-error-text">
          {error}{' '}
          {existingId && (
            <Link href={`/calendar/${existingId}/setup`} className="font-medium text-primary underline underline-offset-4">
              Open it and continue setup →
            </Link>
          )}
        </span>
      )}
    </form>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '../ui/button'

export function RebuildTimelineButton({ yearId }: { yearId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setResult(null)
    try {
      const buildRes = await fetch(`/api/v1/academic-years/${yearId}/timeline/build`, { method: 'POST' })
      const buildBody = await buildRes.json()
      if (!buildBody.success) throw new Error(buildBody.error.message)

      const publishRes = await fetch(`/api/v1/academic-years/${yearId}/timeline/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildId: buildBody.data.buildId }),
      })
      const publishBody = await publishRes.json()
      if (!publishBody.success) throw new Error(publishBody.error.message)

      setResult(`Published — ${buildBody.data.entryCount} calendar days, ${buildBody.data.teachingDays} of them learning days.`)
      router.refresh()
    } catch (err) {
      setResult(err instanceof Error ? `Failed: ${err.message}` : 'Failed to rebuild the timeline.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={handleClick} loading={busy} loadingText="Building…" level="secondary">
        Rebuild & publish timeline
      </Button>
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
    </div>
  )
}

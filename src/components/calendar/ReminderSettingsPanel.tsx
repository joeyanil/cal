'use client'

import { useState } from 'react'

interface Group {
  key: string
  label: string
  enabled: boolean
  send30: boolean
  send15: boolean
  send5: boolean
}

export function ReminderSettingsPanel({ initial, canManage }: { initial: Group[]; canManage: boolean }) {
  const [groups, setGroups] = useState<Group[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  async function change(key: string, patch: Partial<Group>) {
    setError(null)
    const before = groups
    setGroups((cur) => cur.map((g) => (g.key === key ? { ...g, ...patch } : g)))
    try {
      const res = await fetch('/api/v1/calendar/reminder-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: [{ key, ...patch }] }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Could not save.')
      setSavedKey(key)
    } catch (e) {
      setGroups(before)
      setError(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.key} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
          <label className="flex items-center gap-2 font-medium text-foreground">
            <input type="checkbox" disabled={!canManage} checked={g.enabled} onChange={(e) => change(g.key, { enabled: e.target.checked })} />
            {g.label}
          </label>
          <div className={`flex gap-4 ${g.enabled ? '' : 'opacity-40'}`}>
            {([['send30', '30 days'], ['send15', '15 days'], ['send5', '5 days']] as const).map(([field, text]) => (
              <label key={field} className="flex items-center gap-1 text-muted-foreground">
                <input type="checkbox" disabled={!canManage || !g.enabled} checked={g[field]} onChange={(e) => change(g.key, { [field]: e.target.checked })} />
                {text}
              </label>
            ))}
          </div>
          {savedKey === g.key && <span className="text-xs text-muted-foreground">Saved</span>}
        </div>
      ))}
      {error && <p className="text-sm text-error-text">{error}</p>}
    </div>
  )
}

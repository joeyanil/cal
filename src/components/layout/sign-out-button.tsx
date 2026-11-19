'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/** Signs the person out and returns to the sign-in page. */
export function SignOutButton({ dark }: { dark: boolean }) {
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    try {
      await createClient().auth.signOut()
    } finally {
      // Full navigation so the server forgets the old cookies at once.
      window.location.href = '/login'
    }
  }
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className={cn(
        'h-10 rounded-md border px-3 text-sm font-medium disabled:opacity-60',
        dark ? 'border-white/25 hover:bg-white/10' : 'border-border hover:bg-muted',
      )}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}

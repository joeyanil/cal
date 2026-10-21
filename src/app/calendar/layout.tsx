import { DashboardShell } from '@/components/layout/dashboard-shell'
import { redirect } from 'next/navigation'
import { withAuth } from '@/lib/auth/withAuth'
import { AppError } from '@/lib/errors/AppError'
export const dynamic = 'force-dynamic'

const groups = [
  {
    // "Academic Years" is the entire real nav surface of this subsystem
    // today — no other Calendar Engine top-level destination exists.
    // Not padded out with placeholder items for modules this merge didn't
    // touch (Students, Teachers, etc. — those belong to K2 Main Admin's
    // real nav, doc 08 §5, which this subsystem doesn't own or reproduce).
    //
    // `icon` is a string key (resolved against the ICONS map in
    // sidebar.tsx), not the icon component itself — this is a Server
    // Component, and a component/function reference can't be passed
    // across the server->client boundary into <Sidebar>, a Client
    // Component. Passing the component directly here was the cause of
    // the "Functions cannot be passed directly to Client Components"
    // crash on /calendar.
    items: [{ label: 'Academic Years', icon: 'CalendarDays' as const, href: '/calendar' }],
  },
]

export default async function CalendarLayout({ children }: { children: React.ReactNode }) {
  // withAuth() is cache()-wrapped (lib/auth/withAuth.ts), so this and the
  // page's own withAuth() call below it share one query per request, not
  // two. If it fails here, skip the shell rather than show a "Welcome,
  // undefined" topbar next to a real error — the page underneath makes
  // its own withAuth() call and renders ErrorState with the real reason.
  try {
    const ctx = await withAuth()
    const userLabel = (ctx.user.email ? ctx.user.email.split('@')[0] : undefined) ?? ctx.user.user_type
    return (
      <DashboardShell title="K2 Calendar" userLabel={userLabel} userSubLabel={ctx.user.user_type} groups={groups} chrome="dark">
        {children}
      </DashboardShell>
    )
} catch (error) {
    // Not signed in (or the session ran out): send them to sign in rather
    // than showing a technical error code.
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') redirect('/login')
    console.error('[CalendarLayout] withAuth() failed:', error)
    return <div className="min-h-screen bg-background px-8 py-6">{children}</div>
  }
}

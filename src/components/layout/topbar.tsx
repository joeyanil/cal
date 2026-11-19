import { cn } from '@/lib/utils'
import { SignOutButton } from './sign-out-button'

/**
 * The top bar of the stand-alone calendar engine: the app name on the left,
 * who is signed in and a Sign out button on the right. (The search box and
 * notification bell of the full K2 platform shell are not shown here because
 * nothing behind them exists in this stand-alone engine.)
 */
export function Topbar({
  userLabel,
  userSubLabel,
  chrome = 'surface',
}: {
  userLabel: string
  userSubLabel?: string
  chrome?: 'dark' | 'surface'
}) {
  const dark = chrome === 'dark'
  return (
    <header
      className={cn(
        'flex h-16 items-center justify-between gap-4 border-b border-border px-4 lg:px-6',
        dark ? 'bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-fg))] border-transparent' : 'bg-card',
      )}
    >
      <p className="text-base font-semibold">K2 Academic Calendar</p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {userLabel.slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden flex-col sm:flex">
            <span>{userLabel}</span>
            {userSubLabel && <span className="text-xs font-normal opacity-70">{userSubLabel}</span>}
          </span>
        </div>
        <SignOutButton dark={dark} />
      </div>
    </header>
  )
}

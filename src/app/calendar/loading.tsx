/** Shown the instant a link is tapped, while the next screen is prepared. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm font-medium text-muted-foreground">Loading…</p>
      <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-1/2 animate-pulse rounded-md bg-muted" />
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-24 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}

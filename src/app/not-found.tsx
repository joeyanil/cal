import Link from 'next/link'

export const metadata = { title: 'Page not found — K2 Calendar' }

/** Shown when a web address does not lead anywhere. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold text-foreground">This page does not exist</h1>
      <p className="text-sm text-muted-foreground">
        The address may be mistyped, or the page may have been removed.
      </p>
      <Link href="/calendar" className="text-sm font-medium text-primary underline underline-offset-4">
        Go to the academic years
      </Link>
    </main>
  )
}

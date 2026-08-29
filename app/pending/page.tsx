import Link from 'next/link'
import { requirePending } from '@/lib/auth-redirect'

export const dynamic = 'force-dynamic'

export default async function PendingPage() {
  await requirePending()
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Frameflow access review</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Your account is pending approval</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">An administrator needs to assign your account the Player role before you can access the game workspace.</p>
        <Link href="/auth/login" className="mt-7 inline-flex h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold transition hover:bg-muted">Return to sign in</Link>
      </section>
    </main>
  )
}

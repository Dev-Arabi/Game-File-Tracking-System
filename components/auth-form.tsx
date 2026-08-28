'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setMessage('')

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedDisplayName = displayName.trim()

    try {
      const supabase = createClient()
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo:
              process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ??
              `${window.location.origin}/auth/callback`,
            data: { display_name: normalizedDisplayName },
          },
        })

        if (error) {
          const code = error.code ?? ''
          const text = error.message.toLowerCase()
          if (code === 'email_exists' || text.includes('already registered') || text.includes('already been registered')) {
            setMessage('This email already has an account. Sign in or use a different email.')
          } else if (code === 'over_email_send_rate_limit' || text.includes('rate limit')) {
            setMessage('Supabase has temporarily limited signup emails from this project. Please wait about an hour, then try again. If you already signed up with this email, use Sign in instead.')
          } else if (text.includes('password')) {
            setMessage('Choose a stronger password with at least 6 characters.')
          } else {
            setMessage('We could not create the account. Please check your details and try again.')
          }
          return
        }

        if (!data.session) setMessage('Check your email to confirm your account. New accounts start as players.')
        else router.push('/player')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        if (error) {
          setMessage(error.message.toLowerCase().includes('confirm') ? 'Please confirm your email before signing in.' : 'Invalid email or password.')
          return
        }
        const { data: profile } = await supabase.from('profiles').select('role').single()
        router.push(profile?.role === 'admin' ? '/admin' : '/player')
        router.refresh()
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : ''
      setMessage(text.includes('Missing NEXT_PUBLIC') ? 'Supabase is not configured yet.' : 'We could not connect to Supabase. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const signup = mode === 'signup'
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Frameflow</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{signup ? 'Create your player account' : 'Welcome back'}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{signup ? 'Join the production workspace. Admin access is granted separately.' : 'Sign in to continue to your workspace.'}</p>
        <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
          {signup && <label className="flex flex-col gap-2 text-sm font-medium">Display name<input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3.5 outline-none focus:border-primary" /></label>}
          <label className="flex flex-col gap-2 text-sm font-medium">Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3.5 outline-none focus:border-primary" /></label>
          <label className="flex flex-col gap-2 text-sm font-medium">Password<input required minLength={6} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3.5 outline-none focus:border-primary" /></label>
          {message && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 text-sm leading-6">{message}</p>}
          <button disabled={pending} className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">{signup ? 'Already have an account? ' : 'Need an account? '}<Link className="font-semibold text-primary hover:underline" href={signup ? '/auth/login' : '/auth/sign-up'}>{signup ? 'Sign in' : 'Sign up'}</Link></p>
      </section>
    </main>
  )
}

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function requireRole(role: 'admin' | 'player') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const actualRole = profile?.role === 'admin' ? 'admin' : 'player'
  if (actualRole !== role) redirect(actualRole === 'admin' ? '/admin' : '/player')
  return { user, profile }
}

export async function redirectAuthenticated() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    redirect(profile?.role === 'admin' ? '/admin' : '/player')
  } catch (error) {
    // Keep the public entry route renderable while Supabase environment variables are unavailable.
    if (error instanceof Error && error.message.startsWith('Missing NEXT_PUBLIC_SUPABASE')) return
    throw error
  }
}

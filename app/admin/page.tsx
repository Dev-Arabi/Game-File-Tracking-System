import GameWorkspace from '@/components/game-workspace'
import { requireRole } from '@/lib/auth-redirect'

export default async function AdminPage() {
  await requireRole('admin')
  return <GameWorkspace initialView="admin" role="admin" />
}

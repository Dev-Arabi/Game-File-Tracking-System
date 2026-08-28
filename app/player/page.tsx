import GameWorkspace from '@/components/game-workspace'
import { requireRole } from '@/lib/auth-redirect'

export default async function PlayerPage() {
  await requireRole('player')
  return <GameWorkspace initialView="player" role="player" />
}

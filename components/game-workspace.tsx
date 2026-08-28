'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import {
  Archive,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  FilePlus2,
  Flag,
  Gamepad2,
  LayoutDashboard,
  FileBarChart,
  Gavel,
  LogIn,
  UserCircle,
  Menu,
  Plus,
  Pencil,
  Search,
  Trash2,
  ShieldCheck,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
type Game = { id: string; name: string; total_hours: number }
type Player = { id: string; display_name: string }
type Tier = 'Tier 1' | 'Tier 2' | 'Tier 3'
type Assignment = { id: string; game_id: string; player_id: string; hours_text: string; tier: Tier | null; created_at: string; assigned_at: string }
type AdminFile = { id: string; game_id: string; player_id: string; tier: Tier | null; file_name: string; duration: string | null; upload_status: string | null; is_flagged: boolean }
type Penalty = { id: string; player_id: string; file_update_id: string; reason: string; source: 'manual' | 'auto'; created_at: string }

const PENALTY_REASONS = ['Late submission', 'Incorrect file', 'Missing submission', 'Quality issue'] as const

const players: Player[] = []

function parseDuration(value: string | null | undefined) {
  if (!value) return null
  const match = value.trim().match(/^(\d+):(\d{2})$/)
  if (!match) return null
  const minutes = Number(match[1])
  const seconds = Number(match[2])
  if (!Number.isSafeInteger(minutes) || seconds > 59) return null
  return minutes * 60 + seconds
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatAdminDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatBothDurations(totalSeconds: number) {
  return `${formatDuration(totalSeconds)} (${formatAdminDuration(totalSeconds)})`
}

type StatusSummary = {
  notStarted: number
  inProgress: number
  uploaded: number
}

function parseAssignedHours(value: string) {
  const numeric = Number.parseFloat(value.replace(/[^\d.]/g, ''))
  return Number.isFinite(numeric) ? numeric * 3600 : 0
}

type AssignmentGroup = {
  primary: Assignment
  extras: Assignment[]
}

function groupAssignments(items: Assignment[]) {
  const groups = new Map<string, AssignmentGroup>()
  const chronologicallyOrdered = [...items].sort((a, b) => {
    const assignedAtDifference = new Date(a.assigned_at || a.created_at).getTime() - new Date(b.assigned_at || b.created_at).getTime()
    return assignedAtDifference || new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  chronologicallyOrdered.forEach((item) => {
    const key = `${item.game_id}:${item.player_id}:${item.tier ?? 'none'}`
    const existing = groups.get(key)
    if (existing) existing.extras.push(item)
    else groups.set(key, { primary: item, extras: [] })
  })
  return Array.from(groups.values())
}


// Single source of truth for status color semantics across the app.
// "Not started" reads as neutral (not an alarm), "In progress" as active/warm,
// "Uploaded" as complete — instead of a literal red/orange/green stoplight.
const STATUS_META: Record<string, { label: string; dot: string; text: string; chipBg: string; chipText: string; barBg: string }> = {
  'Not started': {
    label: 'Not started',
    dot: 'bg-slate-400',
    text: 'text-slate-600 dark:text-slate-400',
    chipBg: 'bg-slate-400/10 ring-1 ring-inset ring-slate-400/20',
    chipText: 'text-slate-600 dark:text-slate-300',
    barBg: 'bg-slate-400',
  },
  'In progress': {
    label: 'In progress',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    chipBg: 'bg-amber-500/10 ring-1 ring-inset ring-amber-500/20',
    chipText: 'text-amber-700 dark:text-amber-400',
    barBg: 'bg-amber-500',
  },
  Uploaded: {
    label: 'Uploaded',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    chipBg: 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/20',
    chipText: 'text-emerald-700 dark:text-emerald-400',
    barBg: 'bg-emerald-500',
  },
}
const STATUS_ORDER = ['Not started', 'In progress', 'Uploaded'] as const
function statusMeta(status: string | null | undefined) {
  return STATUS_META[status ?? ''] ?? { label: status ?? 'Unknown status', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', chipBg: 'bg-muted', chipText: 'text-muted-foreground', barBg: 'bg-muted-foreground/40' }
}

// Tiers are a real ranking, so gold / silver / bronze carries information rather than decorating.
const TIER_META: Record<Tier, { chipBg: string; chipText: string; ring: string; dot: string }> = {
  'Tier 1': { chipBg: 'bg-amber-500/10', chipText: 'text-amber-700 dark:text-amber-400', ring: 'ring-1 ring-inset ring-amber-500/25', dot: 'bg-amber-500' },
  'Tier 2': { chipBg: 'bg-slate-400/10', chipText: 'text-slate-600 dark:text-slate-300', ring: 'ring-1 ring-inset ring-slate-400/25', dot: 'bg-slate-400' },
  'Tier 3': { chipBg: 'bg-orange-700/10', chipText: 'text-orange-700 dark:text-orange-400', ring: 'ring-1 ring-inset ring-orange-700/25', dot: 'bg-orange-700' },
}
function TierBadge({ tier }: { tier: Tier }) {
  const meta = TIER_META[tier]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chipBg} ${meta.chipText} ${meta.ring}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.dot}`} />
      {tier}
    </span>
  )
}

function EmptyState({ icon: Icon, title, description }: { icon: typeof Archive; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
      {label}
      {children}
    </label>
  )
}

function AdminPanel({ autoPenaltyEnabled, onToggleAutoPenalty }: { autoPenaltyEnabled: boolean; onToggleAutoPenalty: () => void }) {
  const isAdmin = true
  const [notice, setNotice] = useState('')
  const [playerSearch, setPlayerSearch] = useState('')
  const [gameSearch, setGameSearch] = useState('')
  const [games, setGames] = useState<Game[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<AdminFile[]>([])
  const [penalties, setPenalties] = useState<Penalty[]>([])
  const [isApplyingPenalty, setIsApplyingPenalty] = useState<string | null>(null)
  const [pendingPenaltyFileId, setPendingPenaltyFileId] = useState<string | null>(null)
  const [pendingPenaltyReason, setPendingPenaltyReason] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isDeletingGame, setIsDeletingGame] = useState<string | null>(null)
  const [editingGameId, setEditingGameId] = useState<string | null>(null)
  const [editingGameHours, setEditingGameHours] = useState('')
  const [isSavingGame, setIsSavingGame] = useState<string | null>(null)
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null)
  const [editingHours, setEditingHours] = useState('')
  const [editingTier, setEditingTier] = useState<Tier | ''>('')
  const [editingExtraId, setEditingExtraId] = useState<string | null>(null)
  const [editingExtraHours, setEditingExtraHours] = useState('')
  const [isSavingAssignment, setIsSavingAssignment] = useState<string | null>(null)
  const [isRemovingExtra, setIsRemovingExtra] = useState<string | null>(null)
  const [isRemovingAssignment, setIsRemovingAssignment] = useState<string | null>(null)
  const [selectedFilePlayer, setSelectedFilePlayer] = useState<string | null>(null)
  const [copiedFileId, setCopiedFileId] = useState<string | null>(null)
  const [activeAdminSection, setActiveAdminSection] = useState<'games' | 'players' | 'assignments' | 'reports'>('games')
  const [reportType, setReportType] = useState<'player' | 'full'>('player')
  const [tierRates, setTierRates] = useState<Record<Tier, string>>({ 'Tier 1': '', 'Tier 2': '', 'Tier 3': '' })
  const [paymentReport, setPaymentReport] = useState<{ player: Player; uploadedTotals: Record<Tier, number>; flaggedTotals: Record<Tier, number>; tierTotals: Record<Tier, number>; totalUploadedHours: number; totalFlaggedHours: number; totalHours: number; totalPay: number }[]>([])
  const [paymentReportTotal, setPaymentReportTotal] = useState(0)
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false)

  function startEditingAssignment(assignment: Assignment) {
    setEditingAssignmentId(assignment.id)
    setEditingHours(assignment.hours_text)
    setEditingTier(assignment.tier ?? '')
  }

  function cancelEditingAssignment() {
    setEditingAssignmentId(null)
    setEditingHours('')
    setEditingTier('')
  }

  function toggleFilePanel(key: string) {
    setSelectedFilePlayer((current) => (current === key ? null : key))
  }

  async function saveAssignmentHours(assignmentId: string) {
    const hours = editingHours.trim()
    if (!hours) {
      setNotice('Enter the assigned hours before saving.')
      return
    }
    if (editingTier && !['Tier 1', 'Tier 2', 'Tier 3'].includes(editingTier)) {
      setNotice('Choose a valid tier before saving.')
      return
    }

    setIsSavingAssignment(assignmentId)
    try {
      const { error } = await createClient()
        .from('player_hours')
        .update({ hours_text: hours, tier: editingTier || null })
        .eq('id', assignmentId)

      if (error) {
        console.error(' Failed to update assignment hours:', error)
        setNotice(`Unable to update assigned hours: ${error.message}`)
        return
      }

      setAssignments((current) => current.map((item) => item.id === assignmentId ? { ...item, hours_text: hours, tier: editingTier || null } : item))
      cancelEditingAssignment()
      setNotice('Assigned hours updated successfully.')
    } finally {
      setIsSavingAssignment(null)
    }
  }

  function startEditingExtra(assignment: Assignment) {
    setEditingExtraId(assignment.id)
    setEditingExtraHours(assignment.hours_text)
  }

  function cancelEditingExtra() {
    setEditingExtraId(null)
    setEditingExtraHours('')
  }

  async function saveExtraHours(assignmentId: string) {
    const hours = editingExtraHours.trim()
    if (!hours || !Number.isFinite(Number.parseFloat(hours.replace(/[^\d.]/g, '')))) {
      setNotice('Enter a valid number of extra hours before saving.')
      return
    }

    setIsSavingAssignment(assignmentId)
    try {
      const { error } = await createClient().from('player_hours').update({ hours_text: hours }).eq('id', assignmentId)
      if (error) {
        console.error(' Failed to update extra assignment hours:', error)
        setNotice(`Unable to update extra hours: ${error.message}`)
        return
      }

      setAssignments((current) => current.map((item) => item.id === assignmentId ? { ...item, hours_text: hours } : item))
      cancelEditingExtra()
      setNotice('Extra hours updated successfully.')
    } finally {
      setIsSavingAssignment(null)
    }
  }

  async function removeExtraAssignment(assignment: Assignment) {
    if (isRemovingExtra || !window.confirm(`Are you sure you want to delete this Extra Hour assignment?`)) return

    setIsRemovingExtra(assignment.id)
    try {
      const { error } = await createClient().from('player_hours').delete().eq('id', assignment.id)
      if (error) {
        console.error(' Failed to delete extra assignment:', error)
        setNotice(`Unable to delete extra hours: ${error.message}`)
        return
      }

      setAssignments((current) => current.filter((item) => item.id !== assignment.id))
      if (editingExtraId === assignment.id) cancelEditingExtra()
      setNotice('Extra hours deleted successfully.')
    } finally {
      setIsRemovingExtra(null)
    }
  }

  async function removeAssignment(assignment: Assignment) {
    if (isRemovingAssignment || !window.confirm(`Remove assigned hours for ${playerNames.get(assignment.player_id) ?? 'this player'}? They will no longer see this game on their submission form.`)) return

    setIsRemovingAssignment(assignment.id)
    try {
      const { error } = await createClient().from('player_hours').delete().eq('id', assignment.id)
      if (error) {
        console.error(' Failed to remove player assignment:', error)
        setNotice(`Unable to remove assigned hours: ${error.message}`)
        return
      }

      setAssignments((current) => current.filter((item) => item.id !== assignment.id))
      if (editingAssignmentId === assignment.id) cancelEditingAssignment()
      setNotice('Assigned hours removed. The player will no longer see this game.')
    } finally {
      setIsRemovingAssignment(null)
    }
  }

  async function loadAssignments() {
    const supabase = createClient()
    const { data, error } = await supabase.from('player_hours').select('id, game_id, player_id, hours_text, tier, created_at, assigned_at').order('created_at', { ascending: false })
    if (error) setNotice('Unable to load assignments from Supabase.')
    setAssignments((data ?? []) as Assignment[])
  }

  useEffect(() => {
    let active = true
    async function loadAdminData() {
      const supabase = createClient()
      const [{ data: gameData, error: gameError }, { data: playerData, error: playerError }, { data: fileData, error: fileError }, { data: penaltyData, error: penaltyError }] = await Promise.all([
        supabase.from('games').select('id, name, total_hours').order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, display_name').eq('role', 'player').order('display_name'),
        supabase.from('file_updates').select('id, game_id, player_id, tier, file_name, duration, upload_status, is_flagged'),
        supabase.from('penalties').select('id, player_id, file_update_id, reason, source, created_at').order('created_at', { ascending: false }),
      ])
      if (!active) return
      if (gameError || playerError || fileError || penaltyError) setNotice('Unable to load games, players, files, or penalties from Supabase.')
      setGames(gameData ?? [])
      setPlayers(playerData ?? [])
      setUploadedFiles((fileData ?? []) as AdminFile[])
      setPenalties((penaltyData ?? []) as Penalty[])
      await loadAssignments()
      if (active) setIsLoading(false)
    }
    void loadAdminData()
    return () => { active = false }
  }, [])

  async function handleCreateGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('gameName') ?? '').trim()
    const totalHours = Number(form.get('totalGameHours') ?? '')
    if (!name || !Number.isFinite(totalHours) || totalHours < 0) {
      setNotice('Enter a game name and a valid total game hour value.')
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setNotice('Your session has expired. Please sign in again.'); return }
    const { data, error } = await supabase.from('games').insert({ name, total_hours: totalHours, created_by: user.id }).select('id, name, total_hours').single()
    if (error) { setNotice('Unable to add this game.'); return }
    setGames((current) => [data, ...current])
    formElement.reset()
    setNotice(`Game "${name}" added successfully.`)
  }

  async function saveGameHours(game: Game) {
    const totalHours = Number(editingGameHours)
    if (!Number.isFinite(totalHours) || totalHours < 0) {
      setNotice('Enter a valid total game hour value.')
      return
    }

    setIsSavingGame(game.id)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setNotice('Your session has expired. Please sign in again.')
        return
      }

      const { data, error } = await supabase
        .from('games')
        .update({ total_hours: totalHours })
        .eq('id', game.id)
        .select('id, name, total_hours')
        .maybeSingle()

      if (error || !data) {
        const details = error ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : 'No game row was updated. Check that the total_hours migration and admin RLS policy are applied.'
        console.error(' Failed to update game hours:', details)
        setNotice(error?.message ?? 'Unable to update game hours. Apply the total game hours migration and confirm your admin access.')
        return
      }

      setGames((current) => current.map((item) => item.id === game.id ? data : item))
      setEditingGameId(null)
      setEditingGameHours('')
      setNotice(`Total hours for "${game.name}" updated.`)
    } finally {
      setIsSavingGame(null)
    }
  }

  function startEditingGame(game: Game) {
    setEditingGameId(game.id)
    setEditingGameHours(String(game.total_hours))
  }

  function cancelEditingGame() {
    setEditingGameId(null)
    setEditingGameHours('')
  }

  async function handleDeleteGame(game: Game) {
    if (isDeletingGame || !window.confirm(`Remove "${game.name}"? Existing assignments for this game will also be removed.`)) return

    setIsDeletingGame(game.id)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('games').delete().eq('id', game.id)
      if (error) {
        console.error(' Failed to remove game:', error)
        setNotice(`Unable to remove this game: ${error.message}`)
        return
      }

      setGames((current) => current.filter((item) => item.id !== game.id))
      setAssignments((current) => current.filter((item) => item.game_id !== game.id))
      setSelectedGameId((current) => current === game.id ? null : current)
      setNotice(`Game "${game.name}" removed.`)
    } finally {
      setIsDeletingGame(null)
    }
  }

  async function handleAssignHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const playerId = String(form.get('player') ?? '')
    const gameId = String(form.get('game') ?? '')
    const hours = String(form.get('hours') ?? '').trim()
    const tierValue = String(form.get('tier') ?? '')
    const tier = ['Tier 1', 'Tier 2', 'Tier 3'].includes(tierValue) ? tierValue as Tier : null
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !playerId || !gameId || !hours) { setNotice('Select a game and player, then enter the hours.'); return }
    const { error } = await supabase.from('player_hours').insert({ player_id: playerId, game_id: gameId, hours_text: hours, tier, created_by: user.id })
    if (error) {
      setNotice('Unable to assign hours.')
      return
    }
    formElement.reset()
    await loadAssignments()
    setNotice('Player hours assigned successfully.')
  }

  const gameNames = useMemo(() => new Map(games.map((game) => [game.id, game.name])), [games])
  const playerNames = useMemo(() => new Map(players.map((player) => [player.id, player.display_name])), [players])
  const matchingPlayers = players.filter((player) => player.display_name.toLowerCase().includes(playerSearch.trim().toLowerCase()))
  const matchingAssignments = assignments.filter((assignment) => {
    const gameName = gameNames.get(assignment.game_id) ?? ''
    return gameName.toLowerCase().includes(gameSearch.trim().toLowerCase())
  })
  const reportRows = useMemo(() => {
    type ReportTier = Tier | 'Unassigned'
    type ReportFile = { name: string; duration: number; game: string }
    type TierReport = { tier: ReportTier; duration: number; game: string; files: ReportFile[] }
    const tiersByPlayer = new Map<string, Map<ReportTier, TierReport>>()

    uploadedFiles.forEach((file) => {
      if (file.upload_status !== 'Uploaded' || file.is_flagged) return
      const duration = parseDuration(file.duration)
      if (duration === null) return
      const tier = file.tier ?? 'Unassigned'
      const playerTiers = tiersByPlayer.get(file.player_id) ?? new Map<ReportTier, TierReport>()
      const existing = playerTiers.get(tier) ?? { tier, duration: 0, game: gameNames.get(file.game_id) ?? 'Unknown game', files: [] }
      existing.duration += duration
      existing.files.push({ name: file.file_name, duration, game: gameNames.get(file.game_id) ?? 'Unknown game' })
      playerTiers.set(tier, existing)
      tiersByPlayer.set(file.player_id, playerTiers)
    })

    const tierOrder: ReportTier[] = ['Tier 1', 'Tier 2', 'Tier 3', 'Unassigned']
    const totals = new Map<string, number>()
    tiersByPlayer.forEach((tiers, playerId) => totals.set(playerId, Array.from(tiers.values()).reduce((total, tier) => total + tier.duration, 0)))
    const sortedPlayers = [...players].sort((a, b) => {
      const difference = (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0)
      return difference || a.display_name.localeCompare(b.display_name)
    })
    return sortedPlayers.filter((player) => (totals.get(player.id) ?? 0) > 0).map((player) => {
      const tiers = Array.from(tiersByPlayer.get(player.id)?.values() ?? []).sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier))
      return { player, total: totals.get(player.id) ?? 0, tiers }
    })
  }, [gameNames, players, uploadedFiles])
  const selectedPlayerAssignments = playerSearch.trim() && matchingPlayers.length === 1
    ? assignments.filter((assignment) => assignment.player_id === matchingPlayers[0].id)
    : []
  function generatePaymentReport(format: 'pdf' | 'excel' | 'both' = 'pdf') {
    const rates = Object.fromEntries((['Tier 1', 'Tier 2', 'Tier 3'] as Tier[]).map((tier) => [tier, Number(tierRates[tier])])) as Record<Tier, number>
    if ((Object.values(rates) as number[]).some((rate) => !Number.isFinite(rate) || rate < 0)) {
      setNotice('Enter a valid non-negative BDT rate for every tier before generating payments.')
      return
    }

    const rows = players.map((player) => {
      const uploadedTotals = { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0 } as Record<Tier, number>
      const flaggedTotals = { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0 } as Record<Tier, number>
      uploadedFiles.forEach((file) => {
        if (file.player_id !== player.id || file.upload_status !== 'Uploaded' || !file.tier) return
        const hours = (parseDuration(file.duration) ?? 0) / 3600
        if (file.is_flagged) flaggedTotals[file.tier] += hours
        else uploadedTotals[file.tier] += hours
      })
      const tierTotals = (['Tier 1', 'Tier 2', 'Tier 3'] as Tier[]).reduce((totals, tier) => {
        totals[tier] = uploadedTotals[tier] - flaggedTotals[tier]
        return totals
      }, { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0 } as Record<Tier, number>)
      const totalUploadedHours = Object.values(uploadedTotals).reduce((sum, hours) => sum + hours, 0)
      const totalFlaggedHours = Object.values(flaggedTotals).reduce((sum, hours) => sum + hours, 0)
      const totalHours = Object.values(tierTotals).reduce((sum, hours) => sum + hours, 0)
      const totalPay = (['Tier 1', 'Tier 2', 'Tier 3'] as Tier[]).reduce((sum, tier) => sum + tierTotals[tier] * rates[tier], 0)
      return { player, uploadedTotals, flaggedTotals, tierTotals, totalUploadedHours, totalFlaggedHours, totalHours, totalPay }
    }).filter((row) => row.totalUploadedHours + row.totalFlaggedHours > 0)

    if (rows.length === 0) {
      setNotice('No finalized Uploaded hours are available to generate payments.')
      return
    }

    const overallTotal = rows.reduce((sum, row) => sum + row.totalPay, 0)
    setPaymentReport(rows)
    setPaymentReportTotal(overallTotal)

    const exportExcel = () => {
      const sheetRows = rows.map((row) => ({
        Player: row.player.display_name,
        'Tier 1 Uploaded Hours': Number(row.uploadedTotals['Tier 1'].toFixed(2)),
        'Tier 1 Flagged Hours': Number(row.flaggedTotals['Tier 1'].toFixed(2)),
        'Tier 1 Payable Hours': Number(row.tierTotals['Tier 1'].toFixed(2)),
        'Tier 1 Rate (BDT/hr)': rates['Tier 1'],
        'Tier 1 Payment (BDT)': Number((row.tierTotals['Tier 1'] * rates['Tier 1']).toFixed(2)),
        'Tier 2 Uploaded Hours': Number(row.uploadedTotals['Tier 2'].toFixed(2)),
        'Tier 2 Flagged Hours': Number(row.flaggedTotals['Tier 2'].toFixed(2)),
        'Tier 2 Payable Hours': Number(row.tierTotals['Tier 2'].toFixed(2)),
        'Tier 2 Rate (BDT/hr)': rates['Tier 2'],
        'Tier 2 Payment (BDT)': Number((row.tierTotals['Tier 2'] * rates['Tier 2']).toFixed(2)),
        'Tier 3 Uploaded Hours': Number(row.uploadedTotals['Tier 3'].toFixed(2)),
        'Tier 3 Flagged Hours': Number(row.flaggedTotals['Tier 3'].toFixed(2)),
        'Tier 3 Payable Hours': Number(row.tierTotals['Tier 3'].toFixed(2)),
        'Tier 3 Rate (BDT/hr)': rates['Tier 3'],
        'Tier 3 Payment (BDT)': Number((row.tierTotals['Tier 3'] * rates['Tier 3']).toFixed(2)),
        'Total Uploaded Hours': Number(row.totalUploadedHours.toFixed(2)),
        'Total Flagged Hours': Number(row.totalFlaggedHours.toFixed(2)),
        'Total Payable Hours': Number(row.totalHours.toFixed(2)),
        'Total Payment (BDT)': Number(row.totalPay.toFixed(2)),
      }))
      sheetRows.push({ Player: 'OVERALL TOTAL', 'Total Payment (BDT)': Number(overallTotal.toFixed(2)) } as (typeof sheetRows)[number])
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.json_to_sheet(sheetRows)
      worksheet['!cols'] = Object.keys(sheetRows[0]).map((key) => ({ wch: Math.min(Math.max(key.length + 2, 16), 28) }))
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Payment Report')
      XLSX.writeFile(workbook, `player-payment-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    if (format === 'excel' || format === 'both') exportExcel()
    if (format === 'excel') {
      setIsExportMenuOpen(false)
      setNotice('Payment report generated and downloaded as Excel.')
      return
    }

    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 40
    const contentWidth = pageWidth - margin * 2
    const tiers: Tier[] = ['Tier 1', 'Tier 2', 'Tier 3']
    const colors: Record<Tier, [number, number, number]> = {
      'Tier 1': [30, 64, 175],
      'Tier 2': [15, 118, 110],
      'Tier 3': [180, 83, 9],
    }
    const ink: [number, number, number] = [30, 41, 59]
    const muted: [number, number, number] = [100, 116, 139]
    const line: [number, number, number] = [226, 232, 240]

    function drawHeader(isFirstPage = false) {
      doc.setFillColor(15, 23, 42)
      doc.rect(0, 0, pageWidth, 72, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(isFirstPage ? 19 : 13)
      doc.text('PLAYER PAYMENT REPORT', margin, 31)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(148, 163, 184)
      doc.text(isFirstPage ? `Generated ${new Date().toLocaleString()}` : 'Payment report · continued', margin, 51)
      doc.setFillColor(45, 212, 191)
      doc.rect(margin, 64, 42, 3, 'F')
    }

    function startNewPage() {
      doc.addPage()
      drawHeader()
      return 98
    }

    drawHeader(true)
    let y = 98
    doc.setTextColor(...ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('HOURLY RATES', margin, y)
    y += 13
    tiers.forEach((tier) => {
      const [r, g, b] = colors[tier]
      doc.setFillColor(r, g, b)
      doc.circle(margin + 3, y - 3, 3, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...muted)
      doc.text(`${tier}  ${rates[tier].toFixed(2)} BDT / hour`, margin + 12, y)
      y += 13
    })
    y += 12

    rows.forEach((row) => {
      const cardHeight = 194
      if (y + cardHeight > pageHeight - 48) y = startNewPage()
      doc.setFillColor(248, 250, 252)
      doc.setDrawColor(...line)
      doc.roundedRect(margin, y, contentWidth, cardHeight, 7, 7, 'FD')
      doc.setFillColor(45, 212, 191)
      doc.roundedRect(margin, y, 4, cardHeight, 2, 2, 'F')
      doc.setTextColor(...ink)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text(row.player.display_name, margin + 17, y + 23)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...muted)
      doc.text(`Uploaded ${row.totalUploadedHours.toFixed(2)} hrs`, margin + 17, y + 40)
      doc.text(`Flagged ${row.totalFlaggedHours.toFixed(2)} hrs`, margin + 118, y + 40)
      doc.text(`Payable ${row.totalHours.toFixed(2)} hrs`, margin + 214, y + 40)
      doc.setDrawColor(...line)
      doc.line(margin + 17, y + 50, margin + contentWidth - 15, y + 50)

      const colWidth = (contentWidth - 34) / 3
      tiers.forEach((tier, index) => {
        const x = margin + 17 + index * colWidth
        const [r, g, b] = colors[tier]
        doc.setFillColor(255, 255, 255)
        doc.setDrawColor(...line)
        doc.roundedRect(x, y + 62, colWidth - 9, 83, 5, 5, 'FD')
        doc.setFillColor(r, g, b)
        doc.roundedRect(x, y + 62, colWidth - 9, 21, 5, 5, 'F')
        doc.rect(x, y + 74, colWidth - 9, 9, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.text(tier.toUpperCase(), x + 9, y + 76)
        doc.setTextColor(...muted)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.text(`Uploaded  ${row.uploadedTotals[tier].toFixed(2)} hrs`, x + 9, y + 97)
        doc.setTextColor(190, 83, 9)
        doc.text(`Flagged   ${row.flaggedTotals[tier].toFixed(2)} hrs`, x + 9, y + 110)
        doc.setTextColor(...ink)
        doc.text(`Payable   ${row.tierTotals[tier].toFixed(2)} hrs`, x + 9, y + 123)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.text(`${(row.tierTotals[tier] * rates[tier]).toFixed(2)} BDT`, x + 9, y + 138)
      })
      doc.setFillColor(15, 23, 42)
      doc.roundedRect(margin + 17, y + 153, contentWidth - 34, 27, 5, 5, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text(`${row.player.display_name} — TOTAL PAYMENT`, margin + 29, y + 170)
      doc.setTextColor(45, 212, 191)
      doc.setFontSize(11)
      doc.text(`${row.totalPay.toFixed(2)} BDT`, margin + contentWidth - 105, y + 170)
      y += cardHeight + 13
    })

    if (y + 58 > pageHeight - 48) y = startNewPage()
    doc.setFillColor(226, 232, 240)
    doc.setDrawColor(...line)
    doc.roundedRect(margin, y, contentWidth, 44, 7, 7, 'FD')
    doc.setTextColor(...ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('REPORT SUMMARY · ALL PLAYERS', margin + 16, y + 18)
    doc.setTextColor(...muted)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('Combined payable amount', margin + 16, y + 32)
    doc.setTextColor(...ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(`${overallTotal.toFixed(2)} BDT`, margin + contentWidth - 105, y + 28)
    doc.save(`player-payment-report-${new Date().toISOString().slice(0, 10)}.pdf`)
    setNotice('Payment report generated and downloaded.')
  }

  async function copyFileSummary(file: AdminFile) {
    const duration = parseDuration(file.duration)
    const summary = `${file.file_name} — ${duration === null ? 'Unknown duration' : formatAdminDuration(duration)} — ${file.upload_status ?? 'Unknown status'}`
    await navigator.clipboard.writeText(summary)
    setCopiedFileId(file.id)
    window.setTimeout(() => setCopiedFileId(null), 1600)
  }

  async function toggleManualPenalty(file: AdminFile) {
    const existing = penalties.find((penalty) => penalty.file_update_id === file.id)
    if (!existing) {
      setPendingPenaltyFileId(file.id)
      setPendingPenaltyReason('')
      return
    }
    setIsApplyingPenalty(file.id)
    try {
      const { error } = await createClient().from('penalties').delete().eq('id', existing.id)
      if (error) { setNotice(`Unable to remove penalty: ${error.message}`); return }
      setPenalties((current) => current.filter((penalty) => penalty.id !== existing.id))
      setNotice('Penalty removed from the file.')
    } finally { setIsApplyingPenalty(null) }
  }

  async function confirmManualPenalty(file: AdminFile) {
    if (!pendingPenaltyReason) { setNotice('Select a penalty reason before applying it.'); return }
    setIsApplyingPenalty(file.id)
    try {
      const { data, error } = await createClient().from('penalties').insert({ player_id: file.player_id, file_update_id: file.id, reason: pendingPenaltyReason, source: 'manual' }).select('id, player_id, file_update_id, reason, source, created_at').single()
      if (error) { setNotice(`Unable to apply penalty: ${error.message}`); return }
      setPenalties((current) => [data as Penalty, ...current])
      setPendingPenaltyFileId(null)
      setPendingPenaltyReason('')
      setNotice('Penalty applied to the submitted file.')
    } finally { setIsApplyingPenalty(null) }
  }

  function assignmentIsOverdue(assignment: Assignment) {
    const assignedAt = new Date(assignment.assigned_at || assignment.created_at).getTime()
    return Number.isFinite(assignedAt) && Date.now() > assignedAt + 24 * 60 * 60 * 1000 && !filesFor(assignment.game_id, assignment.player_id, assignment.tier).some((file) => file.upload_status === 'Uploaded')
  }

  async function applyAutoPenalty(assignment: Assignment) {
    const overdueFile = filesFor(assignment.game_id, assignment.player_id, assignment.tier).find((file) => file.upload_status !== 'Uploaded')
    if (!assignmentIsOverdue(assignment) || !overdueFile) { setNotice('This assignment is not overdue, or it already has an uploaded file.'); return }
    if (penalties.some((penalty) => penalty.file_update_id === overdueFile.id && penalty.source === 'auto')) { setNotice('Auto penalty already exists for this file.'); return }
    setIsApplyingPenalty(overdueFile.id)
    try {
      const { data, error } = await createClient().from('penalties').insert({ player_id: overdueFile.player_id, file_update_id: overdueFile.id, reason: 'File overdue', source: 'auto' }).select('id, player_id, file_update_id, reason, source, created_at').single()
      if (error) { setNotice(`Unable to apply auto penalty: ${error.message}`); return }
      setPenalties((current) => [data as Penalty, ...current])
      setNotice('Auto penalty applied to the overdue file.')
    } finally { setIsApplyingPenalty(null) }
  }

  async function toggleFileFlag(file: AdminFile) {
    const nextFlagged = !file.is_flagged
    const { error } = await createClient().from('file_updates').update({ is_flagged: nextFlagged }).eq('id', file.id)
    if (error) {
      console.error(' Failed to flag file:', error)
      setNotice(`Unable to ${nextFlagged ? 'flag' : 'unflag'} this file.`)
      return
    }
    setUploadedFiles((current) => current.map((item) => item.id === file.id ? { ...item, is_flagged: nextFlagged } : item))
    setNotice(nextFlagged ? 'File flagged for review.' : 'File flag removed.')
  }

  const filesFor = (gameId: string, playerId: string, tier?: Tier | null) => uploadedFiles.filter((file) => file.game_id === gameId && file.player_id === playerId && (tier === undefined || file.tier === tier))
  const statusSummaryFor = (gameId: string, playerId: string): StatusSummary => filesFor(gameId, playerId).reduce((summary, file) => {
    const duration = parseDuration(file.duration) ?? 0
    if (file.upload_status === 'Uploaded' && !file.is_flagged) summary.uploaded += duration
    else if (file.upload_status === 'In progress') summary.inProgress += duration
    else summary.notStarted += duration
    return summary
  }, { notStarted: 0, inProgress: 0, uploaded: 0 })
  const uploadedSecondsFor = (gameId: string, playerId?: string) => uploadedFiles
  .filter((file) => file.game_id === gameId && (!playerId || file.player_id === playerId) && file.upload_status === 'Uploaded' && !file.is_flagged)
  .reduce((total, file) => total + (parseDuration(file.duration) ?? 0), 0)

  const renderStatusSummary = (gameId: string, playerId: string, tier: Tier | null) => {
    const summary = {
      notStarted: filesFor(gameId, playerId, tier).filter((file) => file.upload_status === 'Not started').reduce((total, file) => total + (parseDuration(file.duration) ?? 0), 0),
      inProgress: filesFor(gameId, playerId, tier).filter((file) => file.upload_status === 'In progress').reduce((total, file) => total + (parseDuration(file.duration) ?? 0), 0),
      uploaded: filesFor(gameId, playerId, tier).filter((file) => file.upload_status === 'Uploaded' && !file.is_flagged).reduce((total, file) => total + (parseDuration(file.duration) ?? 0), 0),
    }
    const values: Record<(typeof STATUS_ORDER)[number], number> = { 'Not started': summary.notStarted, 'In progress': summary.inProgress, Uploaded: summary.uploaded }
    const total = summary.notStarted + summary.inProgress + summary.uploaded
    return (
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Player file hours by status">
          {total === 0
            ? <span className="h-full w-full" />
            : STATUS_ORDER.map((status) => values[status] > 0 && (
              <span key={status} className={`h-full ${statusMeta(status).barBg}`} style={{ width: `${(values[status] / total) * 100}%` }} title={`${status}: ${formatAdminDuration(values[status])}`} />
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {STATUS_ORDER.map((status) => (
            <span key={status} className={`inline-flex items-center gap-1.5 font-medium ${statusMeta(status).text}`} title={`${status}: ${formatAdminDuration(values[status])}`}>
              <span aria-hidden="true" className={`size-2 rounded-full ${statusMeta(status).dot}`} />
              <span>{status}</span>
              <span className="font-mono">{formatAdminDuration(values[status])}</span>
            </span>
          ))}
        </div>
      </div>
    )
  }

  const renderFileDetails = (gameId: string, playerId: string, tier: Tier | null) => {
    const files = filesFor(gameId, playerId, tier)
    const key = `${gameId}:${playerId}:${tier ?? 'none'}`
    if (selectedFilePlayer !== key) return null
    return (
      <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FilePlus2 aria-hidden="true" className="size-3.5" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Uploaded files</p>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        </div>

        {files.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-background/50 px-3 py-5 text-center text-xs text-muted-foreground">
            No file records found for this player and game.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {files.map((file) => {
              const seconds = parseDuration(file.duration)
              const meta = statusMeta(file.upload_status)
              return (
                <div key={file.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-xs shadow-sm transition ${file.is_flagged && penalties.some((penalty) => penalty.file_update_id === file.id) ? 'border-purple-500/60 bg-purple-500/[0.10] text-purple-950 dark:text-purple-100' : file.is_flagged ? 'border-red-500/50 bg-red-500/[0.07] text-red-950 dark:text-red-100' : penalties.some((penalty) => penalty.file_update_id === file.id) ? 'border-orange-500/60 bg-orange-500/[0.10] text-orange-950 dark:text-orange-100' : 'border-border/70 bg-background/80 hover:border-primary/30'}`}>
                  {file.is_flagged && <span className="sr-only">Flagged file</span>}
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${file.is_flagged && penalties.some((penalty) => penalty.file_update_id === file.id) ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300' : file.is_flagged ? 'bg-red-500/10 text-red-600 dark:text-red-300' : penalties.some((penalty) => penalty.file_update_id === file.id) ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300' : 'bg-muted text-muted-foreground'}`}>
                      <FilePlus2 aria-hidden="true" className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{file.file_name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-primary" title={seconds === null ? 'Unknown duration' : 'MM:SS (HH:MM)'}>{seconds === null ? 'Unknown duration' : formatBothDurations(seconds)}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chipBg} ${meta.chipText}`}>
                          <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.dot}`} />
                          {file.upload_status ?? 'Unknown status'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyFileSummary(file)}
                      className="rounded-lg border border-border px-2.5 py-1.5 font-semibold text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                    >
                      {copiedFileId === file.id ? (
                        <span className="flex items-center gap-1"><Check aria-hidden="true" className="size-3" /> Copied</span>
                      ) : (
                        'Copy'
                      )}
                    </button>
                    {isAdmin && (
                      <>
                        <button type="button" aria-pressed={file.is_flagged} onClick={() => void toggleFileFlag(file)} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-semibold transition ${file.is_flagged ? 'border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-300' : 'border-border text-muted-foreground hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300'}`}>
                          <Flag aria-hidden="true" className="size-3" /> {file.is_flagged ? 'Unflag' : 'Flag'}
                        </button>
                        {pendingPenaltyFileId === file.id && !penalties.some((penalty) => penalty.file_update_id === file.id) ? (
                          <div className="flex items-center gap-1.5">
                            <select aria-label={`Penalty reason for ${file.file_name}`} value={pendingPenaltyReason} onChange={(event) => setPendingPenaltyReason(event.target.value)} className="h-8 rounded-lg border border-amber-500/40 bg-background px-2 text-[11px] font-medium text-foreground">
                              <option value="">Select reason</option>
                              {PENALTY_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                            </select>
                            <button type="button" disabled={isApplyingPenalty === file.id || !pendingPenaltyReason} onClick={() => void confirmManualPenalty(file)} className="rounded-lg bg-amber-500 px-2.5 py-1.5 font-semibold text-amber-950 disabled:opacity-50">Apply</button>
                            <button type="button" onClick={() => { setPendingPenaltyFileId(null); setPendingPenaltyReason('') }} className="rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-muted">Cancel</button>
                          </div>
                        ) : (
                          <button type="button" disabled={isApplyingPenalty === file.id} onClick={() => void toggleManualPenalty(file)} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-semibold transition disabled:opacity-50 ${penalties.some((penalty) => penalty.file_update_id === file.id) ? 'border-amber-500/70 bg-amber-400/20 text-amber-800 dark:text-amber-200' : 'border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'}`}>
                            <Gavel aria-hidden="true" className="size-3" /> {isApplyingPenalty === file.id ? 'Updating…' : penalties.some((penalty) => penalty.file_update_id === file.id) ? 'Remove penalty' : 'Penalty'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
          <span className="size-1.5 rounded-full bg-primary" /> Admin workspace
        </p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Keep every game moving.</h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">Set up game workstreams, assign players, and keep hourly expectations visible in one place.</p>
      </div>

      <nav aria-label="Admin sections" className="grid gap-1.5 rounded-2xl border border-border bg-card p-1.5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          { id: 'games' as const, label: 'Game list', description: 'Create and manage games', icon: Gamepad2 },
          { id: 'players' as const, label: 'Manage players', description: 'Review player records', icon: Users },
          { id: 'assignments' as const, label: 'Games and assignments', description: 'Review assigned hours', icon: Clock3 },
          { id: 'reports' as const, label: 'Report', description: 'Generate working reports', icon: FileBarChart },
        ].map(({ id, label, description, icon: Icon }) => {
          const isActive = activeAdminSection === id
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveAdminSection(id)}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left transition ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-muted/60'}`}
            >
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition ${isActive ? 'bg-primary-foreground/15' : 'bg-muted text-primary'}`}><Icon aria-hidden="true" className="size-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span><span className={`block truncate text-xs ${isActive ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{description}</span></span>
            </button>
          )
        })}
      </nav>

      {activeAdminSection === 'reports' && (
        <section className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-1"><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Admin reports</p><h2 className="text-xl font-semibold tracking-tight">Working history</h2><p className="text-sm leading-6 text-muted-foreground">Review tier-specific player hours, sorted by each player&apos;s total working duration.</p></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" aria-pressed={reportType === 'player'} onClick={() => setReportType('player')} className={`rounded-xl border p-4 text-left transition ${reportType === 'player' ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:bg-muted/40'}`}><p className="text-sm font-semibold">Option 1: Player Total Working Hours Report</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Player, tier, and working duration.</p></button>
            <button type="button" aria-pressed={reportType === 'full'} onClick={() => setReportType('full')} className={`rounded-xl border p-4 text-left transition ${reportType === 'full' ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:bg-muted/40'}`}><p className="text-sm font-semibold">Option 2: Full Report</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Adds every player file and its duration.</p></button>
          </div>
          <div className="flex flex-col gap-5 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 sm:p-5">
            <div className="flex flex-col gap-1"><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Payment generation</p><h3 className="text-lg font-semibold tracking-tight">Calculate finalized player payments</h3><p className="text-sm leading-6 text-muted-foreground">Enter the BDT rate for each tier. Only files marked Uploaded are included, and the full breakdown will download as one PDF.</p></div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['Tier 1', 'Tier 2', 'Tier 3'] as Tier[]).map((tier) => <Field key={tier} label={`${tier} · BDT per hour`}><input type="number" min="0" step="0.01" inputMode="decimal" value={tierRates[tier]} onChange={(event) => setTierRates((current) => ({ ...current, [tier]: event.target.value }))} placeholder="e.g. 120" className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/30" /></Field>)}
            </div>
            <div className="relative flex w-full sm:w-fit">
              <button type="button" onClick={() => setIsExportMenuOpen((current) => !current)} aria-expanded={isExportMenuOpen} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"><FileBarChart aria-hidden="true" className="size-4" /> Generate payment report <ChevronDown aria-hidden="true" className={`size-4 transition ${isExportMenuOpen ? 'rotate-180' : ''}`} /></button>
              {isExportMenuOpen && <div role="menu" className="absolute left-0 top-14 z-20 flex w-full min-w-[230px] flex-col gap-1 rounded-2xl border border-border bg-popover p-2 shadow-xl sm:w-[260px]">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose export format</p>
                <button type="button" role="menuitem" onClick={() => generatePaymentReport('pdf')} className="rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-muted">Generate PDF<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Download the formatted payment report</span></button>
                <button type="button" role="menuitem" onClick={() => generatePaymentReport('excel')} className="rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-muted">Generate Excel<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Download the full spreadsheet</span></button>
                <button type="button" role="menuitem" onClick={() => generatePaymentReport('both')} className="rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-muted">Generate Both<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Download PDF and Excel together</span></button>
              </div>}
            </div>
            {paymentReport.length > 0 && <div className="flex flex-col gap-3"><div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Latest payment calculation</h4><span className="font-mono text-sm font-semibold text-primary">{paymentReportTotal.toFixed(2)} BDT total</span></div><div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2.5">Player</th><th className="px-3 py-2.5">Tier 1 payable / flagged</th><th className="px-3 py-2.5">Tier 2 payable / flagged</th><th className="px-3 py-2.5">Tier 3 payable / flagged</th><th className="px-3 py-2.5">Uploaded</th><th className="px-3 py-2.5">Flagged</th><th className="px-3 py-2.5">Payable</th><th className="px-3 py-2.5">Payment</th></tr></thead><tbody className="divide-y divide-border">{paymentReport.map((row) => <tr key={row.player.id}><td className="px-3 py-2.5 font-semibold">{row.player.display_name}</td><td className="px-3 py-2.5 font-mono">{row.tierTotals['Tier 1'].toFixed(2)} / {row.flaggedTotals['Tier 1'].toFixed(2)}</td><td className="px-3 py-2.5 font-mono">{row.tierTotals['Tier 2'].toFixed(2)} / {row.flaggedTotals['Tier 2'].toFixed(2)}</td><td className="px-3 py-2.5 font-mono">{row.tierTotals['Tier 3'].toFixed(2)} / {row.flaggedTotals['Tier 3'].toFixed(2)}</td><td className="px-3 py-2.5 font-mono">{row.totalUploadedHours.toFixed(2)}</td><td className="px-3 py-2.5 font-mono text-red-600 dark:text-red-400">{row.totalFlaggedHours.toFixed(2)}</td><td className="px-3 py-2.5 font-mono">{row.totalHours.toFixed(2)}</td><td className="px-3 py-2.5 font-mono font-semibold text-primary">{row.totalPay.toFixed(2)} BDT</td></tr>)}</tbody></table></div></div>}
          </div>
          {reportRows.length === 0 ? <EmptyState icon={FileBarChart} title="No report data yet" description="Create player assignments or upload player files to populate this report." /> : <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Player</th><th className="px-4 py-3">Player Tier</th><th className="px-4 py-3">Working Duration</th>{reportType === 'full' && <th className="px-4 py-3">Player File Name</th>}{reportType === 'full' && <th className="px-4 py-3">File Duration</th>}</tr></thead><tbody className="divide-y divide-border">{reportRows.flatMap((row) => { const tierRows = row.tiers.length ? row.tiers : [{ tier: 'Unassigned' as const, duration: 0, game: 'No assignment', files: [] }]; return tierRows.flatMap((tier, tierIndex) => { const fileRows = reportType === 'full' ? (tier.files.length ? tier.files : [{ name: 'No player file', duration: 0, game: '' }]) : [null]; return fileRows.map((file, fileIndex) => <tr key={`${row.player.id}-${tierIndex}-${fileIndex}`} className="align-top hover:bg-muted/20"><td className="px-4 py-3 font-semibold">{tierIndex === 0 && fileIndex === 0 ? <><span className="block">{row.player.display_name}</span><span className="mt-1 block font-mono text-[11px] text-muted-foreground">Total {formatAdminDuration(row.total)}</span></> : <span className="text-muted-foreground">↳ {row.player.display_name}</span>}</td><td className="px-4 py-3"><span className="font-medium">{tier.tier}</span><span className="mt-1 block text-xs text-muted-foreground">{tier.game}</span>{reportType === 'full' && <span className="mt-1 block text-xs font-medium text-primary">Tier total: {formatAdminDuration(tier.duration)}</span>}</td><td className="px-4 py-3 font-mono text-primary">{formatAdminDuration(tier.duration)}</td>{reportType === 'full' && <td className="px-4 py-3"><span className="font-medium">{file?.name}</span>{file?.game && <span className="mt-1 block text-xs text-muted-foreground">{file.game}</span>}</td>}{reportType === 'full' && <td className="px-4 py-3 font-mono text-primary">{formatAdminDuration(file?.duration ?? 0)}</td>}</tr>)})})}</tbody></table></div>}
        </section>
      )}

      {activeAdminSection === 'games' && <>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Create a game</h2>
              <p className="text-sm leading-6 text-muted-foreground">Start a new production workspace for your team.</p>
            </div>
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Gamepad2 aria-hidden="true" className="size-5" /></div>
          </div>
          <form className="flex flex-col gap-5" onSubmit={handleCreateGame}>
<Field label="Game name">
                <input required name="gameName" placeholder="e.g. Neon Drift" className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/30" />
              </Field>
              <Field label="Total game hours">
                <input required name="totalGameHours" type="number" min="0" step="0.01" inputMode="decimal" placeholder="e.g. 12.5" className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/30" />
              </Field>
            <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"> <Plus data-icon="inline-start" className="size-4" /> Add game</button>
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Assign player hours</h2>
              <p className="text-sm leading-6 text-muted-foreground">Give a player a clear target for the current game.</p>
            </div>
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Clock3 aria-hidden="true" className="size-5" /></div>
          </div>
          <form className="flex flex-col gap-5" onSubmit={handleAssignHours}>
            <Field label="Game">
              <div className="relative"><select required name="game" defaultValue="" className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 pr-10 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"><option value="" disabled>{isLoading ? 'Loading games…' : 'Select a game'}</option>{games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" /></div>
            </Field>
            <Field label="Player">
              <div className="relative"><select required name="player" defaultValue="" className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 pr-10 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"><option value="" disabled>Select a player</option>{players.map((player) => <option key={player.id} value={player.id}>{player.display_name}</option>)}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" /></div>
            </Field>
            <Field label="Hours for player"><input required name="hours" type="text" inputMode="decimal" placeholder="e.g. 12 hours" className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/30" /></Field>
            <Field label="Tier">
              <div className="relative"><select required name="tier" defaultValue="" className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 pr-10 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"><option value="" disabled>Select a tier</option><option value="Tier 1">Tier 1 · Gold</option><option value="Tier 2">Tier 2 · Silver</option><option value="Tier 3">Tier 3 · Bronze</option></select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" /></div>
            </Field>
            <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-secondary px-4 text-sm font-semibold text-secondary-foreground shadow-sm transition hover:bg-accent"><Clock3 data-icon="inline-start" className="size-4" /> Assign hours</button>
          </form>
        </section>
      </div>
      </>}

      {notice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <span>{notice}</span>
          <button aria-label="Dismiss notice" onClick={() => setNotice('')}><X className="size-4 text-muted-foreground" /></button>
        </div>
      )}

      {activeAdminSection === 'games' && <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md sm:p-7">
        <div className="flex flex-col gap-1"><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-semibold tracking-tight">Game list</h2><p className="text-sm leading-6 text-muted-foreground">Select a game to inspect assigned players and hours, or remove an old game.</p></div><button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary">Refresh totals</button></div></div>
        {games.length === 0 ? <EmptyState icon={Gamepad2} title="No games yet" description="Create a game above to start assigning player work." /> : (
          <div className="flex flex-col gap-2">
            {games.map((game) => {
              const gameAssignments = assignments.filter((item) => item.game_id === game.id)
              const groupedGameAssignments = groupAssignments(gameAssignments)
              const isSelected = selectedGameId === game.id
              return (
                <div key={game.id} className={`rounded-xl border bg-background/40 transition ${isSelected ? 'border-primary/30 shadow-sm' : 'border-border hover:border-primary/20'}`}>
                  <div className="flex items-center gap-3 p-3">
                    <button type="button" onClick={() => setSelectedGameId(isSelected ? null : game.id)} aria-expanded={isSelected} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-muted/40">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                        <span className="truncate font-semibold">{game.name} - {game.total_hours} {game.total_hours === 1 ? 'hour' : 'hours'}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        {gameAssignments.length} {gameAssignments.length === 1 ? 'assignment' : 'assignments'}
                        <br />
                        <span className="font-mono text-primary">Uploaded {formatAdminDuration(uploadedSecondsFor(game.id))}</span>
                      </span>
                    </button>
                    {editingGameId === game.id ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <label className="sr-only" htmlFor={`total-hours-${game.id}`}>Total game hours</label>
                        <input id={`total-hours-${game.id}`} type="number" min="0" step="0.01" inputMode="decimal" value={editingGameHours} onChange={(event) => setEditingGameHours(event.target.value)} className="h-9 w-24 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" />
                        <button type="button" disabled={isSavingGame === game.id} onClick={() => void saveGameHours(game)} className="rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{isSavingGame === game.id ? 'Saving…' : 'Save'}</button>
                        <button type="button" onClick={cancelEditingGame} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => startEditingGame(game)} aria-label={`Edit total hours for ${game.name}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary"><Pencil aria-hidden="true" className="size-3.5" /> Edit</button>
                    )}
                    <button type="button" disabled={isDeletingGame !== null || isSavingGame !== null} onClick={() => void handleDeleteGame(game)} className="rounded-lg px-3 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50">{isDeletingGame === game.id ? 'Removing…' : 'Remove'}</button>
                  </div>
                  {isSelected && (
                    <div className="border-t border-border px-5 py-4">
                      {gameAssignments.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No player hours assigned to this game yet.</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {groupedGameAssignments.map(({ primary: item, extras }) => {
                            const key = `${game.id}:${item.player_id}:${item.tier ?? 'none'}`
                            const assignedLabel = `Assigned ${item.hours_text.replace(/\s*hours?\b/i, 'H')}`
                            return (
                              <div key={key} className="flex flex-col gap-3 rounded-xl bg-muted/30 p-3.5 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      aria-expanded={selectedFilePlayer === key}
                                      onClick={(event) => { event.stopPropagation(); toggleFilePanel(key) }}
                                      className="cursor-pointer text-left text-sm font-medium text-foreground underline decoration-dotted underline-offset-4 hover:text-primary"
                                    >
                                      {playerNames.get(item.player_id) ?? 'Unknown player'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => { event.stopPropagation(); toggleFilePanel(key) }}
                                      className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                    >
                                      {selectedFilePlayer === key ? 'Hide files' : 'View files'}
                                    </button>
                                  </div>
                                  {renderStatusSummary(game.id, item.player_id, item.tier)}
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] leading-4 text-primary">
                                    <span>{assignedLabel}</span>
                                    {extras.map((extra) => editingExtraId === extra.id ? (
                                      <span key={extra.id} className="inline-flex items-center gap-1">
                                        <label className="sr-only" htmlFor={`extra-hours-${extra.id}`}>Extra hours</label>
                                        <input id={`extra-hours-${extra.id}`} type="text" inputMode="decimal" value={editingExtraHours} onChange={(event) => setEditingExtraHours(event.target.value)} className="h-6 w-16 rounded border border-input bg-background px-1.5 text-[10px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-ring/30" />
                                        <button type="button" disabled={isSavingAssignment === extra.id} onClick={() => void saveExtraHours(extra.id)} className="rounded bg-primary px-1.5 py-1 font-sans text-[10px] font-semibold text-primary-foreground disabled:opacity-50">{isSavingAssignment === extra.id ? '…' : 'Save'}</button>
                                        <button type="button" onClick={cancelEditingExtra} className="rounded px-1 py-1 font-sans text-[10px] font-semibold text-muted-foreground hover:bg-background">Cancel</button>
                                      </span>
                                    ) : (
                                        <span key={extra.id} className="inline-flex items-center gap-1">
                                          <button type="button" onClick={() => startEditingExtra(extra)} className="cursor-pointer rounded px-1 py-0.5 text-primary underline decoration-dotted underline-offset-2 transition hover:bg-primary/10" aria-label={`Edit extra hours ${extra.hours_text}`}>
                                            Extra +{extra.hours_text.replace(/\s*hours?\b/i, 'H')}
                                          </button>
                                          <button type="button" disabled={isRemovingExtra === extra.id} onClick={() => void removeExtraAssignment(extra)} className="rounded p-0.5 text-destructive transition hover:bg-destructive/10 disabled:opacity-50" aria-label={`Delete extra hours ${extra.hours_text}`} title="Delete extra hours">
                                            <Trash2 aria-hidden="true" className="size-3" />
                                          </button>
                                        </span>
                                    ))}
                                  </div>
                                  {renderFileDetails(game.id, item.player_id, item.tier)}
                                </div>
                                <div className="shrink-0">
                                  {editingAssignmentId === item.id ? (
                                    <div className="flex items-center gap-2">
                                      <input value={editingHours} onChange={(event) => setEditingHours(event.target.value)} aria-label={`Assigned hours for ${playerNames.get(item.player_id) ?? 'player'}`} className="h-9 w-28 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" />
                                      <select value={editingTier} onChange={(event) => setEditingTier(event.target.value as Tier | '')} aria-label="Assigned tier" className="h-9 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"><option value="">No tier</option><option value="Tier 1">Tier 1</option><option value="Tier 2">Tier 2</option><option value="Tier 3">Tier 3</option></select>
                                      <button type="button" disabled={isSavingAssignment === item.id} onClick={() => void saveAssignmentHours(item.id)} className="rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{isSavingAssignment === item.id ? 'Saving…' : 'Save'}</button>
                                      <button type="button" onClick={cancelEditingAssignment} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-background">Cancel</button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      {item.tier && <TierBadge tier={item.tier} />}
<button type="button" onClick={() => startEditingAssignment(item)} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-primary hover:bg-primary/10">Edit</button>
    <button type="button" disabled={isRemovingAssignment === item.id} onClick={() => void removeAssignment(item)} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50">{isRemovingAssignment === item.id ? 'Removing…' : 'Remove'}</button>
  </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>}

      {activeAdminSection === 'players' && <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md sm:p-7">
        <div className="flex flex-col gap-1"><h2 className="text-xl font-semibold tracking-tight">Manage players</h2><p className="text-sm leading-6 text-muted-foreground">Search a player to see every game and assigned hour target.</p></div>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-muted-foreground" />
          <input value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Search player name" aria-label="Search player by name" className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30" />
        </div>
        {!playerSearch.trim() ? <EmptyState icon={Users} title="Search player records" description="Enter a player name to review their assignments." /> : matchingPlayers.length === 0 ? <EmptyState icon={Users} title={`No player found for "${playerSearch}"`} description="Try another player name." /> : (
          <div className="flex flex-col gap-3">
            {matchingPlayers.map((player) => (
              <div key={player.id} className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{player.display_name}</p>
                  <span className="text-xs text-muted-foreground">{assignments.filter((item) => item.player_id === player.id).length} assignments</span>
                </div>
                {playerSearch.trim() && matchingPlayers.length === 1 && (
                  selectedPlayerAssignments.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No assignments yet.</p>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2">
                      {selectedPlayerAssignments.map((item) => {
                        const key = `${item.game_id}:${item.player_id}`
                        return (
                          <div key={item.id} className="flex flex-col gap-3 rounded-xl bg-muted/30 p-3.5 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  aria-expanded={selectedFilePlayer === key}
                                  onClick={(event) => { event.stopPropagation(); toggleFilePanel(key) }}
                                  className="cursor-pointer text-left text-sm font-medium text-foreground underline decoration-dotted underline-offset-4 hover:text-primary"
                                >
                                  {gameNames.get(item.game_id) ?? 'Unknown game'}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => { event.stopPropagation(); toggleFilePanel(key) }}
                                  className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                >
                                  {selectedFilePlayer === key ? 'Hide files' : 'View files'}
                                </button>
                              </div>
                              {renderStatusSummary(item.game_id, item.player_id, item.tier)}
                              <p className="mt-1 font-mono text-xs text-primary">Assigned {item.hours_text}</p>
                              {renderFileDetails(item.game_id, item.player_id, item.tier)}
                            </div>
                            <div className="shrink-0">
                              {editingAssignmentId === item.id ? (
                                <div className="flex items-center gap-2">
                                  <input value={editingHours} onChange={(event) => setEditingHours(event.target.value)} aria-label={`Assigned hours for ${gameNames.get(item.game_id) ?? 'game'}`} className="h-9 w-28 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" />
                                  <select value={editingTier} onChange={(event) => setEditingTier(event.target.value as Tier | '')} aria-label="Assigned tier" className="h-9 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"><option value="">No tier</option><option value="Tier 1">Tier 1</option><option value="Tier 2">Tier 2</option><option value="Tier 3">Tier 3</option></select>
                                  <button type="button" disabled={isSavingAssignment === item.id} onClick={() => void saveAssignmentHours(item.id)} className="rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{isSavingAssignment === item.id ? 'Saving…' : 'Save'}</button>
                                  <button type="button" onClick={cancelEditingAssignment} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-background">Cancel</button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{item.hours_text}</span>
                                      {item.tier && <TierBadge tier={item.tier} />}
<button type="button" disabled={isApplyingPenalty === item.id} onClick={() => void applyAutoPenalty(item)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-300"><Gavel aria-hidden="true" className="size-3" /> {isApplyingPenalty === item.id ? 'Applying…' : 'Auto Penalty'}</button>
<button type="button" onClick={() => startEditingAssignment(item)} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-primary hover:bg-primary/10">Edit</button>
    <button type="button" disabled={isRemovingAssignment === item.id} onClick={() => void removeAssignment(item)} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50">{isRemovingAssignment === item.id ? 'Removing…' : 'Remove'}</button>
  </div>
  )}
  </div>
  </div>
  )
  })}
  </div>
  )
  )}
              </div>
            ))}
          </div>
        )}
      </section>}

      {activeAdminSection === 'assignments' && <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-semibold tracking-tight">Games and assignments</h2><p className="mt-1 text-sm text-muted-foreground">Search a game to see who is assigned and how many hours.</p></div><span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground">{matchingAssignments.length} records</span></div>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-muted-foreground" />
          <input value={gameSearch} onChange={(event) => setGameSearch(event.target.value)} placeholder="Search game name" aria-label="Search game by name" className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30" />
        </div>
        {matchingAssignments.length === 0 ? <EmptyState icon={Archive} title={gameSearch ? `No assignments found for "${gameSearch}"` : 'No assignments yet'} description="Assigned games and hours will appear here after an admin assigns work." /> : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-3">Game</th><th className="px-4 py-3">Player</th><th className="px-4 py-3">Hours</th><th className="px-4 py-3">Tier</th><th className="px-4 py-3">Assigned</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {matchingAssignments.map((item) => (
                  <tr key={item.id} className="transition hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{gameNames.get(item.game_id) ?? 'Unknown game'}</td>
                    <td className="px-4 py-3">{playerNames.get(item.player_id) ?? 'Unknown player'}</td>
                    <td className="px-4 py-3 font-mono">{item.hours_text}</td>
                    <td className="px-4 py-3">{item.tier ? <TierBadge tier={item.tier} /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}
    </div>
  )
}

type FileUpdate = { id: string; name: string; duration: string; status: string; gameName: string; tier: Tier | null; isFlagged: boolean; isPenalized: boolean }
  type FileUpdateRow = { id: string; file_name: string; duration: string; upload_status: string; game_id: string; tier: Tier | null; is_flagged: boolean }
  type PlayerPenaltyRow = { file_update_id: string }

type GameRow = Game
  type AssignedGame = { game: Game; tier: Tier | null; hoursText: string }
  type AssignedGameRow = { game_id: string; tier: Tier | null; hours_text: string; games: Game | Game[] | null }

function PlayerPanel() {
  const [notice, setNotice] = useState('')
  const [fileUpdates, setFileUpdates] = useState<FileUpdate[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [gameTiers, setGameTiers] = useState<Map<string, Tier | null>>(new Map())
  const [gameHours, setGameHours] = useState<Map<string, string>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [editingFileId, setEditingFileId] = useState<string | null>(null)
  const [editingFileName, setEditingFileName] = useState('')
  const [editingFileDuration, setEditingFileDuration] = useState('')
  const [editingFileGameId, setEditingFileGameId] = useState('')
  const [editingFileStatus, setEditingFileStatus] = useState('')
  const [isSavingFileStatus, setIsSavingFileStatus] = useState<string | null>(null)
  const [isDeletingFile, setIsDeletingFile] = useState<string | null>(null)

  const fileStatuses = ['Not started', 'In progress', 'Uploaded'] as const

  function startEditingFile(file: FileUpdate) {
    setEditingFileId(file.id)
    setEditingFileName(file.name)
    setEditingFileDuration(file.duration)
    setEditingFileGameId(games.find((game) => game.name === file.gameName)?.id ?? '')
    setEditingFileStatus(file.status)
  }

  function cancelEditingFile() {
    setEditingFileId(null)
    setEditingFileName('')
    setEditingFileDuration('')
    setEditingFileGameId('')
    setEditingFileStatus('')
  }

  async function saveFileStatus(fileId: string) {
    const durationSeconds = parseDuration(editingFileDuration.trim())
    if (!editingFileName.trim() || !editingFileGameId || !fileStatuses.includes(editingFileStatus as (typeof fileStatuses)[number])) {
      setNotice('Complete the file name, game, and status before saving.')
      return
    }
    if (durationSeconds === null) {
      setNotice('Duration must use MM:SS format, with seconds between 00 and 59.')
      return
    }

    setIsSavingFileStatus(fileId)
    try {
      const { error } = await createClient()
        .from('file_updates')
        .update({ file_name: editingFileName.trim(), duration: formatDuration(durationSeconds), game_id: editingFileGameId, upload_status: editingFileStatus })
        .eq('id', fileId)
        .eq('is_flagged', false)
        .not('id', 'in', `(${fileUpdates.filter((item) => item.isPenalized).map((item) => item.id).join(',') || '00000000-0000-0000-0000-000000000000'})`)

      if (error) {
        console.error(' Failed to update file:', error)
        setNotice(`Unable to update file: ${error.message}`)
        return
      }

      setFileUpdates((current) => current.map((item) => item.id === fileId ? { ...item, name: editingFileName.trim(), duration: formatDuration(durationSeconds), gameName: games.find((game) => game.id === editingFileGameId)?.name ?? item.gameName, status: editingFileStatus } : item))
      cancelEditingFile()
      setNotice('File details updated successfully.')
    } finally {
      setIsSavingFileStatus(null)
    }
  }

  async function deleteFile(file: FileUpdate) {
    if (file.isFlagged || file.isPenalized || !window.confirm(`Delete ${file.name}? This cannot be undone.`)) return
    setIsDeletingFile(file.id)
    try {
      const { error } = await createClient().from('file_updates').delete().eq('id', file.id).eq('is_flagged', false)
      if (error) {
        console.error(' Failed to delete file:', error)
        setNotice(`Unable to delete file: ${error.message}`)
        return
      }
      setFileUpdates((current) => current.filter((item) => item.id !== file.id))
      setNotice('File deleted successfully.')
    } finally {
      setIsDeletingFile(null)
    }
  }

  useEffect(() => {
    let active = true
    async function loadFileUpdates() {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const [{ data, error }, { data: assignmentData, error: assignmentError }, { data: penaltyData, error: penaltyError }] = await Promise.all([
          supabase.from('file_updates').select('id, file_name, duration, upload_status, game_id, tier, is_flagged').eq('player_id', user.id).order('created_at', { ascending: false }),
          supabase.from('player_hours').select('game_id, tier, hours_text, games!inner(id, name)').eq('player_id', user.id).order('created_at', { ascending: false }),
          supabase.from('penalties').select('file_update_id').eq('player_id', user.id),
        ])
        if (error) throw error
        if (assignmentError) throw assignmentError
        if (penaltyError) throw penaltyError
        const penalizedFileIds = new Set((penaltyData ?? []).map((row: PlayerPenaltyRow) => row.file_update_id))
        if (active) {
          const assignedRows = (assignmentData ?? []) as AssignedGameRow[]
          const assignedGameById = new Map<string, AssignedGame>()
          // Rows are newest-first, so the first assignment is the latest tier.
          assignedRows.forEach((row) => {
            const game = Array.isArray(row.games) ? row.games[0] : row.games
            if (game && !assignedGameById.has(game.id)) assignedGameById.set(game.id, { game, tier: row.tier, hoursText: row.hours_text })
          })
          const typedGames = Array.from(assignedGameById.values()).map((item) => item.game) as GameRow[]
          setGameTiers(new Map(Array.from(assignedGameById.entries()).map(([id, item]) => [id, item.tier])))
          const assignedHoursByGame = new Map(Array.from(assignedGameById.entries()).map(([id, item]) => [id, item.hoursText]))
          setGameHours(assignedHoursByGame)
          const typedFiles = (data ?? []) as FileUpdateRow[]
          const gameNames = new Map(typedGames.map((game: GameRow) => [game.id, game.name]))
          setGames(typedGames)
          // File activity belongs to the saved file, not the assignment's current tier.
          // Do not hide a player's files when an admin changes the game's tier later.
          setFileUpdates(typedFiles
            .filter((file: FileUpdateRow) => gameNames.has(file.game_id))
            .map((file: FileUpdateRow) => ({
              id: file.id,
              name: file.file_name,
              duration: file.duration,
              status: file.upload_status,
              gameName: gameNames.get(file.game_id) ?? 'Unknown game',
              tier: file.tier,
              isFlagged: file.is_flagged,
              isPenalized: penalizedFileIds.has(file.id),
            })))
        }
      } catch (error) {
        console.error(' Failed to load file updates:', error)
        if (active) setNotice('Unable to load saved file updates.')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void loadFileUpdates()
    return () => { active = false }
  }, [])

  async function handleFileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('fileName') ?? '').trim()
    const duration = String(form.get('duration') ?? '').trim()
    const status = String(form.get('status') ?? '')
    const gameId = String(form.get('gameId') ?? '')
    const durationSeconds = parseDuration(duration)

    if (!name || !duration || !status || !gameId) {
      setNotice('Choose a game and complete the file details.')
      return
    }
    if (durationSeconds === null) {
      setNotice('Duration must use MM:SS format, for example 56:16. Seconds must be between 00 and 59.')
      return
    }

    setIsSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setNotice('Your session has expired. Please sign in again.')
        return
      }
      const normalizedDuration = formatDuration(durationSeconds)
      const { data, error } = await supabase
        .from('file_updates')
        .insert({ player_id: user.id, game_id: gameId, tier: gameTiers.get(gameId) ?? null, file_name: name, duration: normalizedDuration, upload_status: status })
        .select('id, file_name, duration, upload_status, tier, is_flagged')
        .single()
      if (error) throw error
      setFileUpdates((current) => [{ id: data.id, name: data.file_name, duration: data.duration, status: data.upload_status, gameName: games.find((game) => game.id === gameId)?.name ?? 'Unknown game', tier: data.tier ?? gameTiers.get(gameId) ?? null, isFlagged: data.is_flagged, isPenalized: false }, ...current])
      formElement.reset()
      setNotice('File update saved to Supabase.')
    } catch (error) {
      console.error(' Failed to save file update:', error)
      setNotice('Unable to save this file update. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
          <span className="size-1.5 rounded-full bg-primary" /> Player workspace
        </p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Your files, clearly tracked.</h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">Log each file as you work so your team can see progress, duration, and status at a glance.</p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md sm:p-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Add a file update</h2>
            <p className="text-sm leading-6 text-muted-foreground">Record the file details without uploading anything.</p>
          </div>
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><FilePlus2 className="size-5" /></div>
        </div>
        <form className="grid gap-5 md:grid-cols-4" onSubmit={handleFileUpdate}>
          <Field label="Game">
            <div className="relative">
              <select required name="gameId" defaultValue="" disabled={isLoading || games.length === 0} className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 pr-10 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30">
                <option value="" disabled>{isLoading ? 'Loading games…' : games.length === 0 ? 'No games available' : 'Select a game'}</option>
                {games.map((game) => <option key={game.id} value={game.id}>{game.name}{gameTiers.get(game.id) ? ` · ${gameTiers.get(game.id)}` : ''}{gameHours.get(game.id) ? ` · ${gameHours.get(game.id)} hours assigned` : ''}</option>)}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" />
            </div>
          </Field>
          <Field label="File name">
            <input required name="fileName" placeholder="e.g. player_idle.anim" className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/30" />
          </Field>
          <Field label="File duration">
            <input required name="duration" inputMode="decimal" placeholder="e.g. 01:42" className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/30" />
          </Field>
          <Field label="Upload status">
            <div className="relative">
              <select required name="status" defaultValue="" className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 pr-10 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30">
                <option value="" disabled>Select status</option>
                {STATUS_ORDER.map((status) => <option key={status}>{status}</option>)}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" />
            </div>
          </Field>
          <button type="submit" disabled={isSaving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 md:col-span-3 md:justify-self-end">
            <UploadCloud aria-hidden="true" className="size-4" /> {isSaving ? 'Saving��' : 'Add file update'}
          </button>
        </form>
      </section>

      {notice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <span>{notice}</span>
          <button aria-label="Dismiss notice" onClick={() => setNotice('')}><X className="size-4 text-muted-foreground" /></button>
        </div>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">File activity</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your saved file updates will appear here.</p>
          </div>
          <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground">{fileUpdates.length} {fileUpdates.length === 1 ? 'file' : 'files'}</span>
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading saved file updates…</div>
        ) : fileUpdates.length === 0 ? (
          <EmptyState icon={UploadCloud} title="No file updates yet" description="Add your first file update above. Your entries will appear here immediately." />
        ) : (
          <div className="flex flex-col gap-3">
            {fileUpdates.map((file) => {
              const meta = statusMeta(file.status)
              return (
                <div key={file.id} className={`flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition sm:flex-row sm:items-center sm:justify-between ${file.isFlagged && file.isPenalized ? 'border-purple-500/60 bg-purple-500/[0.10] text-purple-950 dark:text-purple-100' : file.isPenalized ? 'border-orange-500/60 bg-orange-400/15 text-orange-950 dark:text-orange-100' : file.isFlagged ? 'border-red-500/50 bg-red-500/[0.06] text-red-950 dark:text-red-100' : 'border-border bg-card hover:border-primary/25'}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`relative rounded-xl p-2.5 ${file.isFlagged && file.isPenalized ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300' : file.isPenalized ? 'bg-orange-500/20 text-orange-800 dark:text-orange-200' : file.isFlagged ? 'bg-red-500/15 text-red-700 dark:text-red-300' : 'bg-primary/10 text-primary'}`}>
                      <FilePlus2 aria-hidden="true" className="size-5" />
                      {file.isFlagged && file.isPenalized ? <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-purple-500 ring-2 ring-card" /> : file.isPenalized ? <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-orange-500 ring-2 ring-card" /> : file.isFlagged ? <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-card" /> : <span aria-hidden="true" className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card ${meta.dot}`} />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{file.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{file.gameName}{file.tier ? ` · ${file.tier}` : ''} · Duration {file.duration}</p>
                      {file.isPenalized && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Penalty applied — editing locked</p>}
                    </div>
                  </div>
                  {editingFileId === file.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={editingFileName} onChange={(event) => setEditingFileName(event.target.value)} aria-label={`File name for ${file.name}`} className="h-9 w-44 rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" />
                      <input value={editingFileDuration} onChange={(event) => setEditingFileDuration(event.target.value)} aria-label={`Duration for ${file.name}`} placeholder="MM:SS" className="h-9 w-20 rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" />
                      <select value={editingFileGameId} onChange={(event) => setEditingFileGameId(event.target.value)} aria-label={`Game for ${file.name}`} className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30">
                        {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
                      </select>
                      <select value={editingFileStatus} onChange={(event) => setEditingFileStatus(event.target.value)} aria-label={`Status for ${file.name}`} className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30">
                        {fileStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <button type="button" disabled={isSavingFileStatus === file.id} onClick={() => void saveFileStatus(file.id)} className="rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{isSavingFileStatus === file.id ? 'Saving…' : 'Save'}</button>
                      <button type="button" onClick={cancelEditingFile} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${meta.chipBg} ${meta.chipText}`}>
                        <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.dot}`} /> {file.status}
                      </span>
                      <button type="button" disabled={file.isFlagged || file.isPenalized} onClick={() => startEditingFile(file)} title={file.isFlagged && file.isPenalized ? 'Flagged and penalized files cannot be edited' : file.isFlagged ? 'Flagged files cannot be edited' : file.isPenalized ? 'Penalized files cannot be edited' : 'Edit file'} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50">Edit status</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default function GameWorkspace({ initialView = 'admin', role = initialView }: { initialView?: 'admin' | 'player'; role?: 'admin' | 'player' }) {
  const [view, setView] = useState<'admin' | 'player'>(role)
  const isAdmin = role === 'admin'
  const [databaseStatus, setDatabaseStatus] = useState<'checking' | 'connected' | 'not-connected'>('checking')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState<{ name: string; email: string; role: string } | null>(null)
  const [autoPenaltyEnabled, setAutoPenaltyEnabled] = useState(true)
  const [isSavingAutoPenalty, setIsSavingAutoPenalty] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const { data } = await supabase.from('profiles').select('display_name, role').eq('id', user.id).maybeSingle()
        if (!cancelled) setProfile({ name: data?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'User', email: user.email || '', role: data?.role || (isAdmin ? 'admin' : 'player') })
      } catch (error) {
        console.error(' Profile loading failed:', error)
      }
    }
    loadProfile()
    return () => { cancelled = true }
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function loadAutoPenaltySetting() {
      const { data, error } = await createClient().from('app_settings').select('key, value_boolean').eq('key', 'auto_penalty_enabled').maybeSingle()
      if (!cancelled && !error && data) setAutoPenaltyEnabled(data.value_boolean)
    }
    void loadAutoPenaltySetting()
    return () => { cancelled = true }
  }, [isAdmin])

  async function handleToggleAutoPenalty() {
    if (isSavingAutoPenalty) return
    const nextValue = !autoPenaltyEnabled
    setIsSavingAutoPenalty(true)
    const { error } = await createClient().from('app_settings').update({ value_boolean: nextValue, updated_at: new Date().toISOString() }).eq('key', 'auto_penalty_enabled')
    if (error) {
      console.error(' Auto penalty setting update failed:', error)
      window.alert('Unable to update Auto Penalty. Please try again.')
    } else {
      setAutoPenaltyEnabled(nextValue)
    }
    setIsSavingAutoPenalty(false)
  }

  async function handleLogout() {
    await createClient().auth.signOut()
    window.location.href = '/auth/login'
  }

  useEffect(() => {
    let cancelled = false

    async function checkDatabaseConnection() {
      try {
        const supabase = createClient()
        const { error: authError } = await supabase.auth.getUser()
        if (authError) throw authError

        const { error: recordsError } = await supabase.from('games').select('id').limit(1)
        if (cancelled) return
        setDatabaseStatus(recordsError ? 'not-connected' : 'connected')
      } catch (error) {
        console.error(' Database connection check failed:', error)
        if (!cancelled) setDatabaseStatus('not-connected')
      }
    }

    checkDatabaseConnection()
    return () => {
      cancelled = true
    }
  }, [])

  const dbChip =
    databaseStatus === 'connected'
      ? { label: 'Connected', dot: 'bg-emerald-500', chipBg: 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/20', chipText: 'text-emerald-700 dark:text-emerald-400' }
      : databaseStatus === 'not-connected'
      ? { label: 'Not connected', dot: 'bg-red-500', chipBg: 'bg-red-500/10 ring-1 ring-inset ring-red-500/20', chipText: 'text-red-700 dark:text-red-400' }
      : { label: 'Checking', dot: 'bg-muted-foreground animate-pulse', chipBg: 'bg-muted', chipText: 'text-muted-foreground' }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col lg:flex-row">
        <aside className={`fixed inset-y-0 left-0 z-20 flex w-72 flex-col border-r border-border bg-card px-5 py-6 transition-transform lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Gamepad2 className="size-5" /></div>
              <div>
                <p className="font-semibold tracking-tight">Frameflow</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Game operations</p>
              </div>
            </div>
            <button className="lg:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X className="size-5" /></button>
          </div>

          <nav className="mt-12 flex flex-col gap-1.5">
            <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
            {isAdmin && (
              <button onClick={() => { setView('admin'); setMobileOpen(false) }} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'admin' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
                <LayoutDashboard className="size-4" /> Admin panel
              </button>
            )}
            {!isAdmin && (
              <button onClick={() => { setView('player'); setMobileOpen(false) }} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'player' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
                <Users className="size-4" /> Player files
              </button>
            )}
          </nav>

          <div className="mt-auto rounded-2xl border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5"><ShieldCheck className="size-5 text-primary" /><p className="text-sm font-semibold">Database</p></div>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${dbChip.chipBg} ${dbChip.chipText}`}>
                <span className={`size-1.5 rounded-full ${dbChip.dot}`} />{dbChip.label}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Live auth and records status</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-20 items-center justify-between border-b border-border px-5 sm:px-8">
            <button className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu className="size-5" /></button>
            <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
              <span>Workspace</span><ArrowUpRight className="size-3" /><span className="font-medium text-foreground">{view === 'admin' ? 'Admin panel' : 'Player files'}</span>
            </div>
  <div className="relative ml-auto flex items-center gap-3">
  {isAdmin && (
    <button type="button" onClick={() => void handleToggleAutoPenalty()} disabled={isSavingAutoPenalty} aria-pressed={autoPenaltyEnabled} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${autoPenaltyEnabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400' : 'border-border bg-secondary text-muted-foreground hover:bg-accent'}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${autoPenaltyEnabled ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
      Auto Penalty: {autoPenaltyEnabled ? 'ON' : 'OFF'}
    </button>
  )}
  <div className="hidden text-right sm:block">
  <p className="text-sm font-medium">{profile?.name ?? 'Account'}</p>
  <p className="text-xs text-muted-foreground">{profile?.email ?? 'Signed in'}</p>
  </div>
  <button type="button" onClick={() => setProfileOpen((open) => !open)} className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-secondary text-primary transition hover:bg-accent" aria-label="Open profile menu" aria-expanded={profileOpen}><UserCircle className="size-5" /></button>
  {profileOpen && <div className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-border bg-card p-4 shadow-xl">
    <div className="flex items-center gap-3 border-b border-border pb-3"><div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"><UserCircle className="size-5" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{profile?.name ?? 'User profile'}</p><p className="truncate text-xs text-muted-foreground">{profile?.email ?? 'No email available'}</p></div></div>
    <div className="flex items-center justify-between py-3 text-sm"><span className="text-muted-foreground">Role</span><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold capitalize text-primary">{profile?.role ?? (isAdmin ? 'admin' : 'player')}</span></div>
    <button type="button" onClick={() => void handleLogout()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-destructive transition hover:bg-destructive/10"><LogIn className="size-4 rotate-180" /> Log out</button>
  </div>}
  </div>
          </header>
          <div className="flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">{view === 'admin' ? <AdminPanel autoPenaltyEnabled={autoPenaltyEnabled} onToggleAutoPenalty={() => void handleToggleAutoPenalty()} /> : <PlayerPanel />}</div>
        </div>
      </div>
    </main>
  )
}

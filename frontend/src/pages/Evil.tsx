import { useMemo, useState } from 'react'
import { apiGet, apiPost } from '../api/http'

type EvilRoomsResponse = {
  rooms: Array<{
    code: string
    ownerId: string
    state: string
    round: number
    drawerId: string | null
    players: Array<{ id: string; name: string; avatar: string; score: number; connected: boolean }>
    wordHint: string | null
    word?: string
  }>
}

type OverrideResponse = {
  ok: boolean
  room: any
}

const TOKEN_KEY = 'drawful.evilToken'

export default function Evil() {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || import.meta.env.VITE_EVIL_TOKEN || ''
    } catch {
      return import.meta.env.VITE_EVIL_TOKEN || ''
    }
  })

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [rooms, setRooms] = useState<EvilRoomsResponse['rooms']>([])

  const headers = useMemo((): Record<string, string> => {
    const h: Record<string, string> = {}
    const t = token.trim()
    if (t) h['X-Evil-Token'] = t
    return h
  }, [token])

  async function loadRooms() {
    setErr('')
    setBusy(true)
    try {
      localStorage.setItem(TOKEN_KEY, token)
      const res = await apiGet<EvilRoomsResponse>('/api/__evil__/rooms', { headers })
      setRooms(res.rooms || [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    } finally {
      setBusy(false)
    }
  }

  async function overrideRoom(code: string, nextWord: string, nextDrawerId: string) {
    setErr('')
    setBusy(true)
    try {
      await apiPost<OverrideResponse>(
        `/api/__evil__/rooms/${encodeURIComponent(code)}/override`,
        {
          nextWord: nextWord.trim() || null,
          nextDrawerId: nextDrawerId.trim() || null,
        },
        { headers }
      )
      await loadRooms()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="text-2xl font-bold">邪恶后台</div>
        <div className="mt-2 text-sm text-slate-400">需要在后端设置环境变量 EVIL_TOKEN，并在此处填写。</div>

        <div className="mt-6 grid gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="grid gap-2">
            <div className="text-sm text-slate-300">X-Evil-Token</div>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-slate-500"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EVIL_TOKEN"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white disabled:opacity-60"
              disabled={busy || !token.trim()}
              onClick={loadRooms}
            >
              刷新房间列表
            </button>
          </div>
          {err ? <div className="text-sm text-red-400">{err}</div> : null}
        </div>

        <div className="mt-6 grid gap-4">
          {rooms.map((r) => (
            <RoomCard key={r.code} room={r} disabled={busy} onOverride={overrideRoom} />
          ))}
        </div>
      </div>
    </div>
  )
}

function RoomCard({
  room,
  disabled,
  onOverride,
}: {
  room: EvilRoomsResponse['rooms'][number]
  disabled: boolean
  onOverride: (code: string, nextWord: string, nextDrawerId: string) => void
}) {
  const [nextWord, setNextWord] = useState('')
  const [nextDrawerId, setNextDrawerId] = useState('')

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-lg font-bold">{room.code}</div>
          <div className="text-sm text-slate-300">
            state={room.state} | round={room.round} | owner={room.ownerId} | drawer={room.drawerId || '-'}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <div className="text-sm font-semibold">玩家</div>
        <div className="grid gap-1">
          {room.players.map((p) => (
            <div key={p.id} className="text-sm text-slate-300">
              {p.name} ({p.id}) score={p.score}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <div className="grid gap-1">
          <div className="text-xs text-slate-400">nextWord</div>
          <input
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            value={nextWord}
            onChange={(e) => setNextWord(e.target.value)}
            placeholder="留空=不覆盖"
          />
        </div>
        <div className="grid gap-1">
          <div className="text-xs text-slate-400">nextDrawerId</div>
          <input
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            value={nextDrawerId}
            onChange={(e) => setNextDrawerId(e.target.value)}
            placeholder="填写 socketId"
          />
        </div>
        <div className="flex items-end">
          <button
            className="w-full rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={disabled}
            onClick={() => onOverride(room.code, nextWord, nextDrawerId)}
          >
            应用覆盖
          </button>
        </div>
      </div>
    </div>
  )
}

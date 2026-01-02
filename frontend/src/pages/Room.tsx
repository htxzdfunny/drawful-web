import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getSocket } from '../realtime/socket'
import { loadProfile, saveProfile } from '../storage/profile'
import type { ChatMessage, RoomState } from '../types/game'
import CanvasBoard, { StrokePayload } from '../ui/CanvasBoard'
import ChatPanel from '../ui/ChatPanel'
import PlayerList from '../ui/PlayerList'

export default function Room() {
  const navigate = useNavigate()
  const params = useParams()
  const roomCode = (params.code || '').trim()
  const [profile, setProfile] = useState(() => loadProfile())

  const [room, setRoom] = useState<RoomState | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [socketId, setSocketId] = useState<string>('')
  const [err, setErr] = useState<string>('')
  const [nowMs, setNowMs] = useState<number>(Date.now())

  const [toast, setToast] = useState<string>('')
  const redirectTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const [roundDurationSecInput, setRoundDurationSecInput] = useState<string>('')
  const [transferOwnerId, setTransferOwnerId] = useState<string>('')

  const [showProfileModal, setShowProfileModal] = useState(false)
  const [editName, setEditName] = useState('')
  const [editAvatar, setEditAvatar] = useState('')

  const [customWordsText, setCustomWordsText] = useState<string>(() => {
    try {
      return localStorage.getItem('drawful.customWords') || ''
    } catch {
      return ''
    }
  })

  const profileReady = !!profile.name.trim() && profile.name.trim() !== '游客' && !!profile.avatar.trim()

  useEffect(() => {
    const initial = loadProfile()
    if (!initial.name || !initial.avatar) {
      setShowProfileModal(true)
      setEditName(initial.name)
      setEditAvatar(initial.avatar)
    } else {
      setProfile(initial)
      setShowProfileModal(false)
    }
  }, [profile.avatar, profile.name, profileReady])

  useEffect(() => {
    if (!room) return
    setRoundDurationSecInput(String(room.roundDurationSec ?? ''))
    setTransferOwnerId('')
  }, [room?.code, room?.roundDurationSec, room?.ownerId])

  useEffect(() => {
    const s = getSocket()

    const onConnect = () => {
      setSocketId(s.id || '')
      if (!profileReady) return
      s.emit('room:join', { roomCode, name: profile.name, avatar: profile.avatar })
    }

    const onRoomState = (payload: RoomState) => {
      setRoom(payload)
    }

    const onRoomError = (payload: any) => {
      const e = String(payload?.error || 'room_error')
      setErr(e)
      if (e === 'room_not_found') {
        setToast('房间不存在，10秒后返回首页')
        if (redirectTimerRef.current) {
          window.clearTimeout(redirectTimerRef.current)
        }
        redirectTimerRef.current = window.setTimeout(() => {
          navigate('/', { replace: true })
        }, 10_000)
      }
    }

    const onChat = (payload: ChatMessage) => {
      setMessages((prev) => [...prev.slice(-199), payload])
    }

    const onChatSync = (payload: any) => {
      if (payload?.roomCode !== roomCode) return
      const msgs = Array.isArray(payload?.messages) ? (payload.messages as ChatMessage[]) : []
      setMessages(msgs.slice(-200))
    }

    const onGuessCorrect = (payload: any) => {
      const by = String(payload?.by || '')
      setMessages((prev) => [
        ...prev.slice(-199),
        { roomCode, from: by || 'system', text: '猜中了！' },
      ])
    }

    const onTick = (payload: any) => {
      if (payload?.roomCode !== roomCode) return
      const n = Number(payload?.nowMs)
      setNowMs(Number.isFinite(n) ? n : Date.now())
    }

    const onReveal = (payload: any) => {
      if (payload?.roomCode !== roomCode) return
      setMessages((prev) => [
        ...prev.slice(-199),
        { roomCode, from: 'system', text: `本回合答案：${payload?.word || ''}` },
      ])
    }

    s.on('connect', onConnect)
    s.on('room:state', onRoomState)
    s.on('room:error', onRoomError)
    s.on('chat:message', onChat)
    s.on('chat:sync', onChatSync)
    s.on('guess:correct', onGuessCorrect)
    s.on('game:tick', onTick)
    s.on('game:reveal', onReveal)

    if (s.connected) {
      onConnect()
    }

    return () => {
      s.emit('room:leave', { roomCode })
      s.off('connect', onConnect)
      s.off('room:state', onRoomState)
      s.off('room:error', onRoomError)
      s.off('chat:message', onChat)
      s.off('chat:sync', onChatSync)
      s.off('guess:correct', onGuessCorrect)
      s.off('game:tick', onTick)
      s.off('game:reveal', onReveal)

      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current)
        redirectTimerRef.current = null
      }

      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = null
      }
    }
  }, [roomCode, profile.avatar, profile.name, profileReady])

  const isOwner = !!room && room.ownerId === socketId
  const isDrawer = !!room && room.drawerId === socketId
  const canDraw = !!room && room.state === 'playing' && isDrawer
  const canAbort = !!room && (room.state === 'choosing' || room.state === 'playing')

  const currentPlayerName = useMemo(() => {
    if (!room) return ''
    const me = room.players.find((p) => p.id === socketId)
    return me?.name || ''
  }, [room, socketId])

  function copyText(text: string) {
    try {
      navigator.clipboard.writeText(text)
    } catch {
    }
  }

  function onCopyRoomId() {
    copyText(roomCode)
  }

  function onCopyLink() {
    copyText(window.location.href)
  }

  function previewAvatarUrl(raw: string): string {
    const a = raw.trim()
    if (/^\d{5,12}$/.test(a)) {
      return `https://q1.qlogo.cn/g?b=qq&nk=${a}&s=640`
    }
    return a
  }

  function saveCustomWords(text: string) {
    setCustomWordsText(text)
    try {
      localStorage.setItem('drawful.customWords', text)
    } catch {
    }
  }

  function parseCustomWords(text: string): string[] {
    return text
      .split(/[\n,，]/g)
      .map((w) => w.trim())
      .filter((w) => w)
      .slice(0, 200)
  }

  function remainingSec(endAtMs: number | null | undefined): number | null {
    if (!endAtMs) return null
    const diff = endAtMs - nowMs
    return Math.max(0, Math.ceil(diff / 1000))
  }

  function onClear() {
    if (!canDraw) return
    const s = getSocket()
    s.emit('draw:clear', { roomCode })
  }

  function onSend(text: string) {
    const s = getSocket()
    s.emit('guess:submit', { roomCode, text })
  }

  function onAbortRound() {
    if (!canAbort) return
    if (!room) return
    const s = getSocket()
    if (isOwner) {
      s.emit('game:abort', { roomCode })
    } else {
      s.emit('game:abort_vote', { roomCode })
    }
  }

  function onStartGame() {
    if (!room) return
    if (!isOwner) return
    if (room.state !== 'lobby') return
    const s = getSocket()
    const customWords = parseCustomWords(customWordsText)
    s.emit('game:start', { roomCode, customWords })
  }

  function onSaveRoundDuration() {
    if (!room) return
    if (!isOwner) return
    const n = Number(roundDurationSecInput)
    if (!Number.isFinite(n)) {
      setErr('invalid_duration')
      return
    }
    const s = getSocket()
    let done = false
    const t = window.setTimeout(() => {
      if (done) return
      setErr('timeout')
      setToast('操作超时：后端未响应（请确认已更新后端并重启服务）')
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = window.setTimeout(() => setToast(''), 2500)
    }, 1500)
    s.emit('room:set_round_duration', { roomCode, roundDurationSec: Math.trunc(n) }, (ack: any) => {
      done = true
      window.clearTimeout(t)
      if (!ack?.ok) {
        setErr(String(ack?.error || 'invalid_duration'))
        return
      }
      setErr('')
      setToast('已保存回合时长')
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = window.setTimeout(() => setToast(''), 1500)
    })
  }

  function onTransferOwner() {
    if (!room) return
    if (!isOwner) return
    const id = transferOwnerId.trim()
    if (!id) return
    const s = getSocket()
    let done = false
    const t = window.setTimeout(() => {
      if (done) return
      setErr('timeout')
      setToast('操作超时：后端未响应（请确认已更新后端并重启服务）')
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = window.setTimeout(() => setToast(''), 2500)
    }, 1500)
    s.emit('room:transfer_owner', { roomCode, newOwnerId: id }, (ack: any) => {
      done = true
      window.clearTimeout(t)
      if (!ack?.ok) {
        setErr(String(ack?.error || 'invalid_target'))
        return
      }
      setErr('')
      setToast('已转让房主')
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = window.setTimeout(() => setToast(''), 1500)
    })
  }

  function onChooseWord(word: string) {
    const s = getSocket()
    s.emit('game:choose_word', { roomCode, word })
  }

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xl font-bold">房间：{roomCode}</div>
              <button
                className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-semibold disabled:opacity-60"
                onClick={onCopyRoomId}
              >
                复制ID
              </button>
              <button
                className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-semibold disabled:opacity-60"
                onClick={onCopyLink}
              >
                复制链接
              </button>
            </div>
            <div className="text-sm text-slate-300">
              你：{currentPlayerName || socketId || '未连接'}
              {room?.wordHint ? ` | 词条：${room.wordHint}（${room.wordHint.length}个字）` : ''}
              {room?.word ? ` | 你是画手，答案：${room.word}` : ''}
              {room?.state ? ` | 状态：${room.state}` : ''}
              {room?.state === 'choosing' && room?.chooseEndsAtMs
                ? ` | 选词倒计时：${remainingSec(room.chooseEndsAtMs)}s`
                : ''}
              {room?.state === 'playing' && room?.roundEndsAtMs
                ? ` | 回合倒计时：${remainingSec(room.roundEndsAtMs)}s`
                : ''}
              {room?.state === 'reveal' && room?.revealEndsAtMs
                ? ` | 揭晓倒计时：${remainingSec(room.revealEndsAtMs)}s`
                : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold"
              onClick={() => navigate('/', { replace: true })}
            >
              返回首页
            </button>
            <button
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onClear}
              disabled={!canDraw}
              title={!canDraw ? '仅画手在回合中可清屏' : ''}
            >
              清屏
            </button>
            <button
              className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onAbortRound}
              disabled={!room || !canAbort}
              title={!room ? '' : !canAbort ? '仅回合中可用' : isOwner ? '房主可直接终止本回合' : '投票终止本回合（>2/3 同意自动终止）'}
            >
              {isOwner ? '终止回合' : '投票终止'}
              {room && room.abortVotesCount != null && room.abortVotesNeeded != null
                ? `（${room.abortVotesCount}/${room.abortVotesNeeded}）`
                : ''}
            </button>
            <button
              className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onStartGame}
              disabled={!room || !isOwner || room.state !== 'lobby'}
              title={!room ? '' : !isOwner ? '仅房主可开始' : room.state !== 'lobby' ? '进行中不可开始' : ''}
            >
              开始回合
            </button>
          </div>
        </div>

        {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

        {room && isOwner ? (
          <div className="mt-4 grid gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-sm font-semibold">回合时长（秒）</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  value={roundDurationSecInput}
                  onChange={(e) => setRoundDurationSecInput(e.target.value)}
                  placeholder="60"
                />
                <button
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold"
                  onClick={onSaveRoundDuration}
                  disabled={!roundDurationSecInput.trim()}
                >
                  保存
                </button>
                <div className="text-xs text-slate-400">范围：10-300</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-sm font-semibold">转让房主</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  value={transferOwnerId}
                  onChange={(e) => setTransferOwnerId(e.target.value)}
                >
                  <option value="">选择玩家</option>
                  {(room.players || [])
                    .filter((p) => p.id !== room.ownerId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <button
                  className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={!transferOwnerId}
                  onClick={onTransferOwner}
                >
                  转让
                </button>
              </div>
            </div>

            {room.state === 'lobby' ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-sm font-semibold">自定义词库（房主可配置，逗号或换行分隔）</div>
                <textarea
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  rows={3}
                  value={customWordsText}
                  onChange={(e) => saveCustomWords(e.target.value)}
                  placeholder="例如：火锅, 乒乓球\n耳机\n钢琴"
                />
                <div className="mt-1 text-xs text-slate-400">当前词条数：{parseCustomWords(customWordsText).length}（最多 200）</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {room && room.state === 'choosing' && isDrawer ? (
          <div className="mt-4 rounded-xl border border-indigo-800 bg-indigo-950/30 p-3">
            <div className="text-sm font-semibold">你是画手：请选择一个词</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(room.wordChoices || []).map((w) => (
                <button
                  key={w}
                  className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white"
                  onClick={() => onChooseWord(w)}
                >
                  {w}
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-300">不选会在倒计时结束后自动选第一个</div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <CanvasBoard roomCode={roomCode} onStroke={() => {}} enabled={canDraw} />
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <PlayerList room={room} socketId={socketId} />
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <ChatPanel messages={messages} onSend={onSend} players={room?.players} />
            </div>
          </div>
        </div>
      </div>

      {showProfileModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="text-lg font-bold">进入房间前请设置资料</div>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-1">
                <div className="text-sm text-slate-300">昵称</div>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-slate-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="请输入昵称"
                />
              </div>
              <div className="grid gap-1">
                <div className="text-sm text-slate-300">头像（QQ号 / URL / Emoji）</div>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-slate-500"
                  value={editAvatar}
                  onChange={(e) => setEditAvatar(e.target.value)}
                  placeholder="例如：12345678 或 https://... 或 😀"
                />
                {editAvatar.trim() ? (
                  <img src={previewAvatarUrl(editAvatar)} alt="avatar" className="mt-2 h-12 w-12 rounded-full" />
                ) : null}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  className="rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white disabled:opacity-60"
                  disabled={!editName.trim() || !editAvatar.trim()}
                  onClick={() => {
                    saveProfile({ name: editName.trim(), avatar: editAvatar.trim() })
                    const p = loadProfile()
                    setProfile(p)
                    setShowProfileModal(false)
                    const s = getSocket()
                    if (s.connected) {
                      s.emit('room:join', { roomCode, name: p.name, avatar: p.avatar })
                    }
                  }}
                >
                  保存并进入
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 text-sm text-slate-100 shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createRoom } from '../api/rooms'
import { loadProfile, saveProfile } from '../storage/profile'

export default function Home() {
  const navigate = useNavigate()
  const initial = useMemo(() => loadProfile(), [])
  const [name, setName] = useState(initial.name)
  const [avatar, setAvatar] = useState(initial.avatar)
  const [roomCode, setRoomCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function persistProfile() {
    saveProfile({ name: name.trim() || '游客', avatar: avatar.trim() })
  }

  async function onCreate() {
    setErr('')
    setBusy(true)
    try {
      persistProfile()
      const res = await createRoom()
      navigate(`/room/${res.roomCode}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建房间失败')
    } finally {
      setBusy(false)
    }
  }

  function onJoin() {
    setErr('')
    persistProfile()
    const code = roomCode.trim()
    if (!code) {
      setErr('请输入房间码')
      return
    }
    navigate(`/room/${encodeURIComponent(code)}`)
  }

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="text-3xl font-bold">你画我猜</div>
        <div className="mt-2 text-slate-300">赶工写的问题很多</div>

        <div className="mt-8 grid gap-6 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="grid gap-2">
            <div className="text-sm text-slate-300">昵称</div>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-slate-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={persistProfile}
            />
          </div>

          <div className="grid gap-2">
            <div className="text-sm text-slate-300">头像（直接填写QQ号 / URL / Emoji均可）</div>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-slate-500"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              onBlur={persistProfile}
              placeholder="https://... 或 😀"
            />
            <div className="text-sm text-slate-400">会保存到 localStorage，其他人可见</div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <button
              disabled={busy}
              className="rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white disabled:opacity-60"
              onClick={onCreate}
            >
              创建房间
            </button>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-slate-500"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="输入房间码"
              />
              <button
                className="rounded-lg bg-slate-800 px-4 py-2 font-semibold text-slate-100"
                onClick={onJoin}
              >
                加入
              </button>
            </div>
          </div>

          {err ? <div className="text-sm text-red-400">{err}</div> : null}
        </div>
      </div>
    </div>
  )
}

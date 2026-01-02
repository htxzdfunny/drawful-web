import type { RoomState } from '../types/game'

export default function PlayerList({
  room,
  socketId,
}: {
  room: RoomState | null
  socketId: string
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">玩家</div>
        <div className="text-xs text-slate-400">在线：{room?.players?.length || 0}</div>
      </div>

      <div className="grid gap-2">
        {(room?.players || []).map((p) => {
          const isMe = p.id === socketId
          const isOwner = room?.ownerId === p.id
          const isDrawer = room?.drawerId === p.id

          return (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 overflow-hidden rounded-full bg-slate-800 text-center leading-7">
                  {p.avatar ? (
                    p.avatar.startsWith('http') ? (
                      <img className="h-7 w-7 object-cover" src={p.avatar} alt="" />
                    ) : (
                      <span>{p.avatar}</span>
                    )
                  ) : (
                    <span>?</span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold">
                    {p.name}
                    {isMe ? <span className="ml-2 text-xs text-slate-400">(你)</span> : null}
                  </div>
                  <div className="text-xs text-slate-400">
                    {isOwner ? '房主' : ''}
                    {isOwner && isDrawer ? ' / ' : ''}
                    {isDrawer ? '画手' : ''}
                  </div>
                </div>
              </div>
              <div className="text-sm font-semibold">{p.score}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

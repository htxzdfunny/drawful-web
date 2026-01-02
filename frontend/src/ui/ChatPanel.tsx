import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, Player } from '../types/game'

export default function ChatPanel({
  messages,
  onSend,
  players,
}: {
  messages: ChatMessage[]
  onSend: (text: string) => void
  players?: Player[]
}) {
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of players || []) {
      m.set(p.id, p.name)
    }
    return m
  }, [players])

  function displayFrom(from: string): string {
    if (from === 'system') return '系统'
    return nameMap.get(from) || from
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length])

  return (
    <div className="grid h-[420px] grid-rows-[auto_1fr_auto] gap-3">
      <div className="font-semibold">聊天 / 猜词</div>
      <div
        ref={listRef}
        className="min-h-0 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-2"
      >
        <div className="grid gap-2">
          {messages.map((m, idx) => (
            <div key={idx} className="text-sm">
              <span className="text-slate-400">{displayFrom(m.from)}：</span>
              <span className="text-slate-100">{m.text}</span>
            </div>
          ))}
        </div>
      </div>
      <form
        className="grid grid-cols-[1fr_auto] gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (!t) return
          onSend(t)
          setText('')
        }}
      >
        <input
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-slate-500"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入猜测（直接回车发送）"
        />
        <button className="rounded-lg bg-slate-800 px-4 py-2 font-semibold" type="submit">
          发送
        </button>
      </form>
    </div>
  )
}

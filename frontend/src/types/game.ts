export type Player = {
  id: string
  name: string
  avatar: string
  score: number
  connected: boolean
}

export type RoomState = {
  code: string
  ownerId: string
  state: 'lobby' | 'choosing' | 'playing' | 'reveal'
  round: number
  drawerId: string | null
  roundDurationSec: number
  startedAtMs: number | null
  chooseEndsAtMs: number | null
  roundEndsAtMs: number | null
  revealEndsAtMs: number | null
  players: Player[]
  wordHint: string | null
  abortVotesCount?: number
  abortVotesNeeded?: number
  word?: string
  wordChoices?: string[]
}

export type ChatMessage = {
  roomCode: string
  from: string
  text: string
}

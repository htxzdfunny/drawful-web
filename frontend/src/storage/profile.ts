export type Profile = {
  name: string
  avatar: string
  playerKey: string
}

const KEY = 'drawful.profile'

function createPlayerKey(): string {
  try {
    const c = crypto as any
    if (c?.randomUUID) return String(c.randomUUID())
  } catch {
  }
  return `pk_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function normalizeAvatar(avatar: string): string {
  const a = avatar.trim()
  if (/^\d{5,12}$/.test(a)) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${a}&s=640`
  }
  return ''
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as Partial<Profile>
      return {
        name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '游客',
        avatar: typeof data.avatar === 'string' ? normalizeAvatar(data.avatar) : '',
        playerKey: typeof (data as any).playerKey === 'string' && String((data as any).playerKey).trim() ? String((data as any).playerKey).trim() : createPlayerKey(),
      }
    }
  } catch {
  }
  return { name: '游客', avatar: '', playerKey: createPlayerKey() }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({ name: p.name, avatar: normalizeAvatar(p.avatar), playerKey: p.playerKey || createPlayerKey() })
  )
}

export type Profile = {
  name: string
  avatar: string
}

const KEY = 'drawful.profile'

function normalizeAvatar(avatar: string): string {
  const a = avatar.trim()
  if (/^\d{5,12}$/.test(a)) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${a}&s=640`
  }
  return a
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as Partial<Profile>
      return {
        name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '游客',
        avatar: typeof data.avatar === 'string' ? normalizeAvatar(data.avatar) : '',
      }
    }
  } catch {
  }
  return { name: '游客', avatar: '' }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify({ name: p.name, avatar: normalizeAvatar(p.avatar) }))
}

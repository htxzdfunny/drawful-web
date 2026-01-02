export async function apiGet<T>(path: string, options?: { headers?: Record<string, string> }): Promise<T> {
  const res = await fetch(path, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  })
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`)
  }
  return (await res.json()) as T
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options?: { headers?: Record<string, string> }
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`)
  }
  return (await res.json()) as T
}

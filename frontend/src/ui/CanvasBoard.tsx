import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import { getSocket } from '../realtime/socket'

export type Point = { x: number; y: number }

export type StrokePayload = {
  points: Point[]
  color: string
  size: number
  tool: 'pen' | 'eraser'
}

class CanvasBoardErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state: { hasError: boolean } = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

export default function CanvasBoard({
  roomCode,
  onStroke,
  enabled = true,
}: {
  roomCode: string
  onStroke: (payload: StrokePayload) => void
  enabled?: boolean
}) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null)
  const lastSyncedElements = useRef<readonly any[]>([])
  const lastSentVersionRef = useRef<Map<string, { version: number; versionNonce: number }>>(new Map())
  const isApplyingRemote = useRef(false)
  const suppressUntilMsRef = useRef<number>(0)
  const initialized = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [canMount, setCanMount] = useState(false)
  const [mountError, setMountError] = useState<string>('')

  const s = useMemo(() => getSocket(), [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const check = () => {
      const rect = el.getBoundingClientRect()
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
      const pxW = Math.floor(rect.width * dpr)
      const pxH = Math.floor(rect.height * dpr)
      const area = pxW * pxH

      if (!Number.isFinite(pxW) || !Number.isFinite(pxH) || pxW <= 0 || pxH <= 0) {
        setCanMount(false)
        return
      }

      if (pxW > 8192 || pxH > 8192 || area > 64_000_000) {
        const msg = `canvas_too_large px=${pxW}x${pxH} dpr=${dpr} css=${Math.floor(rect.width)}x${Math.floor(rect.height)}`
        setMountError(msg)
        setCanMount(false)
        try {
          console.error('[CanvasBoard] refusing to mount Excalidraw:', msg)
        } catch {
        }
        return
      }

      setMountError('')
      setCanMount(true)
    }

    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    window.addEventListener('orientationchange', check)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', check)
    }
  }, [])

  useEffect(() => {
    if (!excalidrawAPI || initialized.current) return
    initialized.current = true
    
    try {
      excalidrawAPI.updateScene({
        appState: {
          viewBackgroundColor: '#ffffff',
        },
      })
    } catch (e) {
      console.warn('Failed to init Excalidraw scene:', e)
    }
  }, [excalidrawAPI])

  function handleChange(elements: readonly any[]) {
    if (isApplyingRemote.current) return
    if (Date.now() < suppressUntilMsRef.current) return
    if (!enabled) return
    if (!excalidrawAPI) return

    const changed: any[] = []
    for (const el of elements) {
      const id = el?.id
      if (typeof id !== 'string' || !id) continue
      const version = Number(el?.version)
      const versionNonce = Number(el?.versionNonce)
      if (!Number.isFinite(version) || !Number.isFinite(versionNonce)) continue

      const prev = lastSentVersionRef.current.get(id)
      if (!prev || prev.version !== version || prev.versionNonce !== versionNonce) {
        changed.push(el)
      }
    }

    if (changed.length === 0) return

    for (const el of changed) {
      const id = el?.id
      if (typeof id !== 'string' || !id) continue
      const version = Number(el?.version)
      const versionNonce = Number(el?.versionNonce)
      if (!Number.isFinite(version) || !Number.isFinite(versionNonce)) continue
      lastSentVersionRef.current.set(id, { version, versionNonce })
    }

    lastSyncedElements.current = elements
    s.emit('draw:excalidraw_change', { roomCode, elements: changed })
  }

  function applySyncedElements(elements: any) {
    if (!excalidrawAPI) return
    if (!Array.isArray(elements)) return

    isApplyingRemote.current = true
    suppressUntilMsRef.current = Date.now() + 200
    try {
      const current = excalidrawAPI.getSceneElements()
      const merged = [...current]

      for (const el of elements) {
        const idx = merged.findIndex((m) => m.id === el.id)
        if (idx >= 0) {
          merged[idx] = el
        } else {
          merged.push(el)
        }
      }

      excalidrawAPI.updateScene({ elements: merged })
      lastSyncedElements.current = merged

      for (const el of elements) {
        const id = el?.id
        if (typeof id !== 'string' || !id) continue
        const version = Number(el?.version)
        const versionNonce = Number(el?.versionNonce)
        if (!Number.isFinite(version) || !Number.isFinite(versionNonce)) continue
        lastSentVersionRef.current.set(id, { version, versionNonce })
      }
    } finally {
      isApplyingRemote.current = false
    }
  }

  function clearBoard() {
    if (!excalidrawAPI) return
    isApplyingRemote.current = true
    suppressUntilMsRef.current = Date.now() + 200
    try {
      excalidrawAPI.updateScene({ elements: [] })
      lastSyncedElements.current = []
      lastSentVersionRef.current = new Map()
    } finally {
      isApplyingRemote.current = false
    }
  }

  useEffect(() => {
    const onRemoteChange = (payload: any) => {
      if (payload?.roomCode !== roomCode) return
      applySyncedElements(payload?.elements)
    }

    const onRemoteClear = (payload: any) => {
      if (payload?.roomCode !== roomCode) return
      clearBoard()
    }

    const onSync = (payload: any) => {
      if (payload?.roomCode !== roomCode) return
      if (Array.isArray(payload?.elements)) {
        applySyncedElements(payload.elements)
      }
    }

    s.on('draw:excalidraw_change', onRemoteChange)
    s.on('draw:clear', onRemoteClear)
    s.on('draw:sync', onSync)

    return () => {
      s.off('draw:excalidraw_change', onRemoteChange)
      s.off('draw:clear', onRemoteClear)
      s.off('draw:sync', onSync)
    }
  }, [roomCode, s, excalidrawAPI])

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm font-semibold">画板</div>
        {!enabled ? (
          <div className="text-xs text-slate-400">等待画手绘制…</div>
        ) : null}
      </div>

      <div ref={containerRef} className="rounded-lg border border-slate-800 bg-white" style={{ height: '480px' }}>
        {!canMount ? (
          <div className="grid h-full place-items-center p-4 text-sm text-slate-700">
            <div className="grid gap-2 text-center">
              <div className="font-semibold">画板加载中…</div>
              {mountError ? <div className="break-all text-xs">{mountError}</div> : null}
            </div>
          </div>
        ) : (
          <CanvasBoardErrorBoundary
            fallback={
              <div className="grid h-full place-items-center p-4 text-sm text-slate-700">
                <div className="grid gap-2 text-center">
                  <div className="font-semibold">画板渲染失败</div>
                  <div className="text-xs">请刷新页面或更换浏览器</div>
                </div>
              </div>
            }
          >
            <Excalidraw
              excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
              onChange={(elements: any) => handleChange(elements)}
              viewModeEnabled={!enabled}
              zenModeEnabled={false}
              gridModeEnabled={false}
              theme="light"
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  export: false,
                  saveAsImage: false,
                },
              }}
            />
          </CanvasBoardErrorBoundary>
        )}
      </div>
    </div>
  )
}

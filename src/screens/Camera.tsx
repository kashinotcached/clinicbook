import { useCallback, useEffect, useRef, useState } from 'react'
import { db, newId } from '../db'

export interface Shot {
  key: string
  area: string
  file: File
  url: string
}

/** Last photo of this area from an earlier visit, shown faintly so each angle can be lined up the same way. */
function useGhost(patientId: string, visitId: string, area: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let u: string | null = null
    let live = true
    ;(async () => {
      const list = await db.photos.where('patientId').equals(patientId).toArray()
      const last = list.filter((p) => p.area === area && p.visitId !== visitId).sort((a, b) => b.takenAt - a.takenAt)[0]
      const blob = last && (await db.photoBlobs.get(last.id))
      if (!live) return
      if (blob) {
        u = URL.createObjectURL(blob.full)
        setUrl(u)
      } else setUrl(null)
    })()
    return () => {
      live = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [patientId, visitId, area])
  return url
}

export function Camera({
  areas,
  startArea,
  patientId,
  visitId,
  onDone,
  onClose,
}: {
  areas: string[]
  startArea: string
  patientId: string
  visitId: string
  onDone: (shots: Shot[]) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [area, setArea] = useState(startArea)
  const [shots, setShotsState] = useState<Shot[]>([])
  // the ref always holds the latest list, so Done can read it right after the last JPEG is ready
  const shotsRef = useRef<Shot[]>([])
  const setShots = (fn: (s: Shot[]) => Shot[]) => {
    shotsRef.current = fn(shotsRef.current)
    setShotsState(shotsRef.current)
  }
  const [flash, setFlash] = useState(false)
  const [ghostOn, setGhostOn] = useState(true)
  const ghost = useGhost(patientId, visitId, area)

  useEffect(() => {
    let stream: MediaStream | null = null
    let live = true
    setReady(false)
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } },
          audio: false,
        })
        if (!live) return stream.getTracks().forEach((t) => t.stop())
        if (video.current) {
          video.current.srcObject = stream
          await video.current.play().catch(() => {})
        }
        setError('')
      } catch (e) {
        const name = (e as Error).name
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission was refused. Allow the camera for this app in the phone settings, or use the button below.'
            : 'The camera could not be opened here. Use the button below to take or choose photos instead.',
        )
      }
    })()
    return () => {
      live = false
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  // shots still being turned into JPEGs; Done waits for them so a quick last tap is not lost
  const inFlight = useRef(new Set<Promise<void>>())
  const [saving, setSaving] = useState(0)

  const capture = useCallback(() => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0) // the frame is grabbed now, at the tap
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    navigator.vibrate?.(30)
    const shotArea = area
    const job = new Promise<void>((resolve) =>
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const file = new File([blob], `${shotArea}.jpg`, { type: 'image/jpeg' })
            setShots((s) => [...s, { key: newId(), area: shotArea, file, url: URL.createObjectURL(file) }])
          }
          resolve()
        },
        'image/jpeg',
        0.92,
      ),
    )
    inFlight.current.add(job)
    setSaving((n) => n + 1)
    job.then(() => {
      inFlight.current.delete(job)
      setSaving((n) => n - 1)
    })
  }, [area])

  async function finish() {
    await Promise.all([...inFlight.current])
    onDone(shotsRef.current)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        capture()
      }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [capture, onClose])

  function addFiles(files: FileList | null) {
    if (!files) return
    setShots((s) => [...s, ...Array.from(files).map((file) => ({ key: newId(), area, file, url: URL.createObjectURL(file) }))])
  }

  function close() {
    if (shots.length && !confirm(`Discard ${shots.length} photo(s)?`)) return
    shots.forEach((s) => URL.revokeObjectURL(s.url))
    onClose()
  }

  const idx = areas.indexOf(area)
  const count = (a: string) => shots.filter((s) => s.area === a).length

  return (
    <div className="camera" role="dialog" aria-modal aria-label="Camera">
      <div className="cam-top">
        <button className="cam-btn" onClick={close}>
          ✕
        </button>
        <strong>{area}</strong>
        <button className="cam-btn done" onClick={finish} disabled={!shots.length && !saving}>
          {saving ? 'Saving…' : `Done (${shots.length})`}
        </button>
      </div>

      <div className="cam-view" onClick={() => !error && capture()}>
        <video ref={video} playsInline muted onLoadedMetadata={() => setReady(true)} className={facing === 'user' ? 'mirror' : ''} />
        {ghost && ghostOn && ready && <img className="ghost" src={ghost} alt="" />}
        {flash && <div className="cam-flash" />}
        {error && (
          <div className="cam-error">
            <p>{error}</p>
            <label className="cam-btn">
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addFiles(e.target.files)} />
              Take / choose photos
            </label>
          </div>
        )}
      </div>

      <div className="cam-areas" role="tablist">
        {areas.map((a) => (
          <button key={a} role="tab" aria-selected={a === area} onClick={() => setArea(a)}>
            {a}
            {count(a) > 0 && <span className="badge">{count(a)}</span>}
          </button>
        ))}
      </div>

      {shots.length > 0 && (
        <div className="cam-strip">
          {shots.map((s) => (
            <button
              key={s.key}
              className="cam-thumb"
              aria-label="Remove photo"
              onClick={() => {
                URL.revokeObjectURL(s.url)
                setShots((all) => all.filter((x) => x.key !== s.key))
              }}
            >
              <img src={s.url} alt={s.area} />
              <span>✕</span>
            </button>
          ))}
        </div>
      )}

      <div className="cam-controls">
        <button
          className={'cam-btn' + (ghostOn ? ' on' : '')}
          onClick={() => setGhostOn(!ghostOn)}
          disabled={!ghost}
          title="Show the last photo of this area faintly, to line up the same angle"
        >
          {ghost ? (ghostOn ? 'Last photo: on' : 'Last photo: off') : 'No earlier photo'}
        </button>
        <button className="shutter" aria-label="Take photo" onClick={capture} disabled={!!error} />
        {idx < areas.length - 1 ? (
          <button className="cam-btn" onClick={() => setArea(areas[idx + 1])}>
            Next area ›
          </button>
        ) : (
          <button className="cam-btn" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}>
            Flip camera
          </button>
        )}
      </div>
      <label className="cam-upload">
        <input type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        Or upload photos for “{area}” from the gallery
      </label>
    </div>
  )
}

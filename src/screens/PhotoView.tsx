import { useEffect, useState } from 'react'
import { db, type Photo } from '../db'

export function useBlobUrl(id: string, which: 'thumb' | 'full') {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let u: string | null = null
    let live = true
    db.photoBlobs.get(id).then((b) => {
      if (!b || !live) return
      u = URL.createObjectURL(b[which])
      setUrl(u)
    })
    return () => {
      live = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [id, which])
  return url
}

export function Thumb({ photo, onClick }: { photo: Photo; onClick?: () => void }) {
  const url = useBlobUrl(photo.id, 'thumb')
  return (
    <button type="button" className="thumb" onClick={onClick} aria-label={photo.area}>
      {url ? <img src={url} alt={photo.area} loading="lazy" /> : <span className="thumb-missing">not on this phone</span>}
      <span className="thumb-label">{photo.area}</span>
    </button>
  )
}

/** Full-screen viewer; arrows step through the list (e.g. one head area across visits). */
export function PhotoViewer({
  list,
  index,
  caption,
  onClose,
  onDelete,
}: {
  list: Photo[]
  index: number
  caption: (p: Photo) => string
  onClose: () => void
  onDelete?: (p: Photo) => void
}) {
  const [i, setI] = useState(index)
  const photo = list[i]
  const url = useBlobUrl(photo?.id ?? '', 'full')
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1))
      if (e.key === 'ArrowRight') setI((n) => Math.min(list.length - 1, n + 1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [list.length, onClose])
  if (!photo) return null
  return (
    <div className="viewer" role="dialog" aria-modal>
      <div className="viewer-top">
        <span>
          {caption(photo)} · {i + 1}/{list.length}
        </span>
        <div>
          {onDelete && (
            <button
              className="viewer-btn"
              onClick={() => {
                if (confirm('Delete this photo?')) onDelete(photo)
              }}
            >
              Delete
            </button>
          )}
          <button className="viewer-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="viewer-img">{url ? <img src={url} alt={photo.area} /> : <p>Photo not on this phone.</p>}</div>
      <div className="viewer-nav">
        <button disabled={i === 0} onClick={() => setI(i - 1)}>
          ‹ Earlier
        </button>
        <button disabled={i === list.length - 1} onClick={() => setI(i + 1)}>
          Later ›
        </button>
      </div>
    </div>
  )
}

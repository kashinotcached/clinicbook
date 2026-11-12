import { db, newId, type Photo } from './db'

async function resize(file: Blob, maxSide: number, quality: number): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the photo'))), 'image/jpeg', quality),
  )
}

/** Phone photos are 3–6 MB; stored at 1600px they are ~250 KB and still sharp enough to compare. */
export async function addPhoto(patientId: string, visitId: string, area: string, file: Blob): Promise<Photo> {
  const [full, thumb] = await Promise.all([resize(file, 1600, 0.82), resize(file, 320, 0.7)])
  const photo: Photo = { id: newId(), patientId, visitId, area, takenAt: Date.now(), bytes: full.size }
  await db.transaction('rw', db.photos, db.photoBlobs, async () => {
    await db.photos.add(photo)
    await db.photoBlobs.add({ id: photo.id, full, thumb })
  })
  return photo
}

export async function removePhoto(id: string) {
  await db.transaction('rw', db.photos, db.photoBlobs, async () => {
    await db.photos.delete(id)
    await db.photoBlobs.delete(id)
  })
}

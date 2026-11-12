// Draws the app icon (white medical cross on teal) as PNGs, no image tools needed.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}

function icon(size, { maskable }) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const r = size * (maskable ? 0 : 0.22) // rounded corners unless maskable
  const arm = size * (maskable ? 0.12 : 0.15)
  const len = size * (maskable ? 0.27 : 0.33)
  const c = size / 2
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4
      // rounded square mask
      const dx = Math.max(r - x, x - (size - 1 - r), 0)
      const dy = Math.max(r - y, y - (size - 1 - r), 0)
      const inside = dx * dx + dy * dy <= r * r
      const cross = (Math.abs(x - c) < arm && Math.abs(y - c) < len) || (Math.abs(y - c) < arm && Math.abs(x - c) < len)
      const [R, G, B] = cross ? [255, 255, 255] : [15, 118, 110]
      raw[i] = R; raw[i + 1] = G; raw[i + 2] = B; raw[i + 3] = inside ? 255 : 0
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/icon-192.png', icon(192, { maskable: false }))
writeFileSync('public/icon-512.png', icon(512, { maskable: false }))
writeFileSync('public/icon-maskable-512.png', icon(512, { maskable: true }))
writeFileSync('public/apple-touch-icon.png', icon(180, { maskable: true }))
console.log('icons written')

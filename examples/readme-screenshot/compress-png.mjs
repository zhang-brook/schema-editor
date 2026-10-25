#!/usr/bin/env node
// Post-processes the captured screenshot: optional downscale, then an indexed-palette
// re-encode (the same idea TinyPNG uses). UI screenshots have few distinct colors, so a
// palette plus better filtering shrinks them a lot while keeping text edges crisp.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { constants, deflateSync, inflateSync } from 'node:zlib'

const args = process.argv.slice(2)
const takeOption = (name) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = args[index + 1]
  args.splice(index, 2)
  return value
}
const colorsOption = takeOption('colors')
const scaleOption = takeOption('scale')
const [inputPath, maybeOutputPath = inputPath] = args
if (inputPath === undefined) {
  console.error('usage: node compress-png.mjs <input.png> [output.png] [--colors N] [--scale 0.5]')
  process.exit(1)
}
const maxColors = colorsOption === undefined ? 256 : Number(colorsOption)
if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 256) {
  throw new Error('--colors must be an integer between 2 and 256')
}
const scale = scaleOption === undefined ? 1 : Number(scaleOption)
if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
  throw new Error('--scale must be greater than 0 and at most 1')
}

const paeth = (left, up, upLeft) => {
  const estimate = left + up - upLeft
  const toLeft = Math.abs(estimate - left)
  const toUp = Math.abs(estimate - up)
  const toUpLeft = Math.abs(estimate - upLeft)
  if (toLeft <= toUp && toLeft <= toUpLeft) return left
  return toUp <= toUpLeft ? up : upLeft
}

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let header
  const idat = []
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (header === undefined) throw new Error('PNG has no IHDR')
  if (header.bitDepth !== 8 || (header.colorType !== 2 && header.colorType !== 6) || header.interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${header.bitDepth}, color type ${header.colorType})`)
  }

  const { width, height } = header
  const bpp = header.colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(stride * height)
  let pos = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]
    pos += 1
    const rowStart = y * stride
    const previousStart = rowStart - stride
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? pixels[rowStart + x - bpp] : 0
      const up = y > 0 ? pixels[previousStart + x] : 0
      const upLeft = y > 0 && x >= bpp ? pixels[previousStart + x - bpp] : 0
      let value
      switch (filter) {
        case 0: value = raw[pos]; break
        case 1: value = raw[pos] + left; break
        case 2: value = raw[pos] + up; break
        case 3: value = raw[pos] + ((left + up) >> 1); break
        case 4: value = raw[pos] + paeth(left, up, upLeft); break
        default: throw new Error(`unsupported row filter ${filter}`)
      }
      pixels[rowStart + x] = value & 0xff
      pos += 1
    }
  }
  return { width, height, bpp, pixels }
}

function toRgb({ width, height, bpp, pixels }) {
  if (bpp === 3) return pixels
  const rgb = Buffer.alloc(width * height * 3)
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 3) {
    const alpha = pixels[source + 3] / 255
    for (let channel = 0; channel < 3; channel += 1) {
      // Screenshots are opaque; composite any stray transparency onto white.
      rgb[target + channel] = Math.round(pixels[source + channel] * alpha + 255 * (1 - alpha))
    }
  }
  return rgb
}

// Area-averaged downscale. The page is captured wider than the final image so every
// column fits, and averaging the extra pixels keeps text edges clean at the smaller size.
function downscaleRgb(rgb, width, height, factor) {
  if (factor === 1) return { width, height, rgb }
  const targetWidth = Math.max(1, Math.round(width * factor))
  const targetHeight = Math.max(1, Math.round(height * factor))
  const output = Buffer.alloc(targetWidth * targetHeight * 3)
  const xRatio = width / targetWidth
  const yRatio = height / targetHeight
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const sourceTop = ty * yRatio
    const sourceBottom = Math.min(height, (ty + 1) * yRatio)
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const sourceLeft = tx * xRatio
      const sourceRight = Math.min(width, (tx + 1) * xRatio)
      const xStart = Math.floor(sourceLeft)
      const xEnd = Math.ceil(sourceRight)
      let red = 0
      let green = 0
      let blue = 0
      let total = 0
      for (let sy = Math.floor(sourceTop); sy < Math.ceil(sourceBottom); sy += 1) {
        const yWeight = Math.min(sourceBottom, sy + 1) - Math.max(sourceTop, sy)
        for (let sx = xStart; sx < xEnd; sx += 1) {
          const weight = (Math.min(sourceRight, sx + 1) - Math.max(sourceLeft, sx)) * yWeight
          const source = (sy * width + sx) * 3
          red += rgb[source] * weight
          green += rgb[source + 1] * weight
          blue += rgb[source + 2] * weight
          total += weight
        }
      }
      const target = (ty * targetWidth + tx) * 3
      output[target] = Math.round(red / total)
      output[target + 1] = Math.round(green / total)
      output[target + 2] = Math.round(blue / total)
    }
  }
  return { width: targetWidth, height: targetHeight, rgb: output }
}

function buildHistogram(rgb) {
  const counts = new Map()
  for (let i = 0; i < rgb.length; i += 3) {
    const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const colors = new Uint8Array(counts.size * 3)
  const weights = new Uint32Array(counts.size)
  const keys = new Uint32Array(counts.size)
  let index = 0
  for (const [key, weight] of counts) {
    keys[index] = key
    colors[index * 3] = (key >> 16) & 0xff
    colors[index * 3 + 1] = (key >> 8) & 0xff
    colors[index * 3 + 2] = key & 0xff
    weights[index] = weight
    index += 1
  }
  return { keys, colors, weights }
}

function boxRange(indices, colors) {
  let minR = 255
  let maxR = 0
  let minG = 255
  let maxG = 0
  let minB = 255
  let maxB = 0
  for (const i of indices) {
    const r = colors[i * 3]
    const g = colors[i * 3 + 1]
    const b = colors[i * 3 + 2]
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (g < minG) minG = g
    if (g > maxG) maxG = g
    if (b < minB) minB = b
    if (b > maxB) maxB = b
  }
  return [maxR - minR, maxG - minG, maxB - minB]
}

function splitBox(indices, colors, weights) {
  const ranges = boxRange(indices, colors)
  const channel = ranges.indexOf(Math.max(...ranges))
  const sorted = Array.from(indices).sort((a, b) => colors[a * 3 + channel] - colors[b * 3 + channel])
  let total = 0
  for (const i of sorted) total += weights[i]
  let accumulated = 0
  let cut = 1
  for (let k = 0; k < sorted.length - 1; k += 1) {
    accumulated += weights[sorted[k]]
    if (accumulated * 2 >= total) {
      cut = k + 1
      break
    }
  }
  return [Uint32Array.from(sorted.slice(0, cut)), Uint32Array.from(sorted.slice(cut))]
}

function buildPalette(histogram, limit) {
  const { colors, weights, keys } = histogram
  if (keys.length <= limit) {
    return { palette: colors, lookup: new Map(Array.from(keys, (key, i) => [key, i])) }
  }

  let boxes = [Uint32Array.from(keys.keys())]
  while (boxes.length < limit) {
    let bestBox = -1
    let bestScore = -1
    for (let i = 0; i < boxes.length; i += 1) {
      if (boxes[i].length < 2) continue
      const ranges = boxRange(boxes[i], colors)
      const score = Math.max(...ranges)
      if (score > bestScore) {
        bestScore = score
        bestBox = i
      }
    }
    if (bestBox === -1 || bestScore === 0) break
    const [left, right] = splitBox(boxes[bestBox], colors, weights)
    boxes.splice(bestBox, 1, left, right)
  }

  const palette = new Uint8Array(boxes.length * 3)
  boxes.forEach((box, paletteIndex) => {
    let total = 0
    const sum = [0, 0, 0]
    for (const i of box) {
      total += weights[i]
      sum[0] += colors[i * 3] * weights[i]
      sum[1] += colors[i * 3 + 1] * weights[i]
      sum[2] += colors[i * 3 + 2] * weights[i]
    }
    for (let channel = 0; channel < 3; channel += 1) {
      palette[paletteIndex * 3 + channel] = Math.round(sum[channel] / total)
    }
  })

  // Plain median-cut boxes can mix unrelated hues (a thin gray antialiasing pixel
  // lands next to an accent color and the averaged entry turns green). A few
  // weighted k-means passes pull each entry back to the colors that actually use it.
  const assignment = new Uint8Array(keys.length)
  const sums = new Float64Array(boxes.length * 4)
  for (let iteration = 0; iteration < 12; iteration += 1) {
    let changed = 0
    for (let i = 0; i < keys.length; i += 1) {
      const r = colors[i * 3]
      const g = colors[i * 3 + 1]
      const b = colors[i * 3 + 2]
      let best = 0
      let bestDistance = Infinity
      for (let p = 0; p < boxes.length; p += 1) {
        const dr = r - palette[p * 3]
        const dg = g - palette[p * 3 + 1]
        const db = b - palette[p * 3 + 2]
        const distance = dr * dr + dg * dg + db * db
        if (distance < bestDistance) {
          bestDistance = distance
          best = p
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best
        changed += 1
      }
    }
    if (changed === 0) break
    sums.fill(0)
    for (let i = 0; i < keys.length; i += 1) {
      const p = assignment[i] * 4
      const weight = weights[i]
      sums[p] += colors[i * 3] * weight
      sums[p + 1] += colors[i * 3 + 1] * weight
      sums[p + 2] += colors[i * 3 + 2] * weight
      sums[p + 3] += weight
    }
    for (let p = 0; p < boxes.length; p += 1) {
      if (sums[p * 4 + 3] === 0) continue
      palette[p * 3] = Math.round(sums[p * 4] / sums[p * 4 + 3])
      palette[p * 3 + 1] = Math.round(sums[p * 4 + 1] / sums[p * 4 + 3])
      palette[p * 3 + 2] = Math.round(sums[p * 4 + 2] / sums[p * 4 + 3])
    }
  }

  const lookup = new Map()
  for (let i = 0; i < keys.length; i += 1) lookup.set(keys[i], assignment[i])
  return { palette, lookup }
}

function filterRows(indices, width, height) {
  const bpp = 1
  const stride = width
  const output = Buffer.alloc((stride + 1) * height)
  const candidate = Buffer.alloc(stride)
  const best = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const row = indices.subarray(y * stride, (y + 1) * stride)
    const previous = y > 0 ? indices.subarray((y - 1) * stride, y * stride) : undefined
    let bestScore = Infinity
    let bestFilter = 0
    for (let filter = 0; filter <= 4; filter += 1) {
      let score = 0
      for (let x = 0; x < stride; x += 1) {
        const left = x >= bpp ? row[x - bpp] : 0
        const up = previous === undefined ? 0 : previous[x]
        const upLeft = previous === undefined || x < bpp ? 0 : previous[x - bpp]
        let value
        switch (filter) {
          case 0: value = row[x]; break
          case 1: value = row[x] - left; break
          case 2: value = row[x] - up; break
          case 3: value = row[x] - ((left + up) >> 1); break
          default: value = row[x] - paeth(left, up, upLeft); break
        }
        value &= 0xff
        candidate[x] = value
        score += value < 128 ? value : 256 - value
      }
      if (score < bestScore) {
        bestScore = score
        bestFilter = filter
        candidate.copy(best)
      }
    }
    const rowStart = y * (stride + 1)
    output[rowStart] = bestFilter
    best.copy(output, rowStart + 1)
  }
  return output
}

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let value = n
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  crcTable[n] = value >>> 0
}
const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function encodeIndexedPng(width, height, palette, indices) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 3
  const filtered = filterRows(indices, width, height)
  const compressed = deflateSync(filtered, { level: 9, memLevel: 9, strategy: constants.Z_DEFAULT_STRATEGY })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', Buffer.from(palette)),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const input = readFileSync(inputPath)
const decoded = decodePng(input)
const resized = downscaleRgb(toRgb(decoded), decoded.width, decoded.height, scale)
if (resized.width !== decoded.width || resized.height !== decoded.height) {
  console.log(`resized ${decoded.width}x${decoded.height} -> ${resized.width}x${resized.height}`)
}
const histogram = buildHistogram(resized.rgb)
const { palette, lookup } = buildPalette(histogram, maxColors)

const indices = new Uint8Array(resized.width * resized.height)
for (let i = 0, p = 0; i < resized.rgb.length; i += 3, p += 1) {
  const key = (resized.rgb[i] << 16) | (resized.rgb[i + 1] << 8) | resized.rgb[i + 2]
  indices[p] = lookup.get(key)
}

const encoded = encodeIndexedPng(resized.width, resized.height, palette, indices)
writeFileSync(maybeOutputPath, encoded)
const saved = Math.round((1 - encoded.length / input.length) * 100)
console.log(
  `compressed ${basename(maybeOutputPath)}: ${input.length} -> ${encoded.length} bytes (${saved}% smaller, ${resized.width}x${resized.height}, ${histogram.keys.length} colors -> ${palette.length / 3})`
)

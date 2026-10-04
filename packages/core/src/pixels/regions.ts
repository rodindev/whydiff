import { MASS_DIFF_RATIO, MAX_REGIONS, REGION_GRID_CELL } from '../constants.js'
import type { DiffMask } from './mask.js'
import { PIXEL_DIFFERENT } from './pixelmatch.js'

/** Bounding box of one connected group of differing pixels, in image pixels. */
export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Differing pixels inside the box. */
  readonly pixels: number
}

/** Regions of a mask, sorted by top, left, width, height. */
export interface RegionSet {
  readonly regions: readonly Region[]
  /** Too many regions or too many pixels changed for per-region reasoning. */
  readonly massChange: boolean
}

/** Groups differing pixels into regions: 8-connected components over a cell grid. */
export function diffRegions(mask: DiffMask): RegionSet {
  const cols = Math.ceil(mask.width / REGION_GRID_CELL)
  const rows = Math.ceil(mask.height / REGION_GRID_CELL)
  const occupied = markOccupiedCells(mask, cols)
  const parent = connectCells(occupied, cols, rows)
  const regions = collectRegions(mask, cols, parent)
  const total = mask.width * mask.height
  const massChange =
    regions.length > MAX_REGIONS || (total > 0 && mask.differing / total > MASS_DIFF_RATIO)
  return { regions, massChange }
}

function markOccupiedCells(mask: DiffMask, cols: number): Uint8Array {
  const occupied = new Uint8Array(cols * Math.ceil(mask.height / REGION_GRID_CELL))
  for (let y = 0; y < mask.height; y++) {
    const row = Math.floor(y / REGION_GRID_CELL) * cols
    for (let x = 0; x < mask.width; x++) {
      if (mask.classes[y * mask.width + x] === PIXEL_DIFFERENT) {
        occupied[row + Math.floor(x / REGION_GRID_CELL)] = 1
      }
    }
  }
  return occupied
}

// Union-find over occupied cells; each cell joins its already visited neighbours.
function connectCells(occupied: Uint8Array, cols: number, rows: number): Int32Array {
  const parent = new Int32Array(occupied.length)
  for (let i = 0; i < parent.length; i++) parent[i] = i
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col
      if (occupied[cell] !== 1) continue
      if (col > 0) union(parent, occupied, cell, cell - 1)
      if (row > 0) {
        union(parent, occupied, cell, cell - cols)
        if (col > 0) union(parent, occupied, cell, cell - cols - 1)
        if (col < cols - 1) union(parent, occupied, cell, cell - cols + 1)
      }
    }
  }
  return parent
}

function union(parent: Int32Array, occupied: Uint8Array, a: number, b: number): void {
  if (occupied[b] !== 1) return
  const rootA = find(parent, a)
  const rootB = find(parent, b)
  if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB)
}

function find(parent: Int32Array, cell: number): number {
  let root = cell
  while (parent[root] !== root) root = parent[root] ?? root
  while (parent[cell] !== root) {
    const next = parent[cell] ?? root
    parent[cell] = root
    cell = next
  }
  return root
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  pixels: number
}

function collectRegions(mask: DiffMask, cols: number, parent: Int32Array): Region[] {
  const bounds = new Map<number, Bounds>()
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.classes[y * mask.width + x] !== PIXEL_DIFFERENT) continue
      const cell = Math.floor(y / REGION_GRID_CELL) * cols + Math.floor(x / REGION_GRID_CELL)
      const root = find(parent, cell)
      const box = bounds.get(root)
      if (box === undefined) {
        bounds.set(root, { minX: x, minY: y, maxX: x, maxY: y, pixels: 1 })
      } else {
        box.minX = Math.min(box.minX, x)
        box.maxX = Math.max(box.maxX, x)
        box.minY = Math.min(box.minY, y)
        box.maxY = Math.max(box.maxY, y)
        box.pixels++
      }
    }
  }
  return [...bounds.values()]
    .map((box) => ({
      x: box.minX,
      y: box.minY,
      width: box.maxX - box.minX + 1,
      height: box.maxY - box.minY + 1,
      pixels: box.pixels,
    }))
    .sort(byPosition)
}

function byPosition(a: Region, b: Region): number {
  return a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height
}

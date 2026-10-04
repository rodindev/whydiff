import { padToSize, type RgbaImage } from './image.js'

const solid = (width: number, height: number, byte: number): RgbaImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 4).fill(byte),
})

describe('padToSize', () => {
  it('returns the same image when the size already matches', () => {
    const image = solid(2, 2, 255)
    expect(padToSize(image, { width: 2, height: 2 })).toBe(image)
  })

  it('pads with transparent black on the right and at the bottom', () => {
    const padded = padToSize(solid(1, 1, 255), { width: 2, height: 2 })
    expect(padded).toMatchObject({ width: 2, height: 2 })
    expect([...padded.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

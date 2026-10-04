import { sameValue } from './equal.js'

describe('sameValue', () => {
  it('treats equal strings and equal colours in other syntaxes as the same', () => {
    expect(sameValue('display', 'flex', 'flex')).toBe(true)
    expect(sameValue('color', 'rgb(255, 0, 0)', 'rgba(255, 0, 0, 1)')).toBe(true)
    expect(sameValue('border-top-color', 'rgb(0, 0, 0)', 'color(srgb 0 0 0)')).toBe(true)
    expect(sameValue('color', 'rgb(255, 0, 0)', 'rgb(254, 0, 0)')).toBe(false)
  })

  it('equates shadows that paint nothing with none', () => {
    const empty =
      'rgba(0, 0, 0, 0.2) 0px 0px 0px 0px, rgba(0, 0, 0, 0.14) 0px 0px 0px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px'
    expect(sameValue('box-shadow', empty, 'none')).toBe(true)
    expect(sameValue('box-shadow', 'rgba(0, 0, 0, 0.2) 0px 1px 3px 0px', 'none')).toBe(false)
    expect(sameValue('box-shadow', 'none', 'none')).toBe(true)
  })

  it('compares everything else through the normalizer', () => {
    expect(sameValue('font-weight', '500', '700')).toBe(false)
    expect(sameValue('font-weight', 'bold', '700')).toBe(true)
    expect(sameValue('transform', 'none', 'matrix(1, 0, 0, 1, 0, 0)')).toBe(false)
    expect(
      sameValue(
        'transform',
        'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1)',
        'matrix(1, 0, 0, 1, 4, 0)'
      )
    ).toBe(true)
    expect(sameValue('margin-top', '0px', '0')).toBe(true)
    expect(sameValue('font-family', '"Inter", sans-serif', 'Inter, sans-serif')).toBe(true)
  })

  describe('the properties that paint, in the forms Chromium computes', () => {
    it('mask-image', () => {
      const fade = 'linear-gradient(rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 16px)'
      const side = 'linear-gradient(to right, rgba(0, 0, 0, 0), rgb(0, 0, 0) 16px)'
      expect(
        sameValue('mask-image', fade, 'linear-gradient(rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 16px)')
      ).toBe(true)
      expect(sameValue('mask-image', fade, `${fade}, ${side}`)).toBe(false)
      expect(sameValue('mask-image', `${fade}, ${side}`, `${side}, ${fade}`)).toBe(false)
      expect(sameValue('mask-image', 'none', fade)).toBe(false)
      expect(
        sameValue('mask-image', 'url("http://app.test/a.png")', 'url("http://app.test/b.png")')
      ).toBe(false)
    })

    it('clip-path', () => {
      expect(sameValue('clip-path', 'circle(50%)', 'circle(50% at 50% 50%)')).toBe(true)
      expect(sameValue('clip-path', 'inset(0px)', 'inset(0%)')).toBe(true)
      expect(
        sameValue(
          'clip-path',
          'polygon(0px 0px, 100% 0px, 50% 100%)',
          'polygon(0% 0%, 100% 0%, 50% 100%)'
        )
      ).toBe(true)
      expect(sameValue('clip-path', 'circle(50%)', 'circle(50% at 0% 0%)')).toBe(false)
      expect(sameValue('clip-path', 'circle(50%)', 'ellipse(50% 50%)')).toBe(false)
      expect(sameValue('clip-path', 'none', 'inset(0px)')).toBe(false)
    })

    it('filter and backdrop-filter', () => {
      const shadow = 'drop-shadow(rgb(255, 0, 0) 0px 0px 2px)'
      for (const prop of ['filter', 'backdrop-filter']) {
        expect(sameValue(prop, 'brightness(0.5)', 'brightness(0.50001)')).toBe(true)
        expect(sameValue(prop, 'brightness(0.5)', 'brightness(1)')).toBe(false)
        expect(sameValue(prop, `${shadow} blur(2px)`, `blur(2px) ${shadow}`)).toBe(false)
        expect(sameValue(prop, 'none', 'blur(0px)')).toBe(false)
      }
    })

    it('text-shadow, where a shadow without offset or blur still paints', () => {
      const shadow = 'rgb(0, 0, 0) 0px 1px 0px'
      expect(sameValue('text-shadow', shadow, 'rgb(0, 0, 0) 0px 1.00001px 0px')).toBe(true)
      expect(sameValue('text-shadow', shadow, 'rgb(0, 0, 0) 0px 1px 2px')).toBe(false)
      expect(sameValue('text-shadow', 'none', 'rgb(0, 0, 0) 0px 0px 0px')).toBe(false)
    })

    it('mix-blend-mode, outline-style and outline-offset', () => {
      expect(sameValue('mix-blend-mode', 'normal', 'multiply')).toBe(false)
      expect(sameValue('outline-style', 'none', 'auto')).toBe(false)
      expect(sameValue('outline-offset', '0px', '-1px')).toBe(false)
    })
  })
})

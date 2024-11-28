export class VibrantColorGenerator {
    constructor() {
      this.generatedColors = new Set()
      this.step = 37
      this.saturation = 80
      this.lightness = 50
      this.hue = 0
    }
  
    hslToRgb(h, s, l) {
      s /= 100
      l /= 100
  
      const c = (1 - Math.abs(2 * l - 1)) * s
      const x = c * (1 - Math.abs((h / 60) % 2 - 1))
      const m = l - c / 2
  
      let r, g, b
      if (h >= 0 && h < 60) {
        r = c; g = x; b = 0
      } else if (h >= 60 && h < 120) {
        r = x; g = c; b = 0
      } else if (h >= 120 && h < 180) {
        r = 0; g = c; b = x
      } else if (h >= 180 && h < 240) {
        r = 0; g = x; b = c
      } else if (h >= 240 && h < 300) {
        r = x; g = 0; b = c
      } else {
        r = c; g = 0; b = x
      }
  
      return {
        r: (r + m),
        g: (g + m),
        b: (b + m)
      }
    }
  
    nextColor() {
      do {
        this.hue = (this.hue + this.step) % 360
        const { r, g, b } = this.hslToRgb(this.hue, this.saturation, this.lightness)
        const rgb = [ r, g, b ]
  
        const colorKey = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`
        if (!this.generatedColors.has(colorKey)) {
          this.generatedColors.add(colorKey)
          return rgb
        }
      } while (this.generatedColors.size < 10000)
      throw new Error("Cannot generate more unique colors!")
    }
  }

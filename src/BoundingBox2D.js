import { Vec4f } from './Vec4f.js'

export class BoundingBox2D extends Vec4f {

    constructor(xMin, yMin, xMax, yMax) {
        super(xMin, yMin, xMax, yMax)
        this.x = xMin !== undefined ? xMin : Infinity
        this.y = yMin !== undefined ? yMin : Infinity
        this.z = xMax !== undefined ? xMax : -Infinity
        this.w = yMax !== undefined ? yMax : -Infinity
    }

    static create(xMin, yMin, xMax, yMax) {

        return new BoundingBox2D(xMin, yMin, xMax, yMax)
    }

    get boundary() {

        return this.xyzw
    }

    update(x, y) {
        
        this.data[0] = x < this.data[0] ? x : this.data[0]
        this.data[1] = y < this.data[1] ? y : this.data[1]
        this.data[2] = x > this.data[2] ? x : this.data[2]
        this.data[3] = y > this.data[3] ? y : this.data[3]
    }

    updateByBox(box) {

        this.update(box.x, box.y)
        this.update(box.z, box.w)
    }

    /**
     * @param {BoundingBox2D} bBox 
     */
    overlap(bBox) {

        if (this.data[0] > bBox.data[2] || this.data[2] < bBox.data[0]) return false
        if (this.data[1] > bBox.data[3] || this.data[3] < bBox.data[1]) return false

        return true
    }

    within(x, y) {

        if (x < this.data[0] || y < this.data[1] || x > this.data[2] || y > this.data[3]) return false
        return true
    }

    get center() {

        return [
            (this.data[0] + this.data[2]) / 2,
            (this.data[1] + this.data[3]) / 2,
        ]
    }

    get size() {
        
        return [
            this.data[2] - this.data[0],
            this.data[3] - this.data[1],
        ]
    }

    get xMin() {

        return this.data[0]
    }

    get yMin() {

        return this.data[1]
    }

    get xMax() {

        return this.data[2]
    }

    get yMax() {

        return this.data[3]
    }

    reset(xMin, yMin, xMax, yMax) {
        
        this.data[0] = xMin !== undefined ? xMin : Infinity
        this.data[1] = yMin !== undefined ? yMin : Infinity
        this.data[2] = xMax !== undefined ? xMax : -Infinity
        this.data[3] = yMax !== undefined ? yMax : -Infinity
    }

    release() {

        this.data = null
        return null
    }

    
}

export function boundingBox2D(xMin, yMin, xMax, yMax) {

    return BoundingBox2D.create(xMin, yMin, xMax, yMax)
}

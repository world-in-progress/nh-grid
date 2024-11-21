export class Vec4f {
     
    constructor(x, y, z, w) {

        this.data = new Array(4)

        if (x === undefined && y === undefined && z === undefined && w === undefined) this.data.fill(0.0)
        else if (x !== undefined && y === undefined && z === undefined && w === undefined) this.data.fill(x)
        else if (x !== undefined && y !== undefined && z === undefined && w === undefined) { this.data[0] = x; this.data[1] = this.data[2] = this.data[3] = y; }
        else if (x !== undefined && y !== undefined && z !== undefined && w === undefined) { this.data[0] = x; this.data[1] =  y; this.data[2] = this.data[3] = z; }
        else {
            this.data[0] = x
            this.data[1] = y
            this.data[2] = z
            this.data[3] = w
        }
    }

    get x() {

        return this.data[0]
    }

    get y() {

        return this.data[1]
    }

    get z() {

        return this.data[2]
    }

    get w() {

        return this.data[3]
    }

    get xy() {

        return [ this.data[0], this.data[1] ]
    }

    get yz() {

        return [ this.data[1], this.data[2] ]
    }

    get zw() {

        return [ this.data[2], this.data[3] ]
    }

    get xyz() {

        return [ this.data[0], this.data[1], this.data[2] ]
    }

    get yzw() {

        return [ this.data[1], this.data[2], this.data[3] ]
    }

    get xyzw() {

        return this.data
    }

    set x(x) {

        this.data[0] = x
    }

    set y(y) {

        this.data[1] = y
    }

    set z(z) {

        this.data[2] = z
    }

    set w(w) {

        this.data[3] = w
    }

    set xy(xy) {

        this.data[0] = xy[0]
        this.data[1] = xy[1]
    }

    set yz(yz) {

        this.data[1] = yz[0]
        this.data[2] = yz[1]
    }

    set zw(zw) {

        this.data[2] = zw[0]
        this.data[3] = zw[1]
    }

    set xyz(xyz) {

        this.data[0] = xyz[0]
        this.data[1] = xyz[1]
        this.data[2] = xyz[2]
    }

    set yzw(yzw) {

        this.data[1] = yzw[0]
        this.data[2] = yzw[1]
        this.data[3] = yzw[2]
    }

    set xyzw(xyzw) {

        this.data[0] = yzw[0]
        this.data[1] = yzw[1]
        this.data[2] = yzw[2]
        this.data[3] = yzw[3]
    }
}

export function vec4f(x, y, z, w) {

    return new Vec4f(x, y, z, w)
}
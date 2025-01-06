class DynamicArrayBuffer {

    private _length: number
    private _buffer: ArrayBuffer

    constructor(initialSize: number = 1024 * 1024) {
        this._buffer = new ArrayBuffer(initialSize)
        this._length = 0
    }

    append(data: ArrayBufferView | number[]): void {
        
        const dataLength = (data instanceof Array) ? data.length : data.byteLength

        if (this._length + dataLength > this._buffer.byteLength) {
            this.expand(this._length + dataLength)
        }

        const view = new Uint8Array(this._buffer)
        
        if (data instanceof Array) {
            view.set(data, this._length)
        } else {
            view.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), this._length)
        }
        
        this._length += dataLength
    }

    private expand(newSize: number): void {
        const expandedSize = Math.max(this._buffer.byteLength * 2, newSize)
        const newBuffer = new ArrayBuffer(expandedSize)
        const newView = new Uint8Array(newBuffer)
    
        newView.set(new Uint8Array(this._buffer, 0, this._length))
        this._buffer = newBuffer
    }

    clear(): void {
        this._length = 0
        this._buffer = new ArrayBuffer(this._buffer.byteLength)
    }

    get u8(): Uint8Array {
        return new Uint8Array(this._buffer, 0, this._length)
    }

    get u8Size(): number {
        return this._length
    }

    get i8(): Int8Array {
        return new Int8Array(this._buffer, 0, this._length)
    }

    get i8Size(): number {
        return this._length
    }

    get u16(): Uint16Array {
        return new Uint16Array(this._buffer, 0, this._length / 2)
    }

    get u16Size(): number {
        return this._length / 2
    }

    get u32(): Uint32Array {
        return new Uint32Array(this._buffer, 0, this._length / 4)
    }

    get u32Size(): number {
        return this._length / 4
    }

    get i32(): Int32Array {
        return new Int32Array(this._buffer, 0, this._length / 4)
    }

    get i32Size(): number {
        return this._length / 4
    }

    get f32(): Float32Array {
        return new Float32Array(this._buffer, 0, this._length / 4)
    }

    get f32Size(): number {
        return this._length / 4
    }

    get f64(): Float64Array {
        return new Float64Array(this._buffer, 0, this._length / 8)
    }

    get f64Size(): number {
        return this._length / 8
    }
}

export default DynamicArrayBuffer

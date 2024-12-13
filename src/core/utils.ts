import { Callback, Class, Serialized, SerializedObject } from "./types"

let id = 1;
export function uniqueId(): number {
    return id++;
}

export function bindAll(fns: string[], context: any): void {

    fns.forEach(fn => {
        if (!context[fn]) return 
        context[fn] = context[fn].bind(context)
    })
}

export function asyncAll<Item, Result>(
    array: Array<Item>,
    fn: (item: Item, fnCallback: Callback<Result>) => void,
    callback: Callback<Array<Result>>
): void {
    if (!array.length) return callback(null, [])

    let remaining = array.length
    const results = new Array(array.length)
    let error: Error | null = null
    array.forEach((item, index) => {
        fn(item, (err, result) => {
            if (err) error = err
            results[index] = result
            if (--remaining === 0) callback(error, results)
        })
    })
}

export function isWorker(): boolean {

    return !!self && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope
}

function isArrayBuffer(val: any): boolean {

    return val instanceof ArrayBuffer
}

function isImageBitmap(val: any): boolean {

    return val instanceof ImageBitmap
}

type Klass = Class<any> & {
    _classRegistryKey: string
    serialize?: (input: any, transferables?: Set<Transferable>) => SerializedObject
    deserialize?: (serialized: unknown) => unknown
}

type Registry = {
    [ key: string ]: {
        klass: Klass
        omit: ReadonlyArray<string>
    }
}

type RegisterOptions<T> = {
    omit?: ReadonlyArray<keyof T>
}

const registry: Registry = {}

export function register<T extends any>(klass: Class<T>, name: string, options: RegisterOptions<T> = {}) {
    if (registry[name]) return

    Object.defineProperty(klass, '_classRegistryKey', {
        value: name,
        writable: false
    })

    registry[name] = {
        klass,
        omit: options.omit || []
    } as unknown as Registry[string]
}

register(Object, 'Object')
register(Error, 'Error')
// register(WorkerGlobalScope, 'WorkerGlobalScope')

export function serialize(input: unknown, transferables?: Set<Transferable>): Serialized {
    
    if (
        input === null ||
        input === undefined ||
        typeof input === 'boolean' ||
        typeof input === 'number' ||
        typeof input === 'string' ||
        input instanceof Boolean ||
        input instanceof Number ||
        input instanceof String ||
        input instanceof Date ||
        input instanceof RegExp
    ) return input

    if (isArrayBuffer(input) || isImageBitmap(input)) {
        transferables?.add(input)
        return input
    }

    if (ArrayBuffer.isView(input)) {
        const view = input as ArrayBufferView
        transferables?.add(view.buffer)
        return view
    }

    if (input instanceof ImageData) {
        transferables?.add(input.data.buffer)
        return input
    }

    if (Array.isArray(input)) {
        const serialized: Array<Serialized> = input.map(item => serialize(item, transferables))
        return serialized
    }

    if (input instanceof Set) {
        const properties: { [ key: number | string ]: Serialized } = { '$name': 'Set' }
        input.values().forEach((value, index) => properties[index + 1] = serialize(value))
        return properties
    }

    if (typeof input === 'object') {
        const klass = input.constructor as Klass
        const name = klass._classRegistryKey
        if (!registry[name]) {
            throw new Error(`Cannot serialize object of unregistered class ${name}`)
        }

        const properties: SerializedObject = klass.serialize ? klass.serialize(input, transferables) : {}

        if (!klass.serialize) {
            for (const key in input) {
                if (!input.hasOwnProperty(key)) continue
                if (registry[name].omit.indexOf(key) >= 0) continue
                const property = (input as any)[key]
                properties[key] = serialize(property, transferables)
            }
            if (input instanceof Error) {
                properties['message'] = input.message
            }
        }

        if (properties['$name']) throw new Error('$name property is reserved for worker serialization logic.')
        if (name !== 'Object') properties['$name'] = name

        return properties
    }

    throw new Error(`Cannot serialize object of type ${typeof input}`);
}

export function deserialize(input: Serialized): unknown {
    if (
        input === null ||
        input === undefined ||
        typeof input === 'boolean' ||
        typeof input === 'number' ||
        typeof input === 'string' ||
        input instanceof Boolean ||
        input instanceof Number ||
        input instanceof String ||
        input instanceof Date ||
        input instanceof RegExp ||
        input instanceof ImageData ||
        isArrayBuffer(input) ||
        isImageBitmap(input) ||
        ArrayBuffer.isView(input)
    ) return input

    if (Array.isArray(input)) {
        return input.map(deserialize)
    }

    if (typeof input === 'object') {
        const name = (input as any).$name || 'Object'

        if (name === 'Set') {
            const set = new Set()
            for (const key of Object.keys(input)) {
                if (key === '$name') continue

                const value = (input as SerializedObject)[key]
                set.add(deserialize(value))
            }

            return set
        }

        const { klass } = registry[name]
        if (!klass) throw new Error(`Cannot deserialize unregistered class ${name}`)

        if (klass.deserialize) {
            return klass.deserialize(input)
        }

        const result: {
            [ key: string ]: any
        } = Object.create(klass.prototype)

        for (const key of Object.keys(input)) {
            if (key === '$name') continue

            const value = (input as SerializedObject)[key]
            result[key] = deserialize(value)
        }

        return result
    }
}
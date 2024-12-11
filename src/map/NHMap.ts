import { mat4, vec3 } from 'gl-matrix'
import { Map as MapboxMap, MapboxOptions, MercatorCoordinate } from 'mapbox-gl'

export default class NHMap extends MapboxMap {

    mercatorCenter: MercatorCoordinate
    centerHigh = [ 0.0, 0.0 ]
    centerLow = [ 0.0, 0.0 ]
    WORLD_SIZE = 1024000 // TILE_SIZE * 2000
    relativeEyeMatrix = mat4.create()

    transform: any

    constructor(options: MapboxOptions) {

        // Init mapbox map
        super(options)

        // Attributes
        this.mercatorCenter = new MercatorCoordinate(...this.transform._computeCameraPosition().slice(0, 3) as [number, number, number])
    }

    update() {

        this.mercatorCenter = new MercatorCoordinate(...this.transform._computeCameraPosition().slice(0, 3) as [number, number, number])

        const mercatorCenterX = encodeFloatToDouble(this.mercatorCenter.x)
        const mercatorCenterY = encodeFloatToDouble(this.mercatorCenter.y)

        this.centerLow[0] = mercatorCenterX[1]
        this.centerLow[1] = mercatorCenterY[1]
        this.centerHigh[0] = mercatorCenterX[0]
        this.centerHigh[1] = mercatorCenterY[0]

        // this.mercatorMatrix = getMercatorMatrix(this.transform)
        this.relativeEyeMatrix = mat4.multiply([] as any, this.transform.mercatorMatrix, mat4.translate([] as any, mat4.identity([] as any), vec3.set([] as any, this.centerHigh[0], this.centerHigh[1], 0.0)))
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function encodeFloatToDouble(value: number) {

    const result = new Float32Array(2);
    result[0] = value;
    
    const delta = value - result[0];
    result[1] = delta;
    return result;
}

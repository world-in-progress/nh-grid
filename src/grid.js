import proj4 from 'proj4'
import { BoundingBox2D } from './boundingBox2D.js'
import { MercatorCoordinate } from './mercatorCoordinate.js'

export class GridNode {

    /**
     * @param {{
     *      localId: number,
     *      parent: GridNode,
     *      bBox: BoundingBox2D,
     *      subdivideRule: [number, number]
     * }} options
     */
    constructor(options) {

        this.id = options.localId
        this.parent = options.parent
        this.subdivideRule = options.subdivideRule

        /**  @type {GridNode[]} */
        this.children = []

        /** @type {BoundingBox2D} */
        this.bBox = new BoundingBox2D( 180.0, 90.0, -180.0, -90.0 )

        // Calculate bBox if parent exists
        if (options.parent !== undefined) {

            const wIndex = this.id % (this.parent.subdivideRule[0])
            const sIndex = Math.floor(this.id / this.parent.subdivideRule[0])
            const eIndex = wIndex + 1
            const nIndex = sIndex + 1

            const xMin = lerp(this.parent.bBox.xMin, this.parent.bBox.xMax, wIndex / this.parent.subdivideRule[0])
            const yMin = lerp(this.parent.bBox.yMin, this.parent.bBox.yMax, sIndex / this.parent.subdivideRule[1])
            const xMax = lerp(this.parent.bBox.xMin, this.parent.bBox.xMax, eIndex / this.parent.subdivideRule[0])
            const yMax = lerp(this.parent.bBox.yMin, this.parent.bBox.yMax, nIndex / this.parent.subdivideRule[1]) 

            this.bBox.update(xMin, yMin)
            this.bBox.update(xMax, yMax)
        }

        // Update bBox if provided
        if (options.bBox !== undefined) {
            
            this.bBox.updateByBox(options.bBox)
        }
    }

    getVertices(srcCS) {

        const vertices = new Float32Array(4)

        const srcTL = [ this.bBox.xMin, this.bBox.yMax ]
        const srcBR = [ this.bBox.xMax, this.bBox.yMin ]
        
        const targetTL = proj4(`EPSG:${srcCS}`, `EPSG:${4326}`, srcTL)
        const targetBR = proj4(`EPSG:${srcCS}`, `EPSG:${4326}`, srcBR)

        const renderTL = MercatorCoordinate.fromLonLat(targetTL)
        const renderBR = MercatorCoordinate.fromLonLat(targetBR)

        vertices[0] = renderTL[0]  // min x
        vertices[1] = renderTL[1]  // min y
        vertices[2] = renderBR[0]  // max x
        vertices[3] = renderBR[1]  // max y

        return vertices
    }

    release() {
        
        this.bBox = this.bBox.release()
        this.children = null
        this.parent = null
        this.level = null
        this.id = null
        return null
    }
    
    isSubdividable() {

        return this.children.length != 0
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function lerp(a, b, t) {

    return (1 - t) * a + t * b
}

import proj4 from 'proj4'
import { BoundingBox2D } from './BoundingBox2D.js'
import { MercatorCoordinate } from './MercatorCoordinate.js'

export class GridNode extends BoundingBox2D {

    /**
     * @param {{
     *      localId: number,
     *      parent: GridNode,
     *      bBox: BoundingBox2D,
     *      subdivideRule: [number, number]
     * }} options
     */
    constructor(options) {
        
        super(180.0, 90.0, -180.0, -90.0)

        this.level = 0
        this.hit = false
        this.storageId = 0
        this.localId = options.localId

        /** @type {GridNode[]} */
        this.children = []
        this.parent = options.parent

        // update bBox and level if parent exists
        if (options.parent !== undefined) {

            const [subWidth, subHeight] = options.subdivideRule

            // Bbox
            const wIndex = this.localId % (subWidth)
            const sIndex = Math.floor(this.localId / subWidth)
            const eIndex = wIndex + 1
            const nIndex = sIndex + 1

            const xMin = lerp(this.parent.xMin, this.parent.xMax, wIndex / subWidth)
            const yMin = lerp(this.parent.yMin, this.parent.yMax, sIndex / subHeight)
            const xMax = lerp(this.parent.xMin, this.parent.xMax, eIndex / subWidth)
            const yMax = lerp(this.parent.yMin, this.parent.yMax, nIndex / subHeight) 

            this.update(xMin, yMin)
            this.update(xMax, yMax)

            // Level
            this.level = options.parent.level + 1
        }

        // Update space range if provided
        if (options.bBox !== undefined) {
            
            this.updateByBox(options.bBox)
        }
    }

    getVertices(srcCS) {

        const vertices = new Float32Array(4)

        const srcTL = [ this.xMin, this.yMax ]
        const srcBR = [ this.xMax, this.yMin ]
        
        const targetTL = proj4(`EPSG:${srcCS}`, `EPSG:${4326}`, srcTL)
        const targetBR = proj4(`EPSG:${srcCS}`, `EPSG:${4326}`, srcBR)

        const renderTL = MercatorCoordinate.fromLonLat(targetTL)
        const renderBR = MercatorCoordinate.fromLonLat(targetBR)

        vertices[0] = renderTL[0]  // min x
        vertices[1] = renderBR[0]  // max x
        vertices[2] = renderTL[1]  // min y
        vertices[3] = renderBR[1]  // max y

        return vertices
    }

    release() {
        super.release()
        this.children = null
        this.parent = null
        this.level = null
        this.localId = null
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

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

        const [subWidth, subHeight] = options.subdivideRule

        this.level = 0
        this.hit = false
        this.storageId = 0
        this.parent = options.parent
        this.localId = options.localId

        /** @type {GridNode[]} */
        this.children = []

        /** @type {BoundingBox2D} */
        this.bBox = new BoundingBox2D( 180.0, 90.0, -180.0, -90.0 )

        // update bBox and level if parent exists
        if (options.parent !== undefined) {

            // Bbox
            const wIndex = this.localId % (subWidth)
            const sIndex = Math.floor(this.localId / subWidth)
            const eIndex = wIndex + 1
            const nIndex = sIndex + 1

            const xMin = lerp(this.parent.bBox.xMin, this.parent.bBox.xMax, wIndex / subWidth)
            const yMin = lerp(this.parent.bBox.yMin, this.parent.bBox.yMax, sIndex / subHeight)
            const xMax = lerp(this.parent.bBox.xMin, this.parent.bBox.xMax, eIndex / subWidth)
            const yMax = lerp(this.parent.bBox.yMin, this.parent.bBox.yMax, nIndex / subHeight) 

            this.bBox.update(xMin, yMin)
            this.bBox.update(xMax, yMax)

            // Level
            this.level = options.parent.level + 1
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
        vertices[1] = renderBR[0]  // max x
        vertices[2] = renderTL[1]  // min y
        vertices[3] = renderBR[1]  // max y

        return vertices
    }

    release() {
        
        this.bBox = this.bBox.release()
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

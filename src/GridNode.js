import proj4 from 'proj4'
import { BoundingBox2D } from './boundingBox2D.js'
import { MercatorCoordinate } from './mercatorCoordinate.js'

// export class GridEdge {

//     /**
//      *  ----- 0b00 -----
//      * |                |
//      * 0b01   NODE   0b11
//      * |                |
//      *  ----- 0b10 ----- 
//      * @param { GridNode } grid
//      * @param { 0b01 | 0b10 | 0b11 | 0b00 } edgeCode 
//      * @param { string[] } properties
//      */
//     constructor(grid, edgeCode, properties = undefined) {

//         this.grid = grid
//         this.properties = {}
//         this.edgeCode = edgeCode

//         if (properties) {
//             for (const key of properties) 
//                 this.properties[key] = undefined
//         }
//     }

//     /**
//      * @param { GridEdge } otherEdge 
//      * @returns { boolean }
//      */
//     equal(otherEdge) {
        
//         // Check if classes are the same
//         if (!(otherEdge instanceof GridEdge)) return false

//         // Check if direction are the same
//         if ((this.edgeCode & 0b01) !== (otherEdge.edgeCode & 0b01)) return false

//         // Check if vertices are the same
//         const thisVertices = this.getVertices()
//         const otherVertices = otherEdge.getVertices()
//         if (thisVertices.length !== otherVertices.length) return false

//         for (let i = 0; i < thisVertices.length; i++) {
//             if (thisVertices[i] !== otherVertices[i]) return false
//         }
//         return true
//     }

//     /**
//      * @param { GridEdge } otherEdge 
//      * @returns { boolean }
//      */
//     similar(otherEdge) {

//         // Not same class
//         if (!(otherEdge instanceof GridEdge)) return false

//         // Not same direction
//         if ((this.edgeCode & 0b01) !== (otherEdge.edgeCode & 0b01)) return false
    
//         // Get the vertices of both edges
//         const thisVertices = this.getVertices()
//         const otherVertices = otherEdge.getVertices()

//         const [ x1, y1, x2, y2]  = thisVertices
//         const [ x3, y3, x4, y4 ] = otherVertices

//         const v_this = [ x2 - x1, y2 - y1 ]
//         // const v_that = [ x4 - x3, y4 - y3 ]

//         // const crossProduct = v_this[0] * v_that[1] - v_this[1] * v_that[0]
//         // if (Math.abs(crossProduct) > Number.EPSILON) return false
        
//         const refVector = [x3 - x1, y3 - y1]
//         const refCross = v_this[0] * refVector[1] - v_this[1] * refVector[0]
//         if (Math.abs(refCross) > Number.EPSILON) return false


//         return true
//     }

//     getVertices() {

//         const indices = this.getIndices()
//         return indices.map(index => this.grid.data[index] || null)
//     }

//     getIndices() {

//         // xMin: 0, yMin: 1, xMax: 2, yMax: 3
//         switch (this.edgeCode) {
//             case 0b00:
//                 return [ 0, 3, 2, 3 ] // [ xMin, yMax, xMax, yMax ]
//             case 0b01:
//                 return [ 0, 1, 0, 3 ] // [ xMin, yMin, xMin, yMax ]
//             case 0b10:
//                 return [ 0, 1, 2, 1 ] // [ xMin, yMin, xMax, yMin ]
//             case 0b11:
//                 return [ 2, 1, 2, 3 ] // [ xMax, yMin, xMax, yMax ]
//             default:
//                 throw new Error(`Invalid edgeCode: ${this.edgeCode}`)
//         }
//     }
// }

export class GridEdge {

    /**
     *  ----- 0b00 -----
     * |                |
     * 0b01   Grid1   0b11
     * |                |
     *  ----- 0b10 ----- 
     * 
     * @param { string } key
     * @param { string[] } properties
    */
    constructor(key, properties = undefined) {

        this.key = key

        if (properties) {
            for (const key of properties) 
                this.properties[key] = undefined
        }
    }

    /**
     * @param { GridNode }          grid1
     * @param { GridNode | null }   grid2
     * @param { number }            edgeCode
     * @param { [ number, number, number, number ] } range
     */
    static createKey(grid1, grid2, edgeCode, range) {

        const key1 = `${grid1.level}-${grid1.globalId}`
        const key2 = grid2 ? `-${grid2.level}-${grid2.globalId}` : '-null-null'
        const key3 = `-${range[0]}-${range[1]}-${range[2]}-${range[3]}`
        const key4 = `-${edgeCode}`

        return key1 + key2 + key3 + key4
    }

    get opKey() {
        return GridEdge.getOpKey(this.key)
    }

    static toggleEdgeCode(code) {
        switch (code) {
            case 0b00:
                return 0b10
            case 0b01:
                return 0b11
            case 0b10:
                return 0b00
            case 0b11:
                return 0b01
        }
    }

    /**
     * @param { string } key 
     * @returns { string }
     */
    static getOpKey(key) {

        const keyArray = key.split('-').map((value, index) => {
            if (index === 8) {
                return GridEdge.toggleEdgeCode(Number(value));
            }
            return value === 'null' ? 'null' : Number(value);
        })

        const opKeyArray = keyArray.slice()
        opKeyArray[0] = keyArray[2]
        opKeyArray[1] = keyArray[3]
        opKeyArray[2] = keyArray[0]
        opKeyArray[3] = keyArray[1]

        return opKeyArray.join('-')
    }
}

export class GridEdgeRecoder {

    /**
     * @param { string[] } properties
     */
    constructor(properties = undefined) {

        /** @type { Map<string, GridEdge> } */
        this._edgeMap = new Map()
        this._properties = properties
    }

    /**
     * @param { GridNode }          grid1
     * @param { GridNode | null }   grid2
     * @param { number }            edgeCode
     * @param { [ number, number, number, number ] } range
     * @returns { GridEdge }
     */
    getEdgeByInfo(grid1, grid2, edgeCode, range) {

        const key = GridEdge.createKey(grid1, grid2, edgeCode, range)
        const opKey = GridEdge.getOpKey(key)

        const existingEdge = this._edgeMap.get(key) || this._edgeMap.get(opKey)
    
        if (existingEdge) {
            return existingEdge
        } else {
            const edge = new GridEdge(key, this._properties)
            this._edgeMap.set(key, edge)
            return edge
        }
    }
}

export class GridNode {

    /**
     * @param {{
     *      localId: number,
     *      globalId: number,
     *      parent: GridNode,
     *      globalRange: [ number, number ]
     * }} options
     */
    constructor(options) {

        this.level = 0
        this.hit = false
        this.storageId = 0
        this.localId = options.localId
        this.globalId = options.globalId

        this._xMinPercent = [ 0, 1 ]
        this._xMaxPercent = [ 1, 1 ]
        this._yMinPercent = [ 0, 1 ]
        this._yMaxPercent = [ 1, 1 ]

        /** @type {GridNode[]} */
        this.children = []
        this.parent = options.parent
        
        /** @type { [ Set<GridNode>, Set<GridNode>, Set<GridNode>, Set<GridNode> ] } */
        this.neighbours = new Array(4)
        this.neighbours[0] = new Set()
        this.neighbours[1] = new Set()
        this.neighbours[2] = new Set()
        this.neighbours[3] = new Set()

        /** @type { [ Set<string>, Set<string>, Set<string>, Set<string> ] } */
        this.edges = new Array(4)
        this.edges[0] = new Set()
        this.edges[1] = new Set()
        this.edges[2] = new Set()
        this.edges[3] = new Set()

        this.edgeCalculated = false

        // update level if parent exists
        if (options.parent !== undefined) {
            this.level = options.parent.level + 1
        }

        if (options.globalRange) {

            const [ width, height ] = options.globalRange
            const globalU = this.globalId % width
            const globalV = Math.floor(this.globalId / width)

            this._xMinPercent = simplifyFraction(globalU, width)
            this._xMaxPercent = simplifyFraction(globalU + 1, width)
            this._yMinPercent = simplifyFraction(globalV, width)
            this._yMaxPercent = simplifyFraction(globalV + 1, width)
        }
    }

    get xMinPercent() {

        return this._xMinPercent[0] / this._xMinPercent[1]
    }

    get xMaxPercent() {

        return this._xMaxPercent[0] / this._xMaxPercent[1]
    }

    get yMinPercent() {

        return this._yMinPercent[0] / this._yMinPercent[1]
    }

    get yMaxPercent() {

        return this._yMaxPercent[0] / this._yMaxPercent[1]
    }

    resetEdges() {

        this.edges[0].clear()
        this.edges[1].clear()
        this.edges[2].clear()
        this.edges[3].clear()
        this.edgeCalculated = false
    }

    /**
     * @param { GridEdgeRecoder } edgeRecoder 
     */
    calcEdges(edgeRecoder) {

        if (this.edgeCalculated) return

        // Calculate north edges
        this.getHorizontalEdges(edgeRecoder, 0b00, 0b10)
        // Calculate sourth edges
        this.getHorizontalEdges(edgeRecoder, 0b10, 0b00)
        
        this.edgeCalculated = true
    }

    /**
     * @param { GridEdge } edge 
     * @param { number } edgeCode 
     */
    addEdge(edge, edgeCode) {

        if (!this.edges[edgeCode].has(edge.key) && !this.edges[edgeCode].has(edge.opKey)){
            this.edges[edgeCode].add(edge.key)
        }
    }

    /**
     * @param { GridEdgeRecoder } edgeRecoder 
     * @param { number } edgeCode
     * @param { number } opEdgeCode
     */
    getHorizontalEdges(edgeRecoder, edgeCode, opEdgeCode) {

        let neighbours = [...this.neighbours[edgeCode]]

        // Case when neighbour has lower level
        if (neighbours.length === 1 && neighbours[0].level < this.level) {

            const edge = edgeRecoder.getEdgeByInfo(this, neighbours[0], edgeCode, [ ...this._xMinPercent, ...this._xMaxPercent ])
            this.addEdge(edge, edgeCode)
            neighbours[0].addEdge(edge, opEdgeCode)
            return
        }

        const xPercentSet = new Set([ this.xMinPercent, this.xMaxPercent ])
        neighbours = neighbours.filter(neighbour => neighbour.level >= this.level)


        neighbours.forEach(neighbour => {
            xPercentSet.add(neighbour.xMinPercent)
            xPercentSet.add(neighbour.xMaxPercent)
        })

        const xPercentList = [...xPercentSet].sort((x1, x2) => x1 - x2)

        for (let i = 0; i < xPercentList.length - 1; i++) {

            const from = xPercentList[i]
            const to = xPercentList[i + 1]

            let fromIndex = -1
            let toIndex = -1
            for (let j = 0; j < neighbours.length; j++) {

                const neighbour = neighbours[j]
                const xMinPercent = neighbour.xMinPercent
                const xMaxPercent = neighbour.xMaxPercent
                if (xMinPercent === from || xMaxPercent === from) fromIndex = j
                if (xMinPercent === to || xMaxPercent === to) toIndex = j
                if (fromIndex !== -1 && toIndex !== -1) break
            }

            // From and to are min and max of the same neighbour
            if (fromIndex === toIndex && fromIndex !== -1) {

                const neighbour = neighbours[fromIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, neighbour, edgeCode, [ ...neighbour._xMinPercent, ...neighbour._xMaxPercent ])
                this.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)

            }
            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...this._xMinPercent, ...this._xMaxPercent ])
                this.addEdge(edge, edgeCode)

            }
            // From and to are min and max of the same neighbour
            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...fromNeighbour._xMaxPercent, ...toNeighbour._xMinPercent ])
                this.addEdge(edge, edgeCode)

            } 
            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...fromNeighbour._xMaxPercent, ...this._xMaxPercent ])
                this.addEdge(edge, edgeCode)

            } 
            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...this._xMinPercent, ...toNeighbour._xMinPercent ])
                this.addEdge(edge, edgeCode)
            }
        }
    }

    getVertices(srcCS, bBox) {

        const vertices = new Float32Array(4)

        //
        const xMin = lerp(bBox.xMin, bBox.xMax, this.xMinPercent)
        const yMin = lerp(bBox.yMin, bBox.yMax, this.yMinPercent)
        const xMax = lerp(bBox.xMin, bBox.xMax, this.xMaxPercent)
        const yMax = lerp(bBox.yMin, bBox.yMax, this.yMaxPercent) 
        //

        const srcTL = [ xMin, yMax ]
        const srcBR = [ xMax, yMin ]
        
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

        this.neighbours = null
        this.storageId = null
        this.children = null
        this.globalId = null
        this.localId = null
        this.parent = null
        this.level = null
        this.hit = false

        return null
    }

    /**
     * 
     * @param {GridNode} grid 
     */
    equal(grid) {

        return (this.level === grid.level) && (this.globalId === grid.globalId)
    }

    /**
     * 
     * @param { BoundingBox2D } bBox 
     * @param { number } lon 
     * @param { number } lat 
     */
    within(bBox, lon, lat) {

        const xMin = lerp(bBox.xMin, bBox.xMax, this.xMinPercent)
        const yMin = lerp(bBox.yMin, bBox.yMax, this.yMinPercent)
        const xMax = lerp(bBox.xMin, bBox.xMax, this.xMaxPercent)
        const yMax = lerp(bBox.yMin, bBox.yMax, this.yMaxPercent) 

        if (lon < xMin || lat < yMin || lon > xMax || lat > yMax) return false
        return true
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function lerp(a, b, t) {

    return (1 - t) * a + t * b
}

function gcd(a, b) {

    while (b !== 0) {
      let temp = b
      b = a % b
      a = temp
    }
    return a
  }
  
  
  function simplifyFraction(n, m) {

    let divisor = gcd(n, m)
    return [ n / divisor, m / divisor ]
  }
  
import proj4 from 'proj4'
import { BoundingBox2D } from './BoundingBox2D.js'
import { MercatorCoordinate } from './MercatorCoordinate.js'

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

const EDGE_CODE_NORTH   = 0b00
const EDGE_CODE_WEST    = 0b01
const EDGE_CODE_SOUTH   = 0b10
const EDGE_CODE_EAST    = 0b11

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

    _getKeyArray() {

        return this.key.split('-').map((value, index) => {
            return value === 'null' ? 'null' : Number(value);
        })
    }

    /**
     * @param { GridNode | null }   grid1
     * @param { GridNode | null }   grid2
     * @param { number }            edgeCode
     * @param { [ number, number, number, number ] } range
     */
    static createKey(grid1, grid2, edgeCode, range) {

        const key1 = grid1 ? `${grid1.level}-${grid1.globalId}` : 'null-null'
        const key2 = grid2 ? `-${grid2.level}-${grid2.globalId}` : '-null-null'
        const key3 = `-${range[0]}-${range[1]}-${range[2]}-${range[3]}`
        const key4 = `-${edgeCode}`

        return key1 + key2 + key3 + key4
    }

    get opKey() {
        return GridEdge.getOpKey(this.key)
    }

    /**
     * @returns { {
     *      adjGrids: [ string, string ], 
     *      minPercent: [ number, number ], 
     *      maxPercent: [ number, number ], 
     *      edgeCode: number
     * } }
     */
    get serialization() {
        
        const keyArray = this._getKeyArray()

        return {
            adjGrids: [ 
                [ keyArray[0], keyArray[1] ].join('-'), // [grid1] level-globalId
                [ keyArray[2], keyArray[3] ].join('-')  // [grid2] level-globalId
            ],
            minPercent: [ keyArray[4], keyArray[5] ],
            maxPercent: [ keyArray[6], keyArray[7] ],
            edgeCode: keyArray[8]
        }
    }

    static toggleEdgeCode(code) {
        switch (code) {
            case EDGE_CODE_NORTH:
                return EDGE_CODE_SOUTH

            case EDGE_CODE_WEST:
                return EDGE_CODE_EAST

            case EDGE_CODE_SOUTH:
                return EDGE_CODE_NORTH

            case EDGE_CODE_EAST:
                return EDGE_CODE_WEST
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
     * @param { GridNode | null }   grid1
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

    /**
     * @param { GridEdge} edge 
     */
    addEdge(edge) {

        const key = edge.key
        const opKey = GridEdge.getOpKey(key)

        const existingEdge = this._edgeMap.get(key) || this._edgeMap.get(opKey)
        if (!existingEdge) {
            this._edgeMap.set(key, edge)
        }
    }

    /**
     * @param { string } key 
     * @returns { GridEdge | null }
     */
    getEdgeByKey(key) {

        const opKey = GridEdge.getOpKey(key)
        const existingEdge = this._edgeMap.get(key) || this._edgeMap.get(opKey)
        if (existingEdge) {
            return existingEdge
        } else {
            return null
        }
    }
}

export class GridNode {

    /**
     * @param {{
     *      localId: number,
     *      globalId: number,
     *      storageId: number,
     *      parent: GridNode,
     *      globalRange: [ number, number ]
     * }} options
     */
    constructor(options) {

        this.hit = false
        this.edgeCalculated = false

        this.parent = options.parent
        this.localId = options.localId
        this.globalId = options.globalId
        this.storageId = options.storageId
        this.level = options.parent !== undefined ? options.parent.level + 1 : 0

        /** @type {GridNode[]} */
        this.children = []

        // Division Coordinates [ numerator, denominator ] 
        // Use integer numerators and denominators to avoid coordinate precision issue
        this._xMinPercent = [ 0, 1 ]
        this._xMaxPercent = [ 1, 1 ]
        this._yMinPercent = [ 0, 1 ]
        this._yMaxPercent = [ 1, 1 ]
        
        /** @type { [ Set<GridNode>, Set<GridNode>, Set<GridNode>, Set<GridNode> ] } */
        this.neighbours = new Array(4)
        this.neighbours[EDGE_CODE_NORTH]    = new Set()
        this.neighbours[EDGE_CODE_WEST]     = new Set()
        this.neighbours[EDGE_CODE_SOUTH]    = new Set()
        this.neighbours[EDGE_CODE_EAST]     = new Set()

        /** @type { [ Set<string>, Set<string>, Set<string>, Set<string> ] } */
        this.edges = new Array(4)
        this.edges[EDGE_CODE_NORTH]         = new Set()
        this.edges[EDGE_CODE_WEST]          = new Set()
        this.edges[EDGE_CODE_SOUTH]         = new Set()
        this.edges[EDGE_CODE_EAST]          = new Set()

        // Update division coordinates if globalRange provided
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

        this.edges[EDGE_CODE_NORTH].clear()
        this.edges[EDGE_CODE_WEST].clear()
        this.edges[EDGE_CODE_SOUTH].clear()
        this.edges[EDGE_CODE_EAST].clear()
        this.edgeCalculated = false
    }

    /**
     * @param { GridEdgeRecoder } edgeRecoder 
     */
    calcEdges(edgeRecoder) {

        if (this.edgeCalculated) return

        // Calculate north edges
        this.calcHorizontalEdges(edgeRecoder, EDGE_CODE_NORTH, EDGE_CODE_SOUTH)
        // Calculate sourth edges
        this.calcHorizontalEdges(edgeRecoder, EDGE_CODE_SOUTH, EDGE_CODE_NORTH)
        // Calculate west edges
        this.calcVerticalEdges(edgeRecoder, EDGE_CODE_WEST, EDGE_CODE_EAST)
        // Calculate east edges
        this.calcVerticalEdges(edgeRecoder, EDGE_CODE_EAST, EDGE_CODE_WEST)
        
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

    get edgeKeys() {

        return [
            ...this.edges[EDGE_CODE_NORTH],
            ...this.edges[EDGE_CODE_WEST],
            ...this.edges[EDGE_CODE_SOUTH],
            ...this.edges[EDGE_CODE_EAST]
        ]
    }

    /**
     * @param { GridEdgeRecoder } edgeRecoder 
     * @param { number } edgeCode
     * @param { number } opEdgeCode
     */
    calcHorizontalEdges(edgeRecoder, edgeCode, opEdgeCode) {

        let neighbours = [...this.neighbours[edgeCode]]

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < this.level) {

            const edge = edgeRecoder.getEdgeByInfo(this, neighbours[0], edgeCode, [ ...this._xMinPercent, ...this._xMaxPercent ])
            this.addEdge(edge, edgeCode)
            neighbours[0].addEdge(edge, opEdgeCode)
            return
        }

        // Case when neighbours have equal or higher levels ////////////////////////////////////////
        
        neighbours = neighbours.filter(neighbour => neighbour.level >= this.level)
        const xPercentSet = new Set([ this.xMinPercent, this.xMaxPercent ])
        neighbours.forEach(neighbour => {
            xPercentSet.add(neighbour.xMinPercent)
            xPercentSet.add(neighbour.xMaxPercent)
        })
        const xPercentList = [...xPercentSet].sort((x1, x2) => x1 - x2)

        // Iterate sub-edges and find their neighbours
        // If a sub-edge:
        // - [Situation 1] belongs to a neighbour ( add it to <this> and <neighbour> )
        // - [Situation 2] does not belong to any neighbour ( only add it to <this> )
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

            // Situation 1
            // X -->
            // From   Neighbour     To
            // |____________________|

            if (fromIndex === toIndex && fromIndex !== -1) {

                const neighbour = neighbours[fromIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, neighbour, edgeCode, [ ...neighbour._xMinPercent, ...neighbour._xMaxPercent ])
                this.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)

            }

            // Situation 2 - Case 1
            // X -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...this._xMinPercent, ...this._xMaxPercent ])
                this.addEdge(edge, edgeCode)

            }

            // Situation 2 - Case 2
            // X -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...fromNeighbour._xMaxPercent, ...toNeighbour._xMinPercent ])
                this.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 3
            // X -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...fromNeighbour._xMaxPercent, ...this._xMaxPercent ])
                this.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 4
            // X -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...this._xMinPercent, ...toNeighbour._xMinPercent ])
                this.addEdge(edge, edgeCode)
            }
        }
    }

    /**
     * @param { GridEdgeRecoder } edgeRecoder 
     * @param { number } edgeCode
     * @param { number } opEdgeCode
     */
    calcVerticalEdges(edgeRecoder, edgeCode, opEdgeCode) {

        let neighbours = [...this.neighbours[edgeCode]]

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < this.level) {

            const edge = edgeRecoder.getEdgeByInfo(this, neighbours[0], edgeCode, [ ...this._yMinPercent, ...this._yMaxPercent ])
            this.addEdge(edge, edgeCode)
            neighbours[0].addEdge(edge, opEdgeCode)
            return
        }

        // Case when neighbours have equal or higher levels ////////////////////////////////////////
        
        neighbours = neighbours.filter(neighbour => neighbour.level >= this.level)
        const yPercentSet = new Set([ this.yMinPercent, this.yMaxPercent ])
        neighbours.forEach(neighbour => {
            yPercentSet.add(neighbour.yMinPercent)
            yPercentSet.add(neighbour.yMaxPercent)
        })
        const yPercentList = [...yPercentSet].sort((y1, y2) => y1 - y2)

        // Iterate sub-edges and find their neighbours
        // If a sub-edge:
        // - [Situation 1] belongs to a neighbour ( add it to <this> and <neighbour> )
        // - [Situation 2] does not belong to any neighbour ( only add it to <this> )
        for (let i = 0; i < yPercentList.length - 1; i++) {

            const from = yPercentList[i]
            const to = yPercentList[i + 1]

            let fromIndex = -1
            let toIndex = -1
            for (let j = 0; j < neighbours.length; j++) {

                const neighbour = neighbours[j]
                const yMinPercent = neighbour.yMinPercent
                const yMaxPercent = neighbour.yMaxPercent

                if (yMinPercent === from || yMaxPercent === from) fromIndex = j
                if (yMinPercent === to || yMaxPercent === to) toIndex = j
                if (fromIndex !== -1 && toIndex !== -1) break
            }

            // Situation 1
            // Y -->
            // From   Neighbour     To
            // |____________________|

            if (fromIndex === toIndex && fromIndex !== -1) {

                const neighbour = neighbours[fromIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, neighbour, edgeCode, [ ...neighbour._yMinPercent, ...neighbour._yMaxPercent ])
                this.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)

            }

            // Situation 2 - Case 1
            // Y -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...this._yMinPercent, ...this._yMaxPercent ])
                this.addEdge(edge, edgeCode)

            }

            // Situation 2 - Case 2
            // Y -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...fromNeighbour._yMaxPercent, ...toNeighbour._yMinPercent ])
                this.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 3
            // Y -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...fromNeighbour._yMaxPercent, ...this._yMaxPercent ])
                this.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 4
            // Y -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = edgeRecoder.getEdgeByInfo(this, null, edgeCode, [ ...this._yMinPercent, ...toNeighbour._yMinPercent ])
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
  
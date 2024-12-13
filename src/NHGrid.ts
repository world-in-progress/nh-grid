import proj4 from 'proj4'
import { BoundingBox2D } from './boundingBox2D'
import { MercatorCoordinate } from './mercatorCoordinate'
import Dispatcher from './core/message/dispatcher'

export const EDGE_CODE_NORTH   = 0b00
export const EDGE_CODE_WEST    = 0b01
export const EDGE_CODE_SOUTH   = 0b10
export const EDGE_CODE_EAST    = 0b11
export const EDGE_CODE_INVALID = -1

export type EDGE_CODE = typeof EDGE_CODE_NORTH | typeof EDGE_CODE_WEST | typeof EDGE_CODE_SOUTH | typeof EDGE_CODE_EAST

export interface GridEdgeSerializedInfo {
    edgeCode: number
    adjGrids: [ string, string ]
    minPercent: [ number, number ]
    maxPercent: [ number, number ]
}

export interface GridNodeSerializedInfo {
    xMinPercent: [ number, number ]
    yMinPercent: [ number, number ]
    xMaxPercent: [ number, number ]
    yMaxPercent: [ number, number ]
}

export interface GridNodeOptions {
    localId: number,
    globalId: number,
    storageId: number,
    parent?: GridNode,
    globalRange?: [ number, number ]
}

/*
   ----- 0b00 -----
  |                |
  0b01   Grid    0b11
  |                |
   ----- 0b10 ----- 
*/
export class GridEdge {

    key: string
    properties: { [ key:string ]: any }

    constructor(key: string, properties: string[] | undefined) {

        this.key = key
        this.properties = {}

        if (properties) {
            for (const key of properties) 
                this.properties[key] = undefined
        }
    }

    private _getKeyArray(): (number | 'null')[] {

        return this.key.split('-').map(value => {
            return value === 'null' ? 'null' : Number(value)
        })
    }

    static createKey(grid1: GridNode | null, grid2: GridNode | null, edgeCode: number, range: [ number, number, number, number ]): string {

        const key1 = grid1 ? `${grid1.level}-${grid1.globalId}` : 'null-null'
        const key2 = grid2 ? `-${grid2.level}-${grid2.globalId}` : '-null-null'
        const key3 = `-${range[0]}-${range[1]}-${range[2]}-${range[3]}`
        const key4 = `-${edgeCode}`

        return key1 + key2 + key3 + key4
    }

    get opKey(): string {
        return GridEdge.getOpKey(this.key)
    }

    get serialization(): GridEdgeSerializedInfo {
        
        const keyArray = this._getKeyArray()

        return {
            adjGrids: [ 
                [ keyArray[0], keyArray[1] ].join('-'), // [ grid1 ] level-globalId
                [ keyArray[2], keyArray[3] ].join('-')  // [ grid2 ] level-globalId
            ],
            minPercent: [ keyArray[4] as number, keyArray[5] as number ],
            maxPercent: [ keyArray[6] as number, keyArray[7] as number ],
            edgeCode: keyArray[8] as number
        }
    }

    static getToggleEdgeCode(code: number): EDGE_CODE | typeof EDGE_CODE_INVALID {

        switch (code) {
            case EDGE_CODE_NORTH:
                return EDGE_CODE_SOUTH

            case EDGE_CODE_WEST:
                return EDGE_CODE_EAST

            case EDGE_CODE_SOUTH:
                return EDGE_CODE_NORTH

            case EDGE_CODE_EAST:
                return EDGE_CODE_WEST
            default:
                console.error('Provided edge code is invalid.')
                return EDGE_CODE_INVALID
        }
    }

    static getOpKey(key: string): string {

        const keyArray = key.split('-').map((value, index) => {
            if (index === 8) {
                return GridEdge.getToggleEdgeCode(Number(value));
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

export class GridEdgeRecorder {

    private _edgeMap: Map<string, GridEdge>
    private _properties: string[] | undefined

    constructor(properties?: string[]) {

        this._edgeMap = new Map<string, GridEdge>()
        this._properties = properties
    }

    get edges(): MapIterator<GridEdge> {

        return this._edgeMap.values()
    }

    getEdgeByInfo(grid1: GridNode | null, grid2: GridNode | null, edgeCode: number, range: [ number, number, number, number ]): GridEdge {

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

    addEdge(edge: GridEdge | null | undefined): void {

        if (!edge) return

        const key = edge.key
        const opKey = GridEdge.getOpKey(key)

        const existingEdge = this._edgeMap.get(key) || this._edgeMap.get(opKey)
        if (!existingEdge) {
            this._edgeMap.set(key, edge)
        }
    }
    
    getEdgeByKey(key: string): GridEdge | null {

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

    private _xMinPercent: [ number, number ]
    private _xMaxPercent: [ number, number ]
    private _yMinPercent: [ number, number ]
    private _yMaxPercent: [ number, number ]

    hit: boolean
    edgeCalculated: boolean

    level: number
    localId: number
    globalId: number
    storageId: number

    parent: GridNode | undefined
    children: (GridNode | null)[]
    
    edges: [ Set<string>, Set<string>, Set<string>, Set<string> ]
    neighbours: [ Set<GridNode>, Set<GridNode>, Set<GridNode>, Set<GridNode> ]

    constructor(options: GridNodeOptions) {

        this.hit = false
        this.edgeCalculated = false

        this.parent = options.parent
        this.localId = options.localId
        this.globalId = options.globalId
        this.storageId = options.storageId
        this.level = options.parent !== undefined ? options.parent.level + 1 : 0

        this.children = []

        // Division Coordinates [ numerator, denominator ] 
        // Use integer numerators and denominators to avoid coordinate precision issue
        this._xMinPercent = [ 0, 1 ]
        this._xMaxPercent = [ 1, 1 ]
        this._yMinPercent = [ 0, 1 ]
        this._yMaxPercent = [ 1, 1 ]
        
        this.neighbours = [ 
            new Set<GridNode>(),
            new Set<GridNode>(),
            new Set<GridNode>(),
            new Set<GridNode>()
        ]

        this.edges = [
            new Set<string>(),
            new Set<string>(),
            new Set<string>(),
            new Set<string>()
        ]

        // Update division coordinates if globalRange provided
        if (options.globalRange) {

            const [ width, height ] = options.globalRange
            const globalU = this.globalId % width
            const globalV = Math.floor(this.globalId / width)

            this._xMinPercent = simplifyFraction(globalU, width)
            this._xMaxPercent = simplifyFraction(globalU + 1, width)
            this._yMinPercent = simplifyFraction(globalV, height)
            this._yMaxPercent = simplifyFraction(globalV + 1, height)
        }
    }

    get xMinPercent(): number {

        return this._xMinPercent[0] / this._xMinPercent[1]
    }

    get xMaxPercent(): number {

        return this._xMaxPercent[0] / this._xMaxPercent[1]
    }

    get yMinPercent(): number {

        return this._yMinPercent[0] / this._yMinPercent[1]
    }

    get yMaxPercent(): number {

        return this._yMaxPercent[0] / this._yMaxPercent[1]
    }

    resetEdges(): void {

        this.edgeCalculated = false
        this.edges.forEach(edge => edge.clear())
    }

    calcEdges(edgeRecoder: GridEdgeRecorder): void {

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

    addEdge(edge: GridEdge, edgeCode: number): void {

        if (!this.edges[edgeCode].has(edge.key) && !this.edges[edgeCode].has(edge.opKey)){
            this.edges[edgeCode].add(edge.key)
        }
    }

    get edgeKeys(): string[] {

        return [
            ...this.edges[EDGE_CODE_NORTH],
            ...this.edges[EDGE_CODE_WEST],
            ...this.edges[EDGE_CODE_SOUTH],
            ...this.edges[EDGE_CODE_EAST]
        ]
    }

    get serialization() {

        return {
            xMinPercent: this._xMinPercent,
            yMinPercent: this._yMinPercent,
            xMaxPercent: this._xMaxPercent,
            yMaxPercent: this._yMaxPercent
        }
    }
    
    calcHorizontalEdges(edgeRecoder: GridEdgeRecorder, edgeCode: number, opEdgeCode: number): void {

        let neighbours = [ ...this.neighbours[edgeCode] ]

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
    
    calcVerticalEdges(edgeRecoder: GridEdgeRecorder, edgeCode: number, opEdgeCode: number): void {

        let neighbours = [ ...this.neighbours[edgeCode] ]

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

    getVertices(srcCS: string, bBox: BoundingBox2D) {

        const xMin = lerp(bBox.xMin, bBox.xMax, this.xMinPercent)
        const yMin = lerp(bBox.yMin, bBox.yMax, this.yMinPercent)
        const xMax = lerp(bBox.xMin, bBox.xMax, this.xMaxPercent)
        const yMax = lerp(bBox.yMin, bBox.yMax, this.yMaxPercent)
        
        const targetTL = proj4(srcCS, `EPSG:4326`, [ xMin, yMax ])  // srcTL
        const targetTR = proj4(srcCS, `EPSG:4326`, [ xMax, yMax ])  // srcTR
        const targetBL = proj4(srcCS, `EPSG:4326`, [ xMin, yMin ])  // srcBL
        const targetBR = proj4(srcCS, `EPSG:4326`, [ xMax, yMin ])  // srcBR

        const renderTL = MercatorCoordinate.fromLonLat(targetTL as [ number, number ])
        const renderTR = MercatorCoordinate.fromLonLat(targetTR as [ number, number ])
        const renderBL = MercatorCoordinate.fromLonLat(targetBL as [ number, number ])
        const renderBR = MercatorCoordinate.fromLonLat(targetBR as [ number, number ])

        return new Float32Array([
            renderTL[0], renderTL[1],
            renderTR[0], renderTR[1],
            renderBL[0], renderBL[1],
            renderBR[0], renderBR[1]
        ])
    }

    release(): null {

        this._xMinPercent = [ 0, 0 ]
        this._xMaxPercent = [ 0, 0 ]
        this._yMinPercent = [ 0, 0 ]
        this._yMaxPercent = [ 0, 0 ]

        this.edges.forEach(edgeSet => edgeSet.clear())
        this.neighbours.forEach((gridSet, edgeCode) => {
            gridSet.forEach(grid => {
                const opEdge = GridEdge.getToggleEdgeCode(edgeCode) as EDGE_CODE
                grid.neighbours[opEdge].delete(this)
            })
        })

        if (this.parent) {
            this.parent.children[this.localId] = null
        }
        this.parent = undefined
        this.children = []

        this.storageId = -1
        this.globalId = -1
        this.localId = -1
        this.level = -1

        this.edgeCalculated = false
        this.hit = false

        return null
    }
    
    equal(grid: GridNode): boolean {

        return (this.level === grid.level) && (this.globalId === grid.globalId)
    }
    
    within(bBox: BoundingBox2D, lon: number, lat: number): boolean {

        const xMin = lerp(bBox.xMin, bBox.xMax, this.xMinPercent)
        const yMin = lerp(bBox.yMin, bBox.yMax, this.yMinPercent)
        const xMax = lerp(bBox.xMin, bBox.xMax, this.xMaxPercent)
        const yMax = lerp(bBox.yMin, bBox.yMax, this.yMaxPercent) 

        if (lon < xMin || lat < yMin || lon > xMax || lat > yMax) return false
        return true
    }
}

export type SubdivideRules = [ number, number ][]

export interface GridLevelInfo {
    width: number
    height: number
    grids: (GridNode | undefined)[]
}

export class GridNodeRecorder {

    private _levelInfos: GridLevelInfo[]
    private _subdivideRules: SubdivideRules
    private _dispatcher = new Dispatcher(this)

    registeredGridCount = 0
    storageId_grid_map= new Map<number, GridNode>()

    constructor(subdivideRules: SubdivideRules) {

        this._levelInfos = [
            {
                width: 1,
                height: 1,
                grids: [
                    new GridNode({ localId: 0, globalId: 0, storageId: this.registeredGridCount++ })
                ]
            }
        ]

        this._subdivideRules = subdivideRules
        this._subdivideRules.forEach((_, level, rules) => {
            if (level == 0) return

            const width = this._levelInfos[level - 1].width * rules[level - 1][0]
            const height = this._levelInfos[level - 1].height * rules[level - 1][1]

            this._levelInfos[level] = {
                width, height,
                grids: new Array<GridNode>(width * height)
            }
        })
    }

    private get _actor() {
        return this._dispatcher.getActor()
    }

    private _getNode(u: number, v: number, level: number): GridNode | undefined {

        const width = this._levelInfos[level].width
        const height = this._levelInfos[level].height

        if (u < 0 || u >= width || v < 0 || v > height) return undefined

        const globalId = v * width + u
        return this._levelInfos[level].grids[globalId]
    }

    get levelInfos() {

        return this._levelInfos
    }

    findNeighbours(): void {
            
        /* ------------------------------------------------------------------
                                            |
            Neighbours around a grid        |       Edges around a node   
                                            |
                      tGrid                 |         ----- 0b00 -----
                        |                   |        |                |
             lGrid -- GRID -- rGrid         |        0b01   NODE   0b11
                        |                   |        |                |
                      bGrid                 |         ----- 0b10 ----- 
                                            |
        ------------------------------------------------------------------ */

        /** 
         * Get all valid grids.  
         * 
         * Features about so-called VALID:
         * 1. Is always hit
         * 2. Level is never 0
         * 3. Is always a leaf grid
        */
        const validGrids: GridNode[] = []
        this.storageId_grid_map.forEach(grid => {
            if (grid.hit) validGrids.push(grid)
        })

        // Iterate all valid grids and find their neighbours
        validGrids.forEach(grid => {

            const level = grid.level
            const width = this._levelInfos[level].width

            const globalU = grid.globalId % width
            const globalV = Math.floor(grid.globalId / width)

            const tGrid = this._getNode(globalU, globalV + 1, level)
            const lGrid = this._getNode(globalU - 1, globalV, level)
            const bGrid = this._getNode(globalU, globalV - 1, level)
            const rGrid = this._getNode(globalU + 1, globalV, level)

            // Check top edge with tGrid
            if (tGrid) {

                // Get all children of tGrid, adjacent to grid

                const adjChildren: GridNode[] = []
                const stack: GridNode[] = [ tGrid ]
                
                while(stack.length) {
                    const _grid = stack.pop()!

                    if (_grid.children.length) {
                        const subWidth = this._subdivideRules[_grid.level][0]
                        const children = _grid.children.filter(child => child !== null)
                        stack.push(...children.filter(child => child.localId < subWidth))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_NORTH].add(child)
                    child.neighbours[EDGE_CODE_SOUTH].add(grid)
                })
            }

            // Check left edge with lGrid
            if (lGrid) {

                // Get all children of lGrid, adjacent to grid

                const adjChildren: GridNode[] = []
                const stack: GridNode[] = [ lGrid ]

                while(stack.length) {
                    const _grid = stack.pop()!

                    if (_grid.children.length) {
                        const subWidth = this._subdivideRules[_grid.level][0]
                        const children = _grid.children.filter(child => child !== null)
                        stack.push(...children.filter(child => child.localId % subWidth === subWidth - 1))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_WEST].add(child)
                    child.neighbours[EDGE_CODE_EAST].add(grid)
                })
            }

            // Check bottom edge with rGrid
            if (bGrid) {

                // Get all children of bGrid, adjacent to grid

                const adjChildren: GridNode[] = []
                const stack: GridNode[] = [ bGrid ]

                while(stack.length) {
                    const _grid = stack.pop()!

                    if (_grid.children.length) {
                        const [ subWidth, subHeight ] = this._subdivideRules[_grid.level]
                        const children = _grid.children.filter(child => child !== null)
                        stack.push(...children.filter(child => child.localId >= subWidth * (subHeight - 1)))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_SOUTH].add(child)
                    child.neighbours[EDGE_CODE_NORTH].add(grid)
                })
            }

            // Check right edge with rGrid
            if (rGrid) {

                // Get all children of rGrid, adjacent to grid
                
                const adjChildren: GridNode[] = []
                const stack: GridNode[] = [ rGrid ]

                while(stack.length) {
                    const _grid = stack.pop()!

                    if (_grid.children.length) {
                        const subWidth = this._subdivideRules[_grid.level][0]
                        const children = _grid.children.filter(child => child !== null)
                        stack.push(...children.filter(child => child.localId % subWidth === 0))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_EAST].add(child)
                    child.neighbours[EDGE_CODE_WEST].add(grid)
                })
            }

            grid.resetEdges()
        })
    }

    getGridLocalId(level: number, globalId: number) {
        if (level === 0) return 0
    
        const { width } = this._levelInfos[level]
        const [ subWidth, subHeight ] = this._subdivideRules[level - 1]
    
        const u = globalId % width
        const v = Math.floor(globalId / width)
    
        return ((v % subHeight) * subWidth) + (u % subWidth)
    }

    getParentGlobalId(level: number, globalId: number): number {
        if (level === 0) return 0

        const { width } = this._levelInfos[level]
        const [ subWidth, subHeight ] = this._subdivideRules[level - 1]

        const u = globalId % width
        const v = Math.floor(globalId / width)

        return Math.floor(v / subHeight) * this._levelInfos[level - 1].width + Math.floor(u / subWidth)
    }
    
    subdivideGrid(level: number, globalId: number, callback?: Function): void {

        // Subdivide parent if this grid does not exist
        if (!this._levelInfos[level].grids[globalId]) this.subdivideGrid(level - 1, this.getParentGlobalId(level, globalId), callback)

        const grid = this._levelInfos[level].grids[globalId]!
        const [ subWidth, subHeight ] = this._subdivideRules[grid.level]

        // Return if grid's children are all existed
        if (grid.children.length > 0 && grid.children.every(child => child !== null)) return

        // Subdivide
        const globalU = globalId % this._levelInfos[level].width
        const globalV = Math.floor(globalId / this._levelInfos[level].width)
        const subGlobalWidth = this._levelInfos[level + 1].width
        const subGlobalHeight = this._levelInfos[level + 1].height

        for (let localId = 0; localId < subWidth * subHeight; localId++) {

            if (grid.children[localId]) continue

            const subU = localId % subWidth
            const subV = Math.floor(localId / subWidth)

            const subGlobalU = globalU * subWidth + subU
            const subGlobalV = globalV * subHeight + subV
            const subGlobalId = subGlobalV * (this._levelInfos[level].width * subWidth) + subGlobalU

            const subGrid = new GridNode({
                localId,
                parent: grid,
                globalId: subGlobalId,
                storageId: this.registeredGridCount++,
                globalRange: [ subGlobalWidth, subGlobalHeight ]
            })
            
            grid.children[localId] = subGrid
            this._levelInfos[level + 1].grids[subGlobalId] = subGrid
            this.storageId_grid_map.set(subGrid.storageId, subGrid)

            callback && callback(subGrid)
        }
        
        this._actor.send('hello', null)
    }

    removeGrid(grid: GridNode, callback?: Function) {

        if (!grid) return

        // Find last valid grid
        const lastValidGrid = this.storageId_grid_map.get(this.registeredGridCount - 1)!
        this.storageId_grid_map.delete(lastValidGrid.storageId)

        // Overwrite the texture data of this deleted grid to the valid one
        if (!lastValidGrid.equal(grid)) {

            this.storageId_grid_map.set(grid.storageId, lastValidGrid)
            lastValidGrid.storageId = grid.storageId
            callback && callback(lastValidGrid)
        }

        // Remove
        this._levelInfos[grid.level].grids[grid.globalId] = undefined
        this.registeredGridCount--
        grid.release()
    }

    getGrid(level: number, globalId: number): GridNode | undefined {

        return this._levelInfos[level].grids[globalId]
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function lerp(a: number, b: number, t: number): number {
    return (1.0 - t) * a + t * b
}

function gcd(a: number, b: number): number {

    while (b !== 0) {
        const temp = b
        b = a % b
        a = temp
    }
    
    return a
}
  
function simplifyFraction(n: number, m: number): [ number, number ] {

    const divisor = gcd(n, m)
    return [ n / divisor, m / divisor ]
}
  
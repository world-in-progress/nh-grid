import { DbAction } from './../database/db'
import Dispatcher from "../message/dispatcher"
import { EDGE_CODE, EDGE_CODE_EAST, EDGE_CODE_NORTH, EDGE_CODE_SOUTH, EDGE_CODE_WEST, GridEdge, GridNode, GridNodeRecord, GridNodeRenderInfo, GridNodeRenderInfoPack, SubdivideRules } from "./NHGrid"
import { Callback } from '../types'
import proj4 from 'proj4'
import { MercatorCoordinate } from '../math/mercatorCoordinate'
proj4.defs("ESRI:102140", "+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +units=m +no_defs +type=crs")

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

    calcGridEdges(grid: GridNode, nodeRecorder: GridNodeManager): void {

        if (grid.edgeCalculated) return

        // Calculate north edges
        this._calcHorizontalEdges(grid, nodeRecorder.getGridNeighbours(grid, EDGE_CODE_NORTH), EDGE_CODE_NORTH, EDGE_CODE_SOUTH)
        // Calculate sourth edges
        this._calcHorizontalEdges(grid, nodeRecorder.getGridNeighbours(grid, EDGE_CODE_SOUTH), EDGE_CODE_SOUTH, EDGE_CODE_NORTH)
        // Calculate west edges
        this._calcVerticalEdges(grid, nodeRecorder.getGridNeighbours(grid, EDGE_CODE_SOUTH), EDGE_CODE_WEST, EDGE_CODE_EAST)
        // Calculate east edges
        this._calcVerticalEdges(grid, nodeRecorder.getGridNeighbours(grid, EDGE_CODE_SOUTH), EDGE_CODE_EAST, EDGE_CODE_WEST)
        
        grid.edgeCalculated = true
    }
    
    private _calcHorizontalEdges(grid: GridNode, neighbours: GridNode[], edgeCode: number, opEdgeCode: number): void {

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < grid.level) {

            const edge = this.getEdgeByInfo(grid, neighbours[0], edgeCode, [ ...grid.xMinPercent, ...grid.xMaxPercent ])
            grid.addEdge(edge, edgeCode)
            neighbours[0].addEdge(edge, opEdgeCode)
            return
        }

        // Case when neighbours have equal or higher levels ////////////////////////////////////////
        
        neighbours = neighbours.filter(neighbour => neighbour.level >= grid.level)
        const xSet = new Set([ grid.xMin, grid.xMax ])
        neighbours.forEach(neighbour => {
            xSet.add(neighbour.xMin)
            xSet.add(neighbour.xMax)
        })
        const xPercentList = [...xSet].sort((x1, x2) => x1 - x2)

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
                const xMin = neighbour.xMin
                const xMax = neighbour.xMax

                if (xMin === from || xMax === from) fromIndex = j
                if (xMin === to || xMax === to) toIndex = j
                if (fromIndex !== -1 && toIndex !== -1) break
            }

            // Situation 1
            // X -->
            // From   Neighbour     To
            // |____________________|

            if (fromIndex === toIndex && fromIndex !== -1) {

                const neighbour = neighbours[fromIndex]
                const edge = this.getEdgeByInfo(grid, neighbour, edgeCode, [ ...neighbour.xMinPercent, ...neighbour.xMaxPercent ])
                grid.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)

            }

            // Situation 2 - Case 1
            // X -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...grid.xMinPercent, ...grid.xMaxPercent ])
                grid.addEdge(edge, edgeCode)

            }

            // Situation 2 - Case 2
            // X -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...fromNeighbour.xMaxPercent, ...toNeighbour.xMinPercent ])
                grid.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 3
            // X -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...fromNeighbour.xMaxPercent, ...grid.xMaxPercent ])
                grid.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 4
            // X -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...grid.xMinPercent, ...toNeighbour.xMinPercent ])
                grid.addEdge(edge, edgeCode)
            }
        }
    }
    
    private _calcVerticalEdges(grid: GridNode, neighbours: GridNode[], edgeCode: number, opEdgeCode: number): void {

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < grid.level) {

            const edge = this.getEdgeByInfo(grid, neighbours[0], edgeCode, [ ...grid.yMinPercent, ...grid.yMaxPercent ])
            grid.addEdge(edge, edgeCode)
            neighbours[0].addEdge(edge, opEdgeCode)
            return
        }

        // Case when neighbours have equal or higher levels ////////////////////////////////////////
        
        neighbours = neighbours.filter(neighbour => neighbour.level >= grid.level)
        const ySet = new Set([ grid.yMin, grid.yMax ])
        neighbours.forEach(neighbour => {
            ySet.add(neighbour.yMin)
            ySet.add(neighbour.yMax)
        })
        const yList = [...ySet].sort((y1, y2) => y1 - y2)

        // Iterate sub-edges and find their neighbours
        // If a sub-edge:
        // - [Situation 1] belongs to a neighbour ( add it to <this> and <neighbour> )
        // - [Situation 2] does not belong to any neighbour ( only add it to <this> )
        for (let i = 0; i < yList.length - 1; i++) {

            const from = yList[i]
            const to = yList[i + 1]

            let fromIndex = -1
            let toIndex = -1
            for (let j = 0; j < neighbours.length; j++) {

                const neighbour = neighbours[j]
                const yMin = neighbour.yMin
                const yMax = neighbour.yMax

                if (yMin === from || yMax === from) fromIndex = j
                if (yMin === to || yMax === to) toIndex = j
                if (fromIndex !== -1 && toIndex !== -1) break
            }

            // Situation 1
            // Y -->
            // From   Neighbour     To
            // |____________________|

            if (fromIndex === toIndex && fromIndex !== -1) {

                const neighbour = neighbours[fromIndex]
                const edge = this.getEdgeByInfo(grid, neighbour, edgeCode, [ ...neighbour.yMinPercent, ...neighbour.yMaxPercent ])
                grid.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)

            }

            // Situation 2 - Case 1
            // Y -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...grid.yMinPercent, ...grid.yMaxPercent ])
                grid.addEdge(edge, edgeCode)

            }

            // Situation 2 - Case 2
            // Y -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...fromNeighbour.yMaxPercent, ...toNeighbour.yMinPercent ])
                grid.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 3
            // Y -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...fromNeighbour.yMaxPercent, ...grid.yMaxPercent ])
                grid.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 4
            // Y -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...grid.yMinPercent, ...toNeighbour.yMinPercent ])
                grid.addEdge(edge, edgeCode)
            }
        }
    }
}

export interface GridLevelInfo {
    width: number
    height: number
    grids: (GridNode | undefined)[]
}

export class GridNodeManager {

    private _levelInfos: GridLevelInfo[]
    private _projConverter: proj4.Converter
    private _subdivideRules: SubdivideRules

    uuId_gridNode_map = new Map<string, GridNode>()

    constructor(subdivideRules: SubdivideRules) {
    
        this._projConverter = proj4(subdivideRules.srcCS, subdivideRules.targetCS)

        const rootGrid = new GridNode({ localId: 0, globalId: 0 })
        this.uuId_gridNode_map.set(rootGrid.uuId, rootGrid)
        this._levelInfos = [
            {
                width: 1,
                height: 1,
                grids: [ rootGrid ]
            }
        ]

        this._subdivideRules = subdivideRules
        this._subdivideRules.rules.forEach((_, level, rules) => {
            if (level == 0) return

            const width = this._levelInfos[level - 1].width * rules[level - 1][0]
            const height = this._levelInfos[level - 1].height * rules[level - 1][1]

            this._levelInfos[level] = {
                width, height,
                grids: new Array<GridNode>(width * height)
            }
        })
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
        this.uuId_gridNode_map.forEach(grid => {
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
                        const children = this.getGridChildren(_grid)
                        const subWidth = this._subdivideRules.rules[_grid.level][0]
                        stack.push(...children.filter(child => child.localId < subWidth))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_NORTH].add(child.uuId)
                    child.neighbours[EDGE_CODE_SOUTH].add(grid.uuId)
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
                        const children = this.getGridChildren(_grid)
                        const subWidth = this._subdivideRules.rules[_grid.level][0]
                        stack.push(...children.filter(child => child.localId % subWidth === subWidth - 1))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_WEST].add(child.uuId)
                    child.neighbours[EDGE_CODE_EAST].add(grid.uuId)
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
                        const children = this.getGridChildren(_grid)
                        const [ subWidth, subHeight ] = this._subdivideRules.rules[_grid.level]
                        stack.push(...children.filter(child => child.localId >= subWidth * (subHeight - 1)))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_SOUTH].add(child.uuId)
                    child.neighbours[EDGE_CODE_NORTH].add(grid.uuId)
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
                        const children = this.getGridChildren(_grid)
                        const subWidth = this._subdivideRules.rules[_grid.level][0]
                        stack.push(...children.filter(child => child.localId % subWidth === 0))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_EAST].add(child.uuId)
                    child.neighbours[EDGE_CODE_WEST].add(grid.uuId)
                })
            }

            grid.resetEdges()
        })
    }

    getGridLocalId(level: number, globalId: number) {
        if (level === 0) return 0
    
        const { width } = this._levelInfos[level]
        const [ subWidth, subHeight ] = this._subdivideRules.rules[level - 1]
    
        const u = globalId % width
        const v = Math.floor(globalId / width)
    
        return ((v % subHeight) * subWidth) + (u % subWidth)
    }

    getParentGlobalId(level: number, globalId: number): number {
        if (level === 0) return 0

        const { width } = this._levelInfos[level]
        const [ subWidth, subHeight ] = this._subdivideRules.rules[level - 1]

        const u = globalId % width
        const v = Math.floor(globalId / width)

        return Math.floor(v / subHeight) * this._levelInfos[level - 1].width + Math.floor(u / subWidth)
    }

    getGrid(uuId: string): GridNode | undefined
    getGrid(level: number, globalId: number): GridNode | undefined
    getGrid(uuIdOrLevel?: string | number, globalId?: number): GridNode | undefined {

        if (typeof uuIdOrLevel === 'string') {

            const keys = uuIdOrLevel.split('-').map(key => Number(key))
            if (keys.length !== 2 || isNaN(keys[0]) || isNaN(keys[1])) {
                throw new Error(`Invalid uuId format: ${uuIdOrLevel}`)
            }
            const [ level, globalId ] = keys
            
            return this._levelInfos[level]?.grids[globalId]

        } else if (typeof uuIdOrLevel === 'number' && typeof globalId === 'number') {

            if (uuIdOrLevel < 0) {
                throw new Error(`Invalid level ${uuIdOrLevel}`)
            }

            return this._levelInfos[uuIdOrLevel]?.grids[globalId]

        } else {

            throw new Error('Invalid calling of getGrid')
        }
    }

    getGridParent(grid: GridNode): GridNode | undefined {

        if (grid.level === 0) return undefined
        
        const parentId = this.getParentGlobalId(grid.level, grid.globalId)
        return this.getGrid(grid.level - 1, parentId)
    }

    getGridNeighbours(grid: GridNode, edgeCode: EDGE_CODE): GridNode[] {

        const neighbour_storageIds = [ ...grid.neighbours[edgeCode] ]
        return neighbour_storageIds.map(id => this.uuId_gridNode_map.get(id)).filter(node => node !== undefined)
    }

    getGridChildren(grid: GridNode): GridNode[] {

        return grid.children.filter(childId => childId !== null)
        .map(childId => this.uuId_gridNode_map.get(childId)).filter(node => node !== undefined)
    }
    
    subdivideGrid(level: number, globalId: number): GridNodeRenderInfoPack {
        
        const { width: levelWidth } = this._levelInfos[level]
        const globalU = globalId % levelWidth
        const globalV = Math.floor(globalId / levelWidth)

        const nextLevelInfo = this._levelInfos[level + 1]
        const { width: subGlobalWidth, height: subGlobalHeight } = nextLevelInfo

        const [ subWidth, subHeight ] = this._subdivideRules.rules[level]
        const subCount = subWidth * subHeight

        // Create render information pack
        const renderInfoPack: GridNodeRenderInfoPack = {
            uuIds: new Array<string>(subWidth * subHeight),
            vertexBuffer: new Float32Array(subWidth * subHeight * 8)
        }

        const baseGlobalWidth = levelWidth * subWidth
        for (let localId = 0; localId < subCount; localId++) {

            const subU = localId % subWidth
            const subV = Math.floor(localId / subWidth)

            const subGlobalU = globalU * subWidth + subU
            const subGlobalV = globalV * subHeight + subV
            const subGlobalId = subGlobalV * baseGlobalWidth + subGlobalU

            this._createNodeRenderInfo(level + 1, localId, subGlobalId, [ subGlobalWidth, subGlobalHeight ], renderInfoPack)
        }

        return renderInfoPack
    }

    private _getNode(u: number, v: number, level: number): GridNode | undefined {

        const width = this._levelInfos[level].width
        const height = this._levelInfos[level].height

        if (u < 0 || u >= width || v < 0 || v > height) return undefined

        const globalId = v * width + u
        return this._levelInfos[level].grids[globalId]
    }
    
    private _createNodeRenderInfo(
        level: number, 
        localId: number, 
        globalId: number, 
        globalRange: [ width: number, height: number ], 
        infoPack: GridNodeRenderInfoPack
    ) {
        const [ width, height ] = globalRange
        const bBox = this._subdivideRules.bBox

        const globalU = globalId % width
        const globalV = Math.floor(globalId / width)

        const xMin = lerp(bBox.xMin, bBox.xMax, globalU / width)
        const yMin = lerp(bBox.yMin, bBox.yMax, globalV / height)
        const xMax = lerp(bBox.xMin, bBox.xMax, (globalU + 1) / width)
        const yMax = lerp(bBox.yMin, bBox.yMax, (globalV + 1) / height)
        
        const targetCoords = [
            this._projConverter.forward([xMin, yMax]),  // srcTL
            this._projConverter.forward([xMax, yMax]),  // srcTR
            this._projConverter.forward([xMin, yMin]),  // srcBL
            this._projConverter.forward([xMax, yMin]),  // srcBR
        ]

        const renderCoords = targetCoords.map(coord => MercatorCoordinate.fromLonLat(coord as [ number, number ]))

        infoPack.uuIds[localId] = `${level}-${globalId}`
        const nodeCount = infoPack.vertexBuffer.length / 8

        infoPack.vertexBuffer[nodeCount * 0 + localId * 2 + 0] = renderCoords[0][0]
        infoPack.vertexBuffer[nodeCount * 0 + localId * 2 + 1] = renderCoords[0][1]
        infoPack.vertexBuffer[nodeCount * 2 + localId * 2 + 0] = renderCoords[1][0]
        infoPack.vertexBuffer[nodeCount * 2 + localId * 2 + 1] = renderCoords[1][1]
        infoPack.vertexBuffer[nodeCount * 4 + localId * 2 + 0] = renderCoords[2][0]
        infoPack.vertexBuffer[nodeCount * 4 + localId * 2 + 1] = renderCoords[2][1]
        infoPack.vertexBuffer[nodeCount * 6 + localId * 2 + 0] = renderCoords[3][0]
        infoPack.vertexBuffer[nodeCount * 6 + localId * 2 + 1] = renderCoords[3][1]
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function lerp(a: number, b: number, t: number): number {
    return a + t * (b - a)
}

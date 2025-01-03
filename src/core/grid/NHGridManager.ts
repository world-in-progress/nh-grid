import proj4 from 'proj4'

import { 
    GridEdge, 
    GridNode, 
    SubdivideRules,

    EDGE_CODE_WEST, 
    EDGE_CODE_EAST, 
    EDGE_CODE_NORTH, 
    EDGE_CODE_SOUTH, 
    EDGE_CODE_INVALID, 

    type EDGE_CODE, 
    type GridNodeRenderInfoPack, 
    GridTopologyInfo
} from './NHGrid'
import { MercatorCoordinate } from '../math/mercatorCoordinate'

proj4.defs('ESRI:102140', '+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +units=m +no_defs +type=crs')

export class GridEdgeManager {

    // private _edgeMap: Map<string, GridEdge>
    // private _properties: string[] | undefined

    edge_gridStorageIds_map: Map<string, Array<number>> = new Map()

    constructor() {

        // this._edgeMap = new Map<string, GridEdge>()
        // this._properties = properties
    }

    // get edges(): MapIterator<GridEdge> {

    //     return this._edgeMap.values()
    // }

    getEdgeKeyByInfo(grid1: GridNode | null, grid2: GridNode | null, range: [ xMin: [ number, number ], yMin: [ number, number ], xMax: [ number, number ], yMax: [ number, number ] ]): string {

        const key = range.flatMap(coord => coord).join('-')
        const existingEdge = this.edge_gridStorageIds_map.has(key)

        if (existingEdge) {

            return key

        } else {

            // const edge = new GridEdge(key, this._properties)
            // this._edgeMap.set(key, edge)

            const girds = new Array<number>()
            if (grid1) girds.push(grid1.storageId)
            if (grid2) girds.push(grid2.storageId)
            this.edge_gridStorageIds_map.set(key, girds)

            return key
        }
    }
    
    // getEdgeByKey(key: string): GridEdge | null {

    //     const opKey = GridEdge.getOpKey(key)
    //     const existingEdge = this._edgeMap.get(key) || this._edgeMap.get(opKey)

    //     if (existingEdge) {

    //         return existingEdge

    //     } else {
            
    //         return null
    //     }
    // }

    calcGridEdges(grid: GridNode, neighbours: [ GridNode[], GridNode[], GridNode[], GridNode[] ]): void {

        // Calculate north edges
        this._calcHorizontalEdges(grid, neighbours[EDGE_CODE_NORTH], EDGE_CODE_NORTH, EDGE_CODE_SOUTH, grid.yMaxPercent)
        // Calculate sourth edges
        this._calcHorizontalEdges(grid, neighbours[EDGE_CODE_SOUTH], EDGE_CODE_SOUTH, EDGE_CODE_NORTH, grid.yMinPercent)
        // Calculate west edges
        this._calcVerticalEdges(grid, neighbours[EDGE_CODE_WEST], EDGE_CODE_WEST, EDGE_CODE_EAST, grid.xMinPercent)
        // Calculate east edges
        this._calcVerticalEdges(grid, neighbours[EDGE_CODE_EAST], EDGE_CODE_EAST, EDGE_CODE_WEST, grid.xMaxPercent)
    }
    
    private _calcHorizontalEdges(grid: GridNode, neighbours: GridNode[], edgeCode: number, opEdgeCode: number, sharedCoord: [ number, number ]): void {

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < grid.level) {

            const edge = this.getEdgeKeyByInfo(grid, neighbours[0], [ grid.xMinPercent, sharedCoord, grid.xMaxPercent, sharedCoord ])
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
                const edge = this.getEdgeKeyByInfo(grid, neighbour, [ neighbour.xMinPercent, sharedCoord, neighbour.xMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)
            }

            // Situation 2 - Case 1
            // X -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = this.getEdgeKeyByInfo(grid, null, [ grid.xMinPercent, sharedCoord, grid.xMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            }

            // Situation 2 - Case 2
            // X -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, [ fromNeighbour.xMaxPercent, sharedCoord, toNeighbour.xMinPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            } 

            // Situation 2 - Case 3
            // X -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, [ fromNeighbour.xMaxPercent, sharedCoord, grid.xMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            } 

            // Situation 2 - Case 4
            // X -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, [ grid.xMinPercent, sharedCoord, toNeighbour.xMinPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            }
        }
    }
    
    private _calcVerticalEdges(grid: GridNode, neighbours: GridNode[], edgeCode: number, opEdgeCode: number, sharedCoord: [ number, number ]): void {

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < grid.level) {

            const edge = this.getEdgeKeyByInfo(grid, neighbours[0], [ sharedCoord, grid.yMinPercent, sharedCoord, grid.yMaxPercent ])
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
                const edge = this.getEdgeKeyByInfo(grid, neighbour, [ sharedCoord, neighbour.yMinPercent, sharedCoord, neighbour.yMaxPercent ])
                grid.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)
            }

            // Situation 2 - Case 1
            // Y -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = this.getEdgeKeyByInfo(grid, null, [ sharedCoord, grid.yMinPercent, sharedCoord, grid.yMaxPercent ])
                grid.addEdge(edge, edgeCode)
            }

            // Situation 2 - Case 2
            // Y -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, [ sharedCoord, fromNeighbour.yMaxPercent, sharedCoord, toNeighbour.yMinPercent ])
                grid.addEdge(edge, edgeCode)
            } 

            // Situation 2 - Case 3
            // Y -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, [ sharedCoord, fromNeighbour.yMaxPercent, sharedCoord, grid.yMaxPercent ])
                grid.addEdge(edge, edgeCode)
            } 

            // Situation 2 - Case 4
            // Y -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, [ sharedCoord, grid.yMinPercent, sharedCoord, toNeighbour.yMinPercent ])
                grid.addEdge(edge, edgeCode)
            }
        }
    }
}

interface GridLevelInfo {
    width: number
    height: number
}

export type GridInfo = {
    uuId: string
    level: number
    localId: number
    globalId: number
}

export default class GridManager {

    private _levelInfos: GridLevelInfo[]
    private _projConverter: proj4.Converter
    private _subdivideRules: SubdivideRules

    constructor(subdivideRules: SubdivideRules) {
    
        this._projConverter = proj4(subdivideRules.srcCS, subdivideRules.targetCS)
        this._levelInfos = [ { width: 1, height: 1 } ]

        this._subdivideRules = subdivideRules
        this._subdivideRules.rules.forEach((_, level, rules) => {

            let width: number, height: number
            if (level == 0) {
                width = 1
                height = 1
            } else {
                width = this._levelInfos[level - 1].width * rules[level - 1][0]
                height = this._levelInfos[level - 1].height * rules[level - 1][1]
            }
            this._levelInfos[level] = { width, height }
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

    getGridChildren(level: number, globalId: number): number[] | null {

        if (level >= this._levelInfos.length || level < 0) return null
        
        const { width: levelWidth } = this._levelInfos[level]
        const globalU = globalId % levelWidth
        const globalV = Math.floor(globalId / levelWidth)

        const [ subWidth, subHeight ] = this._subdivideRules.rules[level]
        const subCount = subWidth * subHeight

        const children = new Array<number>(subCount)
        const baseGlobalWidth = levelWidth * subWidth
        for (let localId = 0; localId < subCount; localId++) {

            const subU = localId % subWidth
            const subV = Math.floor(localId / subWidth)

            const subGlobalU = globalU * subWidth + subU
            const subGlobalV = globalV * subHeight + subV
            const subGlobalId = subGlobalV * baseGlobalWidth + subGlobalU
            children[localId] = subGlobalId
        }

        return children
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

    parseTopology(gridInfo_cache: Array<number>): GridTopologyInfo {

        const edgeManager = new GridEdgeManager()
        const gridNum = gridInfo_cache.length / 2
        const uuId_storageId_map = new Map<string, number>()
        const storageId_grid_cache = new Array<GridNode>(gridNum)
        const storageId_neighbourStorageId_cache = new Array<[ Set<number>, Set<number>, Set<number>, Set<number> ]>(gridNum)

        // Fill uuId_storageId_map
        for (let i = 0; i < gridNum; i++) {
            const uuId = `${gridInfo_cache[i * 2]}-${gridInfo_cache[i * 2 + 1]}`
            uuId_storageId_map.set(uuId, i)
        }

        // Fill storageId_neighbours_cache
        for (let i = 0; i < gridNum; i++) {
            storageId_neighbourStorageId_cache[i] = [ new Set<number>(), new Set<number>(), new Set<number>(), new Set<number>() ]
        }
    
        // Set storageId_grid_cache
        for (let i = 0; i < gridNum; i++) {

            const level = gridInfo_cache[i * 2]
            const globalId = gridInfo_cache[i * 2 + 1]
            const { width, height } = this._levelInfos[level]

            storageId_grid_cache[i] = new GridNode({ 
                storageId: i,
                level, globalId, 
                globalRange: [ width, height ],
                localId: this.getGridLocalId(level, globalId)
            })
        }

        // Find neighbours /////////////////////////////////////////////////
            
        /* ------------------------------------------------------------------
                                            |
            Neighbours around a grid        |     Edges around a grid node   
                                            |
                      tGrid                 |         ----- 0b00 -----
                        |                   |        |                |
             lGrid -- GRID -- rGrid         |        0b01   NODE   0b11
                        |                   |        |                |
                      bGrid                 |         ----- 0b10 ----- 
                                            |
        ------------------------------------------------------------------ */

        // Iterate all grids and find their neighbours
        storageId_grid_cache.forEach(grid => {

            // const [ level, globalId ] = grid.uuId.split('-').map(key => +key)

            const width = this._levelInfos[grid.level].width

            const globalU = grid.globalId % width
            const globalV = Math.floor(grid.globalId / width)

            const tGridInfo = this._getGridInfoFromUV(grid.level, globalU, globalV + 1)
            const lGridinfo = this._getGridInfoFromUV(grid.level, globalU - 1, globalV)
            const bGridInfo = this._getGridInfoFromUV(grid.level, globalU, globalV - 1)
            const rGridInfo = this._getGridInfoFromUV(grid.level, globalU + 1, globalV)

            // Check top edge with tGrid
            tGridInfo && findNeighboursAlongEdge.call(this, grid, EDGE_CODE_NORTH, tGridInfo, (localId: number, subWidth: number, _: number) => localId < subWidth)

            // Check left edge with lGrid
            lGridinfo && findNeighboursAlongEdge.call(this, grid, EDGE_CODE_WEST, lGridinfo, (localId: number, subWidth: number, _: number) => localId % subWidth === subWidth - 1)

            // Check bottom edge with rGrid
            bGridInfo && findNeighboursAlongEdge.call(this, grid, EDGE_CODE_SOUTH, bGridInfo, (localId: number, subWidth: number, subHeight: number) => localId >= subWidth * (subHeight - 1))

            // Check right edge with rGrid
            rGridInfo && findNeighboursAlongEdge.call(this, grid, EDGE_CODE_EAST, rGridInfo, (localId: number, subWidth: number, _: number) => localId % subWidth === 0)
            
        })

        // Parse edges /////////////////////////////////////////////////

        let start = 0, end = 0
        start = Date.now()

        storageId_grid_cache.forEach(grid => edgeManager.calcGridEdges(grid, getGridNeighbours(grid.storageId)))

        end = Date.now()
        console.log('Cost time:', end - start)

        // Collect results /////////////////////////////////////////////////

        const edge_gridStorageIds_map = edgeManager.edge_gridStorageIds_map
        const edgeKeys = Array.from(edge_gridStorageIds_map.keys())
        const adjGrids = Array.from(edge_gridStorageIds_map.values())

        const storageId_edgeKeys_set = new Array<[ Set<string>, Set<string>, Set<string>, Set<string> ]>(gridNum)
        for (let storageId = 0; storageId < gridNum; storageId++) {
            storageId_edgeKeys_set[storageId] = [ new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>() ]
        }

        // Fill storageId_edgeKeys_set
        storageId_grid_cache.forEach(grid => {

            const storageId = grid.storageId
            const edgeKeys = grid.edgeKeys

            edgeKeys.forEach((edgeKey, edgeCode) => {

                storageId_edgeKeys_set[storageId][edgeCode].add(edgeKey)
            })
        })

        return {
            edgeKeys,
            adjGrids,
            storageId_edgeKeys_set,
        }

        // Local helpers /////////////////////////////////////////////////

        function findNeighboursAlongEdge(this: GridManager, grid: GridNode, edgeCode: EDGE_CODE, gridInfo: GridInfo, adjacentCheckFunc: Function) {

            // Check if gridInfo has storageId (This grid is a leaf node)
            const rootNeighbourGrid = uuId_storageId_map.get(gridInfo.uuId)
            if (rootNeighbourGrid) {
                
                const rootNeighbour = storageId_grid_cache[rootNeighbourGrid]
                updateGridNeighbour(grid.storageId, rootNeighbour, edgeCode)

            } else {

                // Get all children by gridInfo, adjacent to grid
                const adjChildren: GridNode[] = []
                const infoStack: GridInfo[] = [ gridInfo ]
                
                while(infoStack.length) {
                    const { level: _level, globalId: _globalId } = infoStack.pop()!

                    const children = this.getGridChildren(_level, _globalId)
                    if (!children) continue

                    const [ subWidth, subHeight ] = this._subdivideRules.rules[_level]
                    children.forEach((childGlobalId, childLocalId) => {

                        const isAdjacent = adjacentCheckFunc(childLocalId, subWidth, subHeight)
                        if (!isAdjacent) return

                        const childLevel = _level + 1
                        const childId = `${childLevel}-${childGlobalId}`
                        const child_storageId = uuId_storageId_map.get(childId)

                        // Check if child has storageId (This child is a leaf node)
                        if (child_storageId) {
                            adjChildren.push(storageId_grid_cache[child_storageId])
                        }
                        else {

                            infoStack.push({
                                uuId: childId,
                                level: childLevel,
                                localId: childLocalId,
                                globalId: childGlobalId,
                            })
                        }
                    })
                }

                adjChildren.forEach(child => updateGridNeighbour(grid.storageId, child, edgeCode))
            }
        }

        function updateGridNeighbour(storageId: number, neighbour: GridNode, edgeCode: EDGE_CODE) {

            const oppoCode = getToggleEdgeCode(edgeCode) as EDGE_CODE
            storageId_neighbourStorageId_cache[storageId][edgeCode].add(neighbour.storageId)
            storageId_neighbourStorageId_cache[neighbour.storageId][oppoCode].add(storageId)
        }

        function getToggleEdgeCode(code: number): EDGE_CODE | typeof EDGE_CODE_INVALID {
        
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

        function getGridNeighbours(storageId: number): [ GridNode[], GridNode[], GridNode[], GridNode[] ] {
            
            const grid = storageId_grid_cache[storageId]
            const neighbourStorageIds = storageId_neighbourStorageId_cache[grid.storageId]
            const neighbours:[ GridNode[], GridNode[], GridNode[], GridNode[] ] = [ 
                new Array<GridNode>(neighbourStorageIds[EDGE_CODE_NORTH].size),
                new Array<GridNode>(neighbourStorageIds[EDGE_CODE_WEST].size),
                new Array<GridNode>(neighbourStorageIds[EDGE_CODE_SOUTH].size),
                new Array<GridNode>(neighbourStorageIds[EDGE_CODE_EAST].size),
            ]

            let index: number
            neighbourStorageIds.forEach((neighbourStorageIdSet, edgeCode) => {
                index = 0
                neighbourStorageIdSet.forEach(neighbourStorageId => {
                    neighbours[edgeCode][index++] = storageId_grid_cache[neighbourStorageId]
                })
            })
            return neighbours
        }
    }

    private _getGridInfoFromUV(level: number, u: number, v: number): GridInfo | null {
        
        const { width, height } = this._levelInfos[level]

        // Check if valid
        if (u < 0 || u >= width || v < 0 || v >= height) return null

        const globalId = v * width + u
        const localId = this.getGridLocalId(level, globalId)

        return {
            level,
            localId,
            globalId,
            uuId: `${level}-${globalId}`
        }
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

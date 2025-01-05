import proj4 from 'proj4'

import { 
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

    edge_gridStorageIds_map: Map<string, Array<number>> = new Map()

    constructor() {}

    release(): null {

        this.edge_gridStorageIds_map.clear()

        return null
    }

    getEdgeKeyByInfo(grid_a: GridNode | null, grid_b: GridNode | null, axis: 'v' | 'h', range: [ min: [ number, number ], max: [ number, number ], shared: [ number, number ]]): string {

        // Encode key by range
        const key = axis + range.flat().join('-')

        // Add key to key map
        if (!this.edge_gridStorageIds_map.has(key)) {

            const girds = new Array<number>()
            grid_a && girds.push(grid_a.storageId)
            grid_b && girds.push(grid_b.storageId)

            girds.length && this.edge_gridStorageIds_map.set(key, girds)
        }

        return key
    }

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

    get edgeNum(): number {
        return this.edge_gridStorageIds_map.size
    }
    
    private _calcHorizontalEdges(grid: GridNode, neighbours: GridNode[], edgeCode: number, opEdgeCode: number, sharedCoord: [ number, number ]): void {

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < grid.level) {

            const edge = this.getEdgeKeyByInfo(grid, neighbours[0], 'h', [ grid.xMinPercent, grid.xMaxPercent, sharedCoord ])
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
                const edge = this.getEdgeKeyByInfo(grid, neighbour, 'h', [ neighbour.xMinPercent, neighbour.xMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)
            }

            // Situation 2 - Case 1
            // X -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = this.getEdgeKeyByInfo(grid, null, 'h', [ grid.xMinPercent, grid.xMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            }

            // Situation 2 - Case 2
            // X -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, 'h', [ fromNeighbour.xMaxPercent, toNeighbour.xMinPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            } 

            // Situation 2 - Case 3
            // X -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, 'h', [ fromNeighbour.xMaxPercent, grid.xMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            } 

            // Situation 2 - Case 4
            // X -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, 'h', [ grid.xMinPercent, toNeighbour.xMinPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            }
        }
    }
    
    private _calcVerticalEdges(grid: GridNode, neighbours: GridNode[], edgeCode: number, opEdgeCode: number, sharedCoord: [ number, number ]): void {

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < grid.level) {

            const edge = this.getEdgeKeyByInfo(grid, neighbours[0], 'v', [ grid.yMinPercent, grid.yMaxPercent, sharedCoord ])
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
                const edge = this.getEdgeKeyByInfo(grid, neighbour, 'v', [ neighbour.yMinPercent, neighbour.yMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)
            }

            // Situation 2 - Case 1
            // Y -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = this.getEdgeKeyByInfo(grid, null, 'v', [ grid.yMinPercent, grid.yMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            }

            // Situation 2 - Case 2
            // Y -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, 'v', [ fromNeighbour.yMaxPercent, toNeighbour.yMinPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            } 

            // Situation 2 - Case 3
            // Y -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, 'v', [ fromNeighbour.yMaxPercent, grid.yMaxPercent, sharedCoord ])
                grid.addEdge(edge, edgeCode)
            } 

            // Situation 2 - Case 4
            // Y -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeKeyByInfo(grid, null, 'v', [ grid.yMinPercent, toNeighbour.yMinPercent, sharedCoord ])
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
    globalId: number
}

export default class GridManager {

    private _levelInfos: GridLevelInfo[]
    private _subdivideRules: SubdivideRules
    private _projConverter: proj4.Converter

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

    parseTopology(gridInfoCache: Array<number>): GridTopologyInfo {

        let start = 0, end = 0
        start = Date.now()

        const gridNum = gridInfoCache.length / 2
        const edgeManager = new GridEdgeManager()
        const storageId_grid_cache = new Array<GridNode>(gridNum)
    
        // Set storageId_grid_cache
        for (let storageId = 0; storageId < gridNum; storageId++) {

            const level = gridInfoCache[storageId * 2]
            const globalId = gridInfoCache[storageId * 2 + 1]
            const { width, height } = this._levelInfos[level]

            storageId_grid_cache[storageId] = new GridNode({ 
                level, globalId, storageId,
                globalRange: [ width, height ],
            })
        }

        // Step 1: Find Neighbours /////////////////////////////////////////////////

        // Local map from uuId to storageId
        const uuId_storageId_map = new Map<string, number>()

        // Fill uuId_storageId_map
        for (const grid of storageId_grid_cache) {
            uuId_storageId_map.set(grid.uuId, grid.storageId)
        }
            
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

            const width = this._levelInfos[grid.level].width

            const globalU = grid.globalId % width
            const globalV = Math.floor(grid.globalId / width)

            // Check top edge with tGrid
            const tGridInfo = this._getGridInfoFromUV(grid.level, globalU, globalV + 1)
            tGridInfo && findNeighboursAlongEdge.call(this, grid, EDGE_CODE_NORTH, tGridInfo, (localId: number, subWidth: number, _: number) => localId < subWidth)

            // Check left edge with lGrid
            const lGridinfo = this._getGridInfoFromUV(grid.level, globalU - 1, globalV)
            lGridinfo && findNeighboursAlongEdge.call(this, grid, EDGE_CODE_WEST, lGridinfo, (localId: number, subWidth: number, _: number) => localId % subWidth === subWidth - 1)

            // Check bottom edge with rGrid
            const bGridInfo = this._getGridInfoFromUV(grid.level, globalU, globalV - 1)
            bGridInfo && findNeighboursAlongEdge.call(this, grid, EDGE_CODE_SOUTH, bGridInfo, (localId: number, subWidth: number, subHeight: number) => localId >= subWidth * (subHeight - 1))

            // Check right edge with rGrid
            const rGridInfo = this._getGridInfoFromUV(grid.level, globalU + 1, globalV)
            rGridInfo && findNeighboursAlongEdge.call(this, grid, EDGE_CODE_EAST, rGridInfo, (localId: number, subWidth: number, _: number) => localId % subWidth === 0)
            
        })

        // Release local map
        uuId_storageId_map.clear()

        // Step 2: Parse Edges /////////////////////////////////////////////////
        storageId_grid_cache.forEach(grid => edgeManager.calcGridEdges(grid, getGridNeighbours(grid)))

        // Step 3: Collect Results /////////////////////////////////////////////////
        let index = 0
        const edgeNum = edgeManager.edgeNum
        const edgeKeys = new Array<string>(edgeNum)
        const adjGrids = new Array<number[]>(edgeNum)
        const storageId_edgeKeys_set = new Array<[ Set<string>, Set<string>, Set<string>, Set<string> ]>(gridNum)

        // Generate result about edgeKey array and grid array (grids adjacent to edge)
        for (const [key, value] of edgeManager.edge_gridStorageIds_map) {
            edgeKeys[index] = key
            adjGrids[index++] = value
        }

        // Release edgeManager
        edgeManager.release()

        // Generate result about storageId_edgeKeys_set
        for (index = 0; index < storageId_grid_cache.length; index++) {
            
            const grid = storageId_grid_cache[index]
            storageId_edgeKeys_set[index] = grid.edges
            storageId_grid_cache[index] = grid.release() as any // release grid memory
        }

        end = Date.now()
        console.log('Topology Parsing Time Cost:', end - start)

        return [ 
            edgeKeys, adjGrids,
            storageId_edgeKeys_set
        ]

        // ---------------------------------------------------------------
        // Local helpers /////////////////////////////////////////////////

        function findNeighboursAlongEdge(this: GridManager, grid: GridNode, edgeCode: EDGE_CODE, gridInfo: GridInfo, adjacentCheckFunc: Function) {

            // Check if gridInfo has storageId (This grid is a leaf node)
            const rootNeighbourGrid = uuId_storageId_map.get(gridInfo.uuId)
            if (rootNeighbourGrid) {

                const rootNeighbour = storageId_grid_cache[rootNeighbourGrid]
                updateGridNeighbour(grid, rootNeighbour, edgeCode)

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
                        const childStorageId = uuId_storageId_map.get(childId)

                        // Check if child has storageId (This child is a leaf node)
                        if (childStorageId) {
                            adjChildren.push(storageId_grid_cache[childStorageId])
                        }
                        else {
                            infoStack.push({
                                uuId: childId,
                                level: childLevel,
                                globalId: childGlobalId,
                            })
                        }
                    })
                }

                adjChildren.forEach(child => updateGridNeighbour(grid, child, edgeCode))
            }
        }

        function updateGridNeighbour(grid: GridNode, neighbour: GridNode, edgeCode: EDGE_CODE) {

            const oppoCode = getToggleEdgeCode(edgeCode) as EDGE_CODE
            grid.neighbours[edgeCode].add(neighbour.storageId)
            neighbour.neighbours[oppoCode].add(grid.storageId)
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

        function getGridNeighbours(grid: GridNode): [ GridNode[], GridNode[], GridNode[], GridNode[] ] {

            const neighbourStorageIds = grid.neighbours
            const neighbours:[ GridNode[], GridNode[], GridNode[], GridNode[] ] = [ 
                new Array<GridNode>(neighbourStorageIds[EDGE_CODE_NORTH].size),
                new Array<GridNode>(neighbourStorageIds[EDGE_CODE_WEST].size),
                new Array<GridNode>(neighbourStorageIds[EDGE_CODE_SOUTH].size),
                new Array<GridNode>(neighbourStorageIds[EDGE_CODE_EAST].size),
            ]

            for (let edgeCode = 0; edgeCode < 4; edgeCode++) {

                let index = 0
                for (const storageId of neighbourStorageIds[edgeCode]) {
                    neighbours[edgeCode][index++] = storageId_grid_cache[storageId]
                }
            }

            return neighbours
        }
    }

    private _getGridInfoFromUV(level: number, u: number, v: number): GridInfo | null {
        
        const { width, height } = this._levelInfos[level]

        // Check if valid
        if (u < 0 || u >= width || v < 0 || v >= height) return null

        const globalId = v * width + u
        // const localId = this.getGridLocalId(level, globalId)

        return {
            level,
            // localId,
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

const customDict = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=~!@#$%^&*()_`-[]{}|;:,.<>?'

function encodeArrayBufferWithDict(buffer: ArrayBuffer): string {
    const u8 = new Uint8Array(buffer)
    let result = ''

    for (let i = 0; i < u8.byteLength; i++) {
        result += customDict[u8[i] % customDict.length]
    }

    return result
}

function decodeArrayBufferWithDict(encoded: string): ArrayBuffer {
    const buffer = new ArrayBuffer(encoded.length)
    const u8 = new Uint8Array(buffer)

    for (let i = 0; i < encoded.length; i++) {
        u8[i] = customDict.indexOf(encoded[i])
    }

    return buffer
}

// function encodeStringsToArrayBuffer(strings: string[]): ArrayBuffer {
    
//     let totalLength = 0
//     const encoder = new TextEncoder()

//     const encodedStrings = strings.map(str => {
//         const encoded = encoder.encode(str)
//         totalLength += 4 + encoded.length
//         return encoded
//     })

//     const buffer = new ArrayBuffer(totalLength)
//     const view = new DataView(buffer)

//     let offset = 0
//     for (const encoded of encodedStrings) {
//         view.setUint32(offset, encoded.length, true)
//         offset += 4
//         new Uint8Array(buffer, offset, encoded.length).set(encoded)
//         offset += encoded.length
//     }

//     return buffer
// }

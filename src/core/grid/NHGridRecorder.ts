import { DbAction } from './../database/db'
import Dispatcher from "../message/dispatcher"
import { EDGE_CODE, EDGE_CODE_EAST, EDGE_CODE_NORTH, EDGE_CODE_SOUTH, EDGE_CODE_WEST, GridEdge, GridNode, GridNodeRecord, GridNodeRenderInfo, GridNodeRenderInfoPack, SubdivideRules } from "./NHGrid"
import { Callback } from '../types'
import proj4 from 'proj4'
import { MercatorCoordinate } from '../math/mercatorCoordinate'

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

export interface GridLevelInfo {
    width: number
    height: number
    infos: (GridNodeRenderInfo | undefined)[]
}

const NODE_STORE = 'GridNode'

export class GridNodeRecorder {

    isReady = false
    nextStorageId = 0

    private _levelInfos: GridLevelInfo[]
    private _projConverter: proj4.Converter
    private _subdivideRules: SubdivideRules

    // [ level_0, globalId_0, level_1, globalId_1, ... , level_n, globalId_n ]
    storageId_gridInfo_cache = new Array()

    constructor(private _dispatcher: Dispatcher, subdivideRules: SubdivideRules) {
        this._subdivideRules = subdivideRules

        this._projConverter = proj4(subdivideRules.srcCS, subdivideRules.targetCS)

        const rootGrid = new GridNode({ localId: 0, globalId: 0 })
        const rootGridInfo: GridNodeRenderInfo = {
            uuId: rootGrid.uuId,
            vertices: rootGrid.getVertices(this._projConverter, this._subdivideRules.bBox)
        }
        
        this._levelInfos = [
            {
                width: 1,
                height: 1,
                infos: [ rootGridInfo ]
            }
        ]

        this._subdivideRules.rules.forEach((_, level, rules) => {
            if (level == 0) return

            const width = this._levelInfos[level - 1].width * rules[level - 1][0]
            const height = this._levelInfos[level - 1].height * rules[level - 1][1]

            this._levelInfos[level] = {
                width, height,
                infos: new Array<GridNodeRenderInfo>(width * height)
            }
        })
    }

    init(callback?: Function) {

        this._dispatcher.broadcast('init', this._subdivideRules, () => {
            this.isReady = true
            
            // Create root node in indexedDB
            this._dbActor.send('createGrids', [ '0-0' ], () => {
                callback && callback()
            })
        })
    }

    private get _actor() {
        return this._dispatcher.actor
    }

    private get _dbActor() {
        return this._dispatcher.dbActor
    }

    get levelInfos() {
        return this._levelInfos
    }

    getGridInfoByStorageId(storageId: number): [ level: number, globalId: number ] {

        return this.storageId_gridInfo_cache.slice(storageId * 2, (storageId + 1) * 2) as [ level: number, globalId: number ]
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
        
    private _createNodeRenderVertices(level: number, globalId: number) {
        
        const bBox = this._subdivideRules.bBox
        const { width, height } = this._levelInfos[level]

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

        return new Float32Array([
            ...renderCoords[0], ...renderCoords[1],
            ...renderCoords[2], ...renderCoords[3],
        ])
    }

    removeGrid(storageId: number, callback?: Function): void {

        this.nextStorageId -= 1
        if (this.nextStorageId === storageId) return

        // Get render info of grid having the last storageId
        const [ lastLevel, lastGlobalId ] = this.getGridInfoByStorageId(this.nextStorageId)

        // Replace removable render info with the last render info in the cache
        this.storageId_gridInfo_cache[storageId * 2 + 0] = lastLevel
        this.storageId_gridInfo_cache[storageId * 2 + 1] = lastGlobalId

        callback && callback([ storageId, lastLevel, this._createNodeRenderVertices(lastLevel, lastGlobalId) ])
    }
    
    subdivideGrid(level: number, globalId: number, callback?: Function): void {

        this._actor.send('subdivideGrid', [ level, globalId ], (_, renderInfos: GridNodeRenderInfoPack) => {

            this._handleGridNodeRenderInfo(level + 1, renderInfos, callback)
        })
    }

    private _handleGridNodeRenderInfo(level: number, renderInfos: GridNodeRenderInfoPack, callback?: Function) {

        const infoLength = renderInfos.uuIds.length
        const fromStorageId = this.nextStorageId
        const toStorageId = fromStorageId + infoLength - 1
        const levels = new Uint16Array(infoLength).fill(level)
        
        renderInfos.uuIds.forEach(uuId => {

            const storageId = this.nextStorageId++
            const [ level, globalId ] = uuId.split('-').map(key => +key)

            this.storageId_gridInfo_cache[storageId * 2 + 0]  = level
            this.storageId_gridInfo_cache[storageId * 2 + 1]  = globalId

        })

        callback && callback([ fromStorageId, toStorageId, levels, renderInfos.vertexBuffer ])

        this._dbActor.send('createGrids', renderInfos.uuIds)
    }

    getGridRenderInfo(uuId: string): GridNodeRenderInfo | undefined
    getGridRenderInfo(level: number, globalId: number): GridNodeRenderInfo | undefined
    getGridRenderInfo(uuIdOrLevel?: string | number, globalId?: number): GridNodeRenderInfo | undefined {

        if (typeof uuIdOrLevel === 'string') {

            const keys = uuIdOrLevel.split('-').map(key => Number(key))
            if (keys.length !== 2 || isNaN(keys[0]) || isNaN(keys[1])) {
                throw new Error(`Invalid uuId format: ${uuIdOrLevel}`)
            }
            const [ level, globalId ] = keys
            
            return this._levelInfos[level]?.infos[globalId]

        } else if (typeof uuIdOrLevel === 'number' && typeof globalId === 'number') {

            if (uuIdOrLevel < 0) {
                throw new Error(`Invalid level ${uuIdOrLevel}`)
            }

            return this._levelInfos[uuIdOrLevel]?.infos[globalId]

        } else {

            throw new Error('Invalid calling of getGrid')
        }
    }

    getGridParent(info: GridNodeRenderInfo): GridNodeRenderInfo | undefined {

        const [ level, globalId ] = info.uuId.split('-').map(key => Number(key))

        if (level === 0) return undefined
        
        const parentId = this.getParentGlobalId(level, globalId)
        return this.getGridRenderInfo(level - 1, parentId)
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

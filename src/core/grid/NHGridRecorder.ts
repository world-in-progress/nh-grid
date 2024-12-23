import { DbAction } from './../database/db'
import Dispatcher from "../message/dispatcher"
import { EDGE_CODE, EDGE_CODE_EAST, EDGE_CODE_NORTH, EDGE_CODE_SOUTH, EDGE_CODE_WEST, GridEdge, GridNode, GridNodeRecord, GridNodeRenderInfo, GridNodeRenderInfoPack, SubdivideRules } from "./NHGrid"
import { Callback } from '../types'
import proj4 from 'proj4'
import { MercatorCoordinate } from '../math/mercatorCoordinate'
import UndoRedoManager, { UndoRedoOperation } from '../util/undoRedoManager'

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
}

const NODE_STORE = 'GridNode'

export interface UndoRedoRecordOperation extends UndoRedoOperation {
    action: 'RemoveGrid' | 'SubdivideGrid'
}

export class GridNodeRecorder extends UndoRedoManager {

    private _projConverter: proj4.Converter

    isReady = false
    nextStorageId = 0
    levelInfos: GridLevelInfo[]
    storageId_gridInfo_cache = new Array() // [ level_0, globalId_0, level_1, globalId_1, ... , level_n, globalId_n ]

    constructor(private _dispatcher: Dispatcher, private _subdivideRules: SubdivideRules, capacity: number = 1000) {
        super(capacity)

        // Init projConverter
        this._projConverter = proj4(this._subdivideRules.srcCS, this._subdivideRules.targetCS)
        
        // Init levelInfos
        this.levelInfos = new Array<GridLevelInfo>(this._subdivideRules.rules.length)
        this._subdivideRules.rules.forEach((_, level, rules) => {

            let width: number, height: number
            if (level == 0) {
                width = 1
                height = 1
            } else {
                width = this.levelInfos[level - 1].width * rules[level - 1][0]
                height = this.levelInfos[level - 1].height * rules[level - 1][1]
            }
            this.levelInfos[level] = { width, height }
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

    removeGrid(storageId: number, callback?: Function): void {

        const removeOperation = this._generateRemoveGridOperation(storageId, callback)
        this.execute(removeOperation)
    }
    
    subdivideGrid(level: number, globalId: number, callback?: Function): void {

        // Dispatch a worker to subdivide the grid
        this._actor.send('subdivideGrid', [ level, globalId ], (_, renderInfos: GridNodeRenderInfoPack) => {

            const subdivideOperation = this._generateSubdivideGridOperation(level + 1, renderInfos, callback)            
            this.execute(subdivideOperation)

            this._dbActor.send('createGrids', renderInfos.uuIds)
        })
    }

    parseGridTopology(): void {

        // Dispatch a worker to parse the topology about all grids
        this._actor.send('parseTopology', this.storageId_gridInfo_cache, () => {})
    }

    getGridInfoByStorageId(storageId: number): [ level: number, globalId: number ] {

        return this.storageId_gridInfo_cache.slice(storageId * 2, (storageId + 1) * 2) as [ level: number, globalId: number ]
    }

    getGridLocalId(level: number, globalId: number) {
        if (level === 0) return 0
    
        const { width } = this.levelInfos[level]
        const [ subWidth, subHeight ] = this._subdivideRules.rules[level - 1]
    
        const u = globalId % width
        const v = Math.floor(globalId / width)
    
        return ((v % subHeight) * subWidth) + (u % subWidth)
    }

    getParentGlobalId(level: number, globalId: number): number {
        if (level === 0) return 0

        const { width } = this.levelInfos[level]
        const [ subWidth, subHeight ] = this._subdivideRules.rules[level - 1]

        const u = globalId % width
        const v = Math.floor(globalId / width)

        return Math.floor(v / subHeight) * this.levelInfos[level - 1].width + Math.floor(u / subWidth)
    }

    private get _actor() {
        return this._dispatcher.actor
    }

    private get _dbActor() {
        return this._dispatcher.dbActor
    }
        
    private _createNodeRenderVertices(level: number, globalId: number) {
        
        const bBox = this._subdivideRules.bBox
        const { width, height } = this.levelInfos[level]

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

    private _generateRemoveGridOperation(storageId: number, callback?: Function): UndoRedoRecordOperation {

        const lastStorageId = this.nextStorageId - 1

        // Get render info of this removable grid and the grid having the last storageId
        const [ lastLevel, lastGlobalId ] = this.getGridInfoByStorageId(lastStorageId)
        const [ removableLevel, removableGlobalId ] = this.getGridInfoByStorageId(storageId)

        const removeOperation: UndoRedoRecordOperation = {
            action: 'RemoveGrid',
            apply: () => {
                this.nextStorageId -= 1

                // Do nothing if the removable grid is the grid having the last storageId
                if (this.nextStorageId === storageId) return
        
                // Replace removable render info with the last render info in the cache
                this.storageId_gridInfo_cache[storageId * 2 + 0] = lastLevel
                this.storageId_gridInfo_cache[storageId * 2 + 1] = lastGlobalId
        
                callback && callback([ storageId, lastLevel, this._createNodeRenderVertices(lastLevel, lastGlobalId) ])
            },

            inverse: () => {
                this.nextStorageId += 1
                
                // Revert info about the removable grid
                this.storageId_gridInfo_cache[storageId * 2 + 0] = removableLevel
                this.storageId_gridInfo_cache[storageId * 2 + 1] = removableGlobalId
                
                // Revert info about the grid having the last storageId
                this.storageId_gridInfo_cache[lastStorageId * 2 + 0] = lastLevel
                this.storageId_gridInfo_cache[lastStorageId * 2 + 1] = lastGlobalId
        
                // Revert callback
                if (callback) {
                    callback([ lastStorageId, lastLevel, this._createNodeRenderVertices(lastLevel, lastGlobalId) ])
                    callback([ storageId, removableLevel, this._createNodeRenderVertices(removableLevel, removableGlobalId) ])
                }
            }
        }

        return removeOperation
    }

    private _generateSubdivideGridOperation(level: number, renderInfos: GridNodeRenderInfoPack, callback?: Function): UndoRedoRecordOperation {

        const fromStorageId = this.nextStorageId
        const infoLength = renderInfos.uuIds.length
        const toStorageId = fromStorageId + infoLength - 1

        const subdivideOperation: UndoRedoRecordOperation = {
            action: 'SubdivideGrid',
            apply: () => {

                renderInfos.uuIds.forEach(uuId => {
        
                    const storageId = this.nextStorageId++
                    const [ level, globalId ] = uuId.split('-').map(key => +key)
        
                    this.storageId_gridInfo_cache[storageId * 2 + 0]  = level
                    this.storageId_gridInfo_cache[storageId * 2 + 1]  = globalId
        
                })
                const levels = new Uint16Array(infoLength).fill(level)
                callback && callback([ fromStorageId, toStorageId, levels, renderInfos.vertexBuffer ])
            },
            inverse: () => {

                // Remove info in cache
                for (let i = fromStorageId; i <= toStorageId; i++) {
        
                    this.nextStorageId --
                    this.storageId_gridInfo_cache[i * 2 + 0]  = undefined
                    this.storageId_gridInfo_cache[i * 2 + 1]  = undefined
                }
                callback && callback(null)
            }
        }

        return subdivideOperation
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

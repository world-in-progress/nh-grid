import proj4 from 'proj4'

import Dispatcher from '../message/dispatcher'
import { createDB, deleteDB } from '../database/db'
import { MercatorCoordinate } from '../math/mercatorCoordinate'
import UndoRedoManager, { UndoRedoOperation } from '../util/undoRedoManager'
import { EDGE_CODE, EDGE_CODE_EAST, EDGE_CODE_NORTH, EDGE_CODE_SOUTH, EDGE_CODE_WEST, GridEdge, GridNode, GridNodeRecord, GridNodeRenderInfo, GridNodeRenderInfoPack, GridTopologyInfo, SubdivideRules } from './NHGrid'

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

interface GridLevelInfo {

    width: number
    height: number
}

export interface GridLayerSerializedInfo {
    extent: [ number, number, number, number ]
    grids: { 
        id: number
        xMinPercent: [ number, number ]
        yMinPercent: [ number, number ]
        xMaxPercent: [ number, number ]
        yMaxPercent: [ number, number ] 
    }[]
    edges: {
        id: number
        edgeCode: number
        minPercent: [ number, number ]
        maxPercent: [ number, number ]
        adjGrids: [ number | null, number | null ]
    }[]
}

export interface UndoRedoRecordOperation extends UndoRedoOperation {
    action: 'RemoveGrid' | 'SubdivideGrid'
}

export interface GridNodeRecordOptions {

    workerCount?: number
    dispatcher?: Dispatcher
    operationCapacity?: number
    autoDeleteIndexedDB?: boolean
}

export default class GridNodeRecorder extends UndoRedoManager {

    private _projConverter: proj4.Converter

    isReady = false
    nextStorageId = 0
    dispatcher: Dispatcher
    levelInfos: GridLevelInfo[]
    storageId_gridInfo_cache: Array<number | undefined> // [ level_0, globalId_0, level_1, globalId_1, ... , level_n, globalId_n ]

    constructor(private _subdivideRules: SubdivideRules, maxGridNum?: number, options: GridNodeRecordOptions = {}) {
        super(options.operationCapacity || 1000)

        this.dispatcher =  options.dispatcher || new Dispatcher(this,options.workerCount || 4)

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

        // Init grid cache
        this.storageId_gridInfo_cache = maxGridNum ? new Array<number>(maxGridNum * 2) : []

        // Create IndexedDB
        createDB('GridDB', 'GridNode', 'uuId')
        if (options.autoDeleteIndexedDB === undefined ? true : options.autoDeleteIndexedDB) {
            window.onbeforeunload = () => deleteDB('GridDB')
        }

        // Add event listener for <Shift + S> (Download serialization json)
        document.addEventListener('keydown', e => {

            if (e.shiftKey && e.key === 'S') {
                let data = this.parseGridTopology()
                // let jsonData = JSON.stringify(data)
                // let blob = new Blob([ jsonData ], { type: 'application/json' })
                // let link = document.createElement('a')
                // link.href = URL.createObjectURL(blob)
                // link.download = 'gridInfo.json'
                // link.click()
            }
        })
    }

    init(callback?: Function) {

        this.dispatcher.broadcast('init', this._subdivideRules, () => {
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
        this._actor.send('parseTopology', this.storageId_gridInfo_cache.slice(0, this.nextStorageId * 2), (_, topologyInfo: GridTopologyInfo) => {
            const [ edgekeys, adjGrids,  storageId_edgeKeys_set ] = topologyInfo
            console.log(edgekeys, adjGrids, storageId_edgeKeys_set)
        })
    }

    serialize() {

    }
    // serialize() {

    //     const serializedData: GridLayerSerializedInfo = {
    //         grids: [], edges: [],
    //         extent: this.bBox.boundary
    //     }

    //     const grids = serializedData.grids
    //     const edges = serializedData.edges
    //     const levelGlobalId_serializedId_Map: Map<string, number> = new Map<string, number>()

    //     // Serialized edge recoder used to record valid edges
    //     const sEdgeRecoder = new GridEdgeRecorder()

    //     // Serialize grids //////////////////////////////////////////////////

    //     // Iterate hit grids in Editor Type
    //     if (this._currentType === this.EDITOR_TYPE) {
    //         this.hitGridList.forEach((grid, index) => {

    //             const { xMinPercent, yMinPercent, xMaxPercent, yMaxPercent } = grid.serialization
    //             grids.push({
    //                 id: index,
    //                 xMinPercent, yMinPercent,
    //                 xMaxPercent, yMaxPercent
    //             })
    //             const key = [ grid.level, grid.globalId ].join('-')
    //             levelGlobalId_serializedId_Map.set(key, index)

    //             // Avoid edge miss and record valid key
    //             this.edgeRecorder.calcGridEdges(grid, this.gridRecorder)
    //             grid.edgeKeys.forEach(key => {
    //                 const edge = this.edgeRecorder.getEdgeByKey(key)
    //                 sEdgeRecoder.addEdge(edge)
    //             })
    //         })
    //     }
    //     // Iterate hit grids in Subdivider Type
    //     else {

    //         // Find neighbours for all grids
    //         this.gridRecorder.findNeighbours()
            
    //         let index = 0
    //         this.gridRecorder.uuId_gridNode_map.forEach(grid => {
    //             if (grid.hit) {

    //                 const { xMinPercent, yMinPercent, xMaxPercent, yMaxPercent } = grid.serialization
    //                 grids.push({
    //                     id: index,
    //                     xMinPercent, yMinPercent,
    //                     xMaxPercent, yMaxPercent
    //                 })

    //                 const key = [ grid.level, grid.globalId ].join('-')
    //                 levelGlobalId_serializedId_Map.set(key, index)
    //                 index++

    //                 // Avoid edge miss and record valid key
    //                 this.edgeRecorder.calcGridEdges(grid, this.gridRecorder)
    //                 grid.edgeKeys.forEach(key => {
    //                     const edge = this.edgeRecorder.getEdgeByKey(key)
    //                     sEdgeRecoder.addEdge(edge)
    //                 })
    //             }
    //         })
    //     }

    //     // Serialize edges //////////////////////////////////////////////////

    //     let index = 0
    //     sEdgeRecoder.edges.forEach(edge => {

    //         const { adjGrids, minPercent, maxPercent, edgeCode } = edge.serialization
    //         const grid1 = adjGrids[0] !== 'null-null' ? levelGlobalId_serializedId_Map.get(adjGrids[0])! : null
    //         const grid2 = adjGrids[1] !== 'null-null' ? levelGlobalId_serializedId_Map.get(adjGrids[1])! : null

    //         edges.push({
    //             id: index++,
    //             adjGrids: [ grid1, grid2 ],
    //             minPercent,
    //             maxPercent,
    //             edgeCode
    //         })
    //     })

    //     return serializedData
    // }

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
        return this.dispatcher.actor
    }

    private get _dbActor() {
        return this.dispatcher.dbActor
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

// function decodeArrayBufferToStrings(buffer: ArrayBuffer): string[] {

//     const strings: string[] = []
//     const view = new DataView(buffer)
//     const decoder = new TextDecoder()

//     let offset = 0
//     while (offset < buffer.byteLength) {
//         const length = view.getUint32(offset, true)
//         offset += 4
//         const encoded = new Uint8Array(buffer, offset, length)
//         strings.push(decoder.decode(encoded))
//         offset += length
//     }

//     return strings
// }

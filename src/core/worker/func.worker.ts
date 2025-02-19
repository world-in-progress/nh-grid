import GridManager from '../grid/NHGridManager'
import { SubdivideRules } from '../grid/NHGrid'
import { Callback, WorkerSelf } from '../types'

export function checkIfReady(this: WorkerSelf, _: unknown, callback: Callback<any>) {

    callback()
}

export function init(this: WorkerSelf & Record<'nodeManager', GridManager>, subdivideRules: SubdivideRules, callback: Callback<any>) {

    this.nodeManager = new GridManager(subdivideRules)
    callback()
}

export function updateSubdividerules(this: WorkerSelf & Record<'nodeManager', GridManager>, subdivideRules: SubdivideRules, callback: Callback<any>) {

    this.nodeManager.subdivideRules = subdivideRules
    callback()
}

export async function subdivideGrid(this: WorkerSelf & Record<'nodeManager', GridManager>, [ level, globalId ]: [ level: number, globalId: number ], callback: Callback<any>) {

    callback(null, this.nodeManager.subdivideGrid(level, globalId))
}

export async function subdivideGrids(this: WorkerSelf & Record<'nodeManager', GridManager>, subdivideInfos: Array<[ level: number, globalId: number ]>, callback: Callback<any>) {

    callback(null, this.nodeManager.subdivideGrids(subdivideInfos))
}

export async function parseTopology(this: WorkerSelf &  Record<'nodeManager', GridManager>, storageId_gridInfo_cache: Array<number>, callback: Callback<any>) {

    callback(null, this.nodeManager.parseTopology(storageId_gridInfo_cache))
}

export async function calcEdgeRenderInfos(this: WorkerSelf &  Record<'nodeManager', GridManager>, edgeInfos: { index: number, keys: string[] }, callback: Callback<any>) {

    const { index: actorIndex, keys: edgeKeys } = edgeInfos
    callback(null, { actorIndex,  vertexBuffer: this.nodeManager.getEdgeRenderInfos(edgeKeys)})
}

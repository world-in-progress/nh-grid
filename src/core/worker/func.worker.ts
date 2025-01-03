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

export async function subdivideGrid(this: WorkerSelf & Record<'nodeManager', GridManager>, [ level, globalId ]: [ level: number, globalId: number ], callback: Callback<any>) {

    callback(null, this.nodeManager.subdivideGrid(level, globalId))
}

export async function parseTopology(this: WorkerSelf &  Record<'nodeManager', GridManager>, storageId_gridInfo_cache: Array<number>, callback: Callback<any>) {

    callback(null, this.nodeManager.parseTopology(storageId_gridInfo_cache))
}

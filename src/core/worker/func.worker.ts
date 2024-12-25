import { Callback, WorkerSelf } from '../types'
import { SubdivideRules } from '../grid/NHGrid'
import { GridNodeManager } from '../grid/NHGridManager'

export function checkIfReady(this: WorkerSelf, _: unknown, callback: Callback<any>) {

    callback()
}

export function init(this: WorkerSelf & Record<'nodeManager', GridNodeManager>, subdivideRules: SubdivideRules, callback: Callback<any>) {

    this.nodeManager = new GridNodeManager(subdivideRules)
    callback()
}

export async function subdivideGrid(this: WorkerSelf & Record<'nodeManager', GridNodeManager>, [ level, globalId ]: [ level: number, globalId: number ], callback: Callback<any>) {

    callback(null, this.nodeManager.subdivideGrid(level, globalId))
}

export async function parseTopology(this: WorkerSelf &  Record<'nodeManager', GridNodeManager>, storageId_gridInfo_cache: Array<number>, callback: Callback<any>) {

    
}

import { GridNodeManager } from '../grid/NHGridManager'
import { SubdivideRules } from '../grid/NHGrid'
import { Callback, WorkerSelf } from '../types'

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

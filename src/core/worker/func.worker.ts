import { GridNode } from '../grid/NHGrid'
import { Callback, WorkerSelf } from '../types'

export function checkIfReady(_: unknown, callback: Callback<any>) {

    callback()
}

export function hello(_: unknown, __: Callback<any>) {
    
    console.log('Hello!')
}

let count = 0
export function createGrids(this: WorkerSelf, grids: GridNode[]) {

    count += grids.length
    console.log(count)
    this.count += 1
}

import { GridNode } from '../grid/NHGrid'
import { Callback, WorkerSelf } from '../types'
import { createDbManager, DbAction } from '../database/db'

export function hello(_: unknown, __: Callback<any>) {
    
    console.log('Hello!')
}

const dbManager = createDbManager()
export function gridProcess(actions: DbAction[], callback: Callback<GridNode[]>) {

    dbManager('GridDB', actions)
    callback(null, actions.map(action => action.data))
}

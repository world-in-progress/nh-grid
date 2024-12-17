export function createDB(dbName: string, storedObjectName: string, keyName: string) {

    const request = indexedDB.open(dbName, 1)

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {

        const db = (event.target as IDBRequest).result
        if (!db.objectStoreNames.contains(storedObjectName)) {
            db.createObjectStore(storedObjectName, { keyPath: keyName })
        }
    }

    request.onsuccess = () => {
        console.log(`IndexedDB ${dbName} has been created.`)
    }

    request.onerror = () => {
        console.error(`Failed to create indexedDB ${dbName}`)
    }
}

export function deleteDB(dbName: string): void {

    const request = indexedDB.deleteDatabase(dbName)

    request.onsuccess = () => {
        console.log(`IndexedDB ${dbName} deleted.`)
    }

    request.onerror = () => {
        console.error(`Failed to delete indexedDB ${dbName}`)
    }
}

export function addData(store: IDBObjectStore, data: any) {

    const request = store.add(data)

    request.onsuccess = () => {}
    request.onerror = (e) => {
        console.log(data.uuId)
        console.error((e.target as any).error)
    }
}

export function deleteData(store: IDBObjectStore, id: number | string) {

    const request = store.delete(id)

    request.onsuccess = () => {}
    request.onerror = (e) => console.error((e.target as any).error)
}

export function updateData(store: IDBObjectStore, data: any) {

    const request = store.put(data)

    request.onsuccess = () => {}
    request.onerror = (e) => console.error((e.target as any).error)
}

export function getData(store: IDBObjectStore, id: number | string) {

    const request = store.get(id)

    request.onsuccess = () => {}
    request.onerror = (e) => console.error((e.target as any).error)
}

export type DbAction = {
    data?: any
    id?: string | number
    tableName: string
    type: 'C' | 'R' | 'U' | 'D'
}

export interface DbStoreDict {
    [tableName: string]: IDBObjectStore
}

export function createDbManager() {

    let db: IDBDatabase | undefined

    function handleActions(actions: DbAction[]) {

        const storeDict: DbStoreDict = {}

        actions.forEach(action => {

            if (!storeDict[action.tableName]) {
                const transaction = db!.transaction([action.tableName], 'readwrite')
                storeDict[action.tableName] = transaction.objectStore(action.tableName)
            }

            const store = storeDict[action.tableName]

            switch (action.type) {

                case 'C':
                    addData(store, action.data)
                    break
                case 'R':
                    getData(store, action.id!)
                    break
                case 'U':
                    updateData(store, action.data)
                    break
                case 'D':
                    deleteData(store, action.id!)
                    break
                default:
                    console.error(`Unknown action type: ${action.type}`)
            }
        })
    }

    function openDB(dbName: string): Promise<IDBDatabase> {

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1)

            request.onsuccess = (event: Event) => {
                db = (event.target as IDBRequest).result
                resolve(db!)
            }

            request.onerror = () => {
                reject(new Error(`Failed to open indexedDB: ${dbName}`))
            }
        })
    }

    return async (dbName: string, actions: DbAction[]) => {

        if (!db) {
            try {
                db = await openDB(dbName)
            } catch (error) {
                throw error
            }
        }

        handleActions(actions)
    }
}

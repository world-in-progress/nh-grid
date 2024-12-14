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
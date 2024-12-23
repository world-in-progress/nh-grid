import RingBuffer from './ringBuffer'

export interface UndoRedoOperation {
    apply: () => void
    inverse: () => void
    action: string // Action name
}

class UndoRedoManager {

    private _undoBuffer: RingBuffer<UndoRedoOperation>
    private _redoBuffer: RingBuffer<UndoRedoOperation>

    constructor(size: number) {
        
        this._undoBuffer = new RingBuffer<UndoRedoOperation>(size)
        this._redoBuffer = new RingBuffer<UndoRedoOperation>(size)
        this._registerKeyboardShortcuts()
    }

    execute(operation: UndoRedoOperation): void {

        operation.apply()
        this._undoBuffer.push(operation)
        this._redoBuffer.clear()
    }

    undo(): void {

        const operation = this._undoBuffer.pop()
        if (operation) {

            this._redoBuffer.push(operation)
            operation.inverse()
        }
    }

    redo(): void {

        const operation = this._redoBuffer.pop()
        if (operation) {

            this._undoBuffer.push(operation)
            operation.apply()
        }
    }

    getHistory(): { undo: UndoRedoOperation[], redo: UndoRedoOperation[] } {

        return {
            undo: this._undoBuffer.toArray(),
            redo: this._redoBuffer.toArray(),
        }
    }

    private _registerKeyboardShortcuts(): void {

        document.addEventListener('keydown', (event: KeyboardEvent) => {

            const ctrlOrCmd = isMacOS() ? event.metaKey : event.ctrlKey

            if (ctrlOrCmd && event.key === 'z' && !event.shiftKey) {
                event.preventDefault()
                this.undo()
            }

            if (ctrlOrCmd && event.key === 'z' && event.shiftKey) {
                event.preventDefault()
                this.redo()
            }
        })
    }
}

// Helpers //////////////////////////////////////////////////

function isMacOS(): boolean {
    return navigator.userAgent.includes('Mac')
}

export default UndoRedoManager
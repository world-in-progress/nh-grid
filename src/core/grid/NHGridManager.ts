import { DbAction } from './../database/db'
import Dispatcher from "../message/dispatcher"
import { EDGE_CODE, EDGE_CODE_EAST, EDGE_CODE_NORTH, EDGE_CODE_SOUTH, EDGE_CODE_WEST, GridEdge, GridNode } from "./NHGrid"
import { Callback } from '../types'

export class GridEdgeManager {

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

export type SubdivideRules = [ number, number ][]

export interface GridLevelInfo {
    width: number
    height: number
    grids: (GridNode | undefined)[]
}

export class GridNodeManager {

    private _levelInfos: GridLevelInfo[]
    private _subdivideRules: SubdivideRules
    private _dispatcher = new Dispatcher(this)
    private _dbActions = new Array<DbAction>()

    storageId_uuId_map = new Map<number, string>()
    uuId_storageId_map = new Map<string, number>()
    uuId_gridNode_map = new Map<string, GridNode>()

    constructor(subdivideRules: SubdivideRules) {

        const rootGrid = new GridNode({ localId: 0, globalId: 0 })
        this.uuId_gridNode_map.set(rootGrid.uuId, rootGrid)
        this._levelInfos = [
            {
                width: 1,
                height: 1,
                grids: [ rootGrid ]
            }
        ]

        this._subdivideRules = subdivideRules
        this._subdivideRules.forEach((_, level, rules) => {
            if (level == 0) return

            const width = this._levelInfos[level - 1].width * rules[level - 1][0]
            const height = this._levelInfos[level - 1].height * rules[level - 1][1]

            this._levelInfos[level] = {
                width, height,
                grids: new Array<GridNode>(width * height)
            }
        })

        this._dbActions.push({ type: 'C', tableName: 'GridNode', data: rootGrid.record })
    }

    private get _actor() {
        return this._dispatcher.getActor()
    }

    private _getNode(u: number, v: number, level: number): GridNode | undefined {

        const width = this._levelInfos[level].width
        const height = this._levelInfos[level].height

        if (u < 0 || u >= width || v < 0 || v > height) return undefined

        const globalId = v * width + u
        return this._levelInfos[level].grids[globalId]
    }

    get levelInfos() {

        return this._levelInfos
    }

    findNeighbours(): void {
            
        /* ------------------------------------------------------------------
                                            |
            Neighbours around a grid        |       Edges around a node   
                                            |
                      tGrid                 |         ----- 0b00 -----
                        |                   |        |                |
             lGrid -- GRID -- rGrid         |        0b01   NODE   0b11
                        |                   |        |                |
                      bGrid                 |         ----- 0b10 ----- 
                                            |
        ------------------------------------------------------------------ */

        /** 
         * Get all valid grids.  
         * 
         * Features about so-called VALID:
         * 1. Is always hit
         * 2. Level is never 0
         * 3. Is always a leaf grid
        */
        const validGrids: GridNode[] = []
        this.storageId_uuId_map.forEach(uuId => {
            const [ level, globalId ] = uuId.split('-').map(key => Number(key))
            const grid = this.getGrid(level, globalId)!
            if (grid.hit) validGrids.push(grid)
        })

        // Iterate all valid grids and find their neighbours
        validGrids.forEach(grid => {

            const level = grid.level
            const width = this._levelInfos[level].width

            const globalU = grid.globalId % width
            const globalV = Math.floor(grid.globalId / width)

            const tGrid = this._getNode(globalU, globalV + 1, level)
            const lGrid = this._getNode(globalU - 1, globalV, level)
            const bGrid = this._getNode(globalU, globalV - 1, level)
            const rGrid = this._getNode(globalU + 1, globalV, level)

            // Check top edge with tGrid
            if (tGrid) {

                // Get all children of tGrid, adjacent to grid

                const adjChildren: GridNode[] = []
                const stack: GridNode[] = [ tGrid ]
                
                while(stack.length) {
                    const _grid = stack.pop()!

                    if (_grid.children.length) {
                        const children = this.getGridChildren(_grid)
                        const subWidth = this._subdivideRules[_grid.level][0]
                        stack.push(...children.filter(child => child.localId < subWidth))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_NORTH].add(child.uuId)
                    child.neighbours[EDGE_CODE_SOUTH].add(grid.uuId)
                })
            }

            // Check left edge with lGrid
            if (lGrid) {

                // Get all children of lGrid, adjacent to grid

                const adjChildren: GridNode[] = []
                const stack: GridNode[] = [ lGrid ]

                while(stack.length) {
                    const _grid = stack.pop()!

                    if (_grid.children.length) {
                        const children = this.getGridChildren(_grid)
                        const subWidth = this._subdivideRules[_grid.level][0]
                        stack.push(...children.filter(child => child.localId % subWidth === subWidth - 1))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_WEST].add(child.uuId)
                    child.neighbours[EDGE_CODE_EAST].add(grid.uuId)
                })
            }

            // Check bottom edge with rGrid
            if (bGrid) {

                // Get all children of bGrid, adjacent to grid

                const adjChildren: GridNode[] = []
                const stack: GridNode[] = [ bGrid ]

                while(stack.length) {
                    const _grid = stack.pop()!

                    if (_grid.children.length) {
                        const children = this.getGridChildren(_grid)
                        const [ subWidth, subHeight ] = this._subdivideRules[_grid.level]
                        stack.push(...children.filter(child => child.localId >= subWidth * (subHeight - 1)))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_SOUTH].add(child.uuId)
                    child.neighbours[EDGE_CODE_NORTH].add(grid.uuId)
                })
            }

            // Check right edge with rGrid
            if (rGrid) {

                // Get all children of rGrid, adjacent to grid
                
                const adjChildren: GridNode[] = []
                const stack: GridNode[] = [ rGrid ]

                while(stack.length) {
                    const _grid = stack.pop()!

                    if (_grid.children.length) {
                        const children = this.getGridChildren(_grid)
                        const subWidth = this._subdivideRules[_grid.level][0]
                        stack.push(...children.filter(child => child.localId % subWidth === 0))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(child => child.hit).forEach(child => {
                    grid.neighbours[EDGE_CODE_EAST].add(child.uuId)
                    child.neighbours[EDGE_CODE_WEST].add(grid.uuId)
                })
            }

            grid.resetEdges()
        })
    }

    getGridLocalId(level: number, globalId: number) {
        if (level === 0) return 0
    
        const { width } = this._levelInfos[level]
        const [ subWidth, subHeight ] = this._subdivideRules[level - 1]
    
        const u = globalId % width
        const v = Math.floor(globalId / width)
    
        return ((v % subHeight) * subWidth) + (u % subWidth)
    }

    getParentGlobalId(level: number, globalId: number): number {
        if (level === 0) return 0

        const { width } = this._levelInfos[level]
        const [ subWidth, subHeight ] = this._subdivideRules[level - 1]

        const u = globalId % width
        const v = Math.floor(globalId / width)

        return Math.floor(v / subHeight) * this._levelInfos[level - 1].width + Math.floor(u / subWidth)
    }
    
    subdivideGrid(level: number, globalId: number, callback?: Function): void {

        // Subdivide parent if this grid does not exist
        if (!this._levelInfos[level].grids[globalId]) this.subdivideGrid(level - 1, this.getParentGlobalId(level, globalId), callback)

        const grid = this._levelInfos[level].grids[globalId]!
        const [ subWidth, subHeight ] = this._subdivideRules[grid.level]

        // Return if grid's children are all existed
        if (grid.children.length > 0 && grid.children.every(child => child !== null)) return

        // Subdivide
        const globalU = globalId % this._levelInfos[level].width
        const globalV = Math.floor(globalId / this._levelInfos[level].width)
        const subGlobalWidth = this._levelInfos[level + 1].width
        const subGlobalHeight = this._levelInfos[level + 1].height

        for (let localId = 0; localId < subWidth * subHeight; localId++) {

            if (grid.children[localId]) continue

            const subU = localId % subWidth
            const subV = Math.floor(localId / subWidth)

            const subGlobalU = globalU * subWidth + subU
            const subGlobalV = globalV * subHeight + subV
            const subGlobalId = subGlobalV * (this._levelInfos[level].width * subWidth) + subGlobalU

            const subGrid = new GridNode({
                localId,
                parent: grid,
                globalId: subGlobalId,
                // uuId: this.registeredGridCount++,
                globalRange: [ subGlobalWidth, subGlobalHeight ]
            })

            grid.children[localId] = subGrid.uuId
            this.uuId_gridNode_map.set(subGrid.uuId, subGrid)
            this.storageId_uuId_map.set(this.storageId_uuId_map.size, subGrid.uuId)
            this.uuId_storageId_map.set(subGrid.uuId, this.storageId_uuId_map.size - 1)
            this._levelInfos[level + 1].grids[subGlobalId] = subGrid
            this._dbActions.push({ type: 'C', tableName: 'GridNode', data: subGrid.record })

            callback && callback(subGrid)
        }

        this._dbActions.push({ type: 'U', tableName: 'GridNode', data: grid.record })
    }

    // Submit grid CRUD actions to IndexedDB
    submit(callback?: Callback<GridNode[]>) {

        this._actor.send('gridProcess', this._dbActions, callback)
        this._dbActions = new Array<DbAction>()
    }

    removeGrid(grid: GridNode, callback?: Function) {

        if (!grid) return

        // Find last valid grid
        const [ level, globalId ] = this.storageId_uuId_map.get(this.storageId_uuId_map.size)!.split('-').map(key => Number(key))
        const lastValidGrid = this.getGrid(level, globalId)!
        this.storageId_uuId_map.delete(this.storageId_uuId_map.size)

        // Overwrite the texture data of this deleted grid to the valid one
        if (!lastValidGrid.equal(grid)) {

            const storageId = this.uuId_storageId_map.get(grid.uuId)!
            this.uuId_storageId_map.delete(grid.uuId)

            this.storageId_uuId_map.set(storageId, lastValidGrid.uuId)
            this.uuId_storageId_map.set(lastValidGrid.uuId, storageId)
            callback && callback(lastValidGrid)
        }

        // Remove record from parent
        const parent = this.getGridParent(grid)
        if (parent) parent.children[grid.localId] = null

        // Remove grid
        this._levelInfos[grid.level].grids[grid.globalId] = undefined
        grid.release()
    }

    getGrid(level: number, globalId: number): GridNode | undefined {

        if (level < 0) {
            throw new Error(`Invalid level ${level}`)
        }

        return this._levelInfos[level].grids[globalId]
    }

    getGridParent(grid: GridNode): GridNode | undefined {

        if (grid.level === 0) return undefined
        
        const parentId = this.getParentGlobalId(grid.level, grid.globalId)
        return this.getGrid(grid.level - 1, parentId)
    }

    getGridNeighbours(grid: GridNode, edgeCode: EDGE_CODE): GridNode[] {

        const neighbour_storageIds = [ ...grid.neighbours[edgeCode] ]
        return neighbour_storageIds.map(id => this.uuId_gridNode_map.get(id)).filter(node => node !== undefined)
    }

    getGridChildren(grid: GridNode): GridNode[] {

        return grid.children.filter(childId => childId !== null)
        .map(childId => this.uuId_gridNode_map.get(childId)).filter(node => node !== undefined)
    }
}

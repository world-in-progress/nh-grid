import { DbAction } from './../database/db'
import Dispatcher from "../message/dispatcher"
import { EDGE_CODE, EDGE_CODE_EAST, EDGE_CODE_NORTH, EDGE_CODE_SOUTH, EDGE_CODE_WEST, GridEdge, GridNode } from "./NHGrid"
import { Callback } from '../types'

export class GridEdgeRecorder {

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

    calcGridEdges(grid: GridNode, nodeRecorder: GridNodeRecorder): void {

        if (grid.edgeCalculated) return

        // Calculate north edges
        this._calcHorizontalEdges(grid, nodeRecorder.getGridNeighbours(grid, EDGE_CODE_NORTH), EDGE_CODE_NORTH, EDGE_CODE_SOUTH)
        // Calculate sourth edges
        this._calcHorizontalEdges(grid, nodeRecorder.getGridNeighbours(grid, EDGE_CODE_SOUTH), EDGE_CODE_SOUTH, EDGE_CODE_NORTH)
        // Calculate west edges
        this._calcVerticalEdges(grid, nodeRecorder.getGridNeighbours(grid, EDGE_CODE_SOUTH), EDGE_CODE_WEST, EDGE_CODE_EAST)
        // Calculate east edges
        this._calcVerticalEdges(grid, nodeRecorder.getGridNeighbours(grid, EDGE_CODE_SOUTH), EDGE_CODE_EAST, EDGE_CODE_WEST)
        
        grid.edgeCalculated = true
    }
    
    private _calcHorizontalEdges(grid: GridNode, neighbours: GridNode[], edgeCode: number, opEdgeCode: number): void {

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < grid.level) {

            const edge = this.getEdgeByInfo(grid, neighbours[0], edgeCode, [ ...grid.xMinPercent, ...grid.xMaxPercent ])
            grid.addEdge(edge, edgeCode)
            neighbours[0].addEdge(edge, opEdgeCode)
            return
        }

        // Case when neighbours have equal or higher levels ////////////////////////////////////////
        
        neighbours = neighbours.filter(neighbour => neighbour.level >= grid.level)
        const xSet = new Set([ grid.xMin, grid.xMax ])
        neighbours.forEach(neighbour => {
            xSet.add(neighbour.xMin)
            xSet.add(neighbour.xMax)
        })
        const xPercentList = [...xSet].sort((x1, x2) => x1 - x2)

        // Iterate sub-edges and find their neighbours
        // If a sub-edge:
        // - [Situation 1] belongs to a neighbour ( add it to <this> and <neighbour> )
        // - [Situation 2] does not belong to any neighbour ( only add it to <this> )
        for (let i = 0; i < xPercentList.length - 1; i++) {

            const from = xPercentList[i]
            const to = xPercentList[i + 1]

            let fromIndex = -1
            let toIndex = -1
            for (let j = 0; j < neighbours.length; j++) {

                const neighbour = neighbours[j]
                const xMin = neighbour.xMin
                const xMax = neighbour.xMax

                if (xMin === from || xMax === from) fromIndex = j
                if (xMin === to || xMax === to) toIndex = j
                if (fromIndex !== -1 && toIndex !== -1) break
            }

            // Situation 1
            // X -->
            // From   Neighbour     To
            // |____________________|

            if (fromIndex === toIndex && fromIndex !== -1) {

                const neighbour = neighbours[fromIndex]
                const edge = this.getEdgeByInfo(grid, neighbour, edgeCode, [ ...neighbour.xMinPercent, ...neighbour.xMaxPercent ])
                grid.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)

            }

            // Situation 2 - Case 1
            // X -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...grid.xMinPercent, ...grid.xMaxPercent ])
                grid.addEdge(edge, edgeCode)

            }

            // Situation 2 - Case 2
            // X -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...fromNeighbour.xMaxPercent, ...toNeighbour.xMinPercent ])
                grid.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 3
            // X -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...fromNeighbour.xMaxPercent, ...grid.xMaxPercent ])
                grid.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 4
            // X -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...grid.xMinPercent, ...toNeighbour.xMinPercent ])
                grid.addEdge(edge, edgeCode)
            }
        }
    }
    
    private _calcVerticalEdges(grid: GridNode, neighbours: GridNode[], edgeCode: number, opEdgeCode: number): void {

        // Case when neighbour has lower level /////////////////////////////////////////////////////

        if (neighbours.length === 1 && neighbours[0].level < grid.level) {

            const edge = this.getEdgeByInfo(grid, neighbours[0], edgeCode, [ ...grid.yMinPercent, ...grid.yMaxPercent ])
            grid.addEdge(edge, edgeCode)
            neighbours[0].addEdge(edge, opEdgeCode)
            return
        }

        // Case when neighbours have equal or higher levels ////////////////////////////////////////
        
        neighbours = neighbours.filter(neighbour => neighbour.level >= grid.level)
        const ySet = new Set([ grid.yMin, grid.yMax ])
        neighbours.forEach(neighbour => {
            ySet.add(neighbour.yMin)
            ySet.add(neighbour.yMax)
        })
        const yList = [...ySet].sort((y1, y2) => y1 - y2)

        // Iterate sub-edges and find their neighbours
        // If a sub-edge:
        // - [Situation 1] belongs to a neighbour ( add it to <this> and <neighbour> )
        // - [Situation 2] does not belong to any neighbour ( only add it to <this> )
        for (let i = 0; i < yList.length - 1; i++) {

            const from = yList[i]
            const to = yList[i + 1]

            let fromIndex = -1
            let toIndex = -1
            for (let j = 0; j < neighbours.length; j++) {

                const neighbour = neighbours[j]
                const yMin = neighbour.yMin
                const yMax = neighbour.yMax

                if (yMin === from || yMax === from) fromIndex = j
                if (yMin === to || yMax === to) toIndex = j
                if (fromIndex !== -1 && toIndex !== -1) break
            }

            // Situation 1
            // Y -->
            // From   Neighbour     To
            // |____________________|

            if (fromIndex === toIndex && fromIndex !== -1) {

                const neighbour = neighbours[fromIndex]
                const edge = this.getEdgeByInfo(grid, neighbour, edgeCode, [ ...neighbour.yMinPercent, ...neighbour.yMaxPercent ])
                grid.addEdge(edge, edgeCode)
                neighbour.addEdge(edge, opEdgeCode)

            }

            // Situation 2 - Case 1
            // Y -->
            // From                 To
            // |____________________|

            else if (fromIndex === toIndex && fromIndex === -1) {

                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...grid.yMinPercent, ...grid.yMaxPercent ])
                grid.addEdge(edge, edgeCode)

            }

            // Situation 2 - Case 2
            // Y -->
            //      Neighbour_F     From                 To    Neighbour_T
            // |_ _ _ _ _ _ _ _ _ _ |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {

                const fromNeighbour = neighbours[fromIndex]
                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...fromNeighbour.yMaxPercent, ...toNeighbour.yMinPercent ])
                grid.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 3
            // Y -->
            //      Neighbour_F     From                 To
            // |_ _ _ _ _ _ _ _ _ _ |____________________|

            else if (fromIndex !== -1 && toIndex === -1) {

                const fromNeighbour = neighbours[fromIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...fromNeighbour.yMaxPercent, ...grid.yMaxPercent ])
                grid.addEdge(edge, edgeCode)

            } 

            // Situation 2 - Case 4
            // Y -->
            // From                 To    Neighbour_T
            // |____________________|_ _ _ _ _ _ _ _ _ _ ｜

            else if (fromIndex === -1 && toIndex !== -1) {

                const toNeighbour = neighbours[toIndex]
                const edge = this.getEdgeByInfo(grid, null, edgeCode, [ ...grid.yMinPercent, ...toNeighbour.yMinPercent ])
                grid.addEdge(edge, edgeCode)
            }
        }
    }
}

export type SubdivideRules = [ number, number ][]

export interface GridLevelInfo {
    width: number
    height: number
    grids: (GridNode | undefined)[]
}

export class GridNodeRecorder {

    private _levelInfos: GridLevelInfo[]
    private _subdivideRules: SubdivideRules
    private _dispatcher = new Dispatcher(this)
    private _dbActions = new Array<DbAction>()

    registeredGridCount = 0
    storageId_grid_map= new Map<number, GridNode>()

    constructor(subdivideRules: SubdivideRules) {

        const rootGrid = new GridNode({ localId: 0, globalId: 0, storageId: this.registeredGridCount++ })
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

        this._dbActions.push({ type: 'C', data: rootGrid, tableName: 'GridNode' })
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
        this.storageId_grid_map.forEach(grid => {
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
                        const subWidth = this._subdivideRules[_grid.level][0]
                        const children = _grid.children.filter(child => child !== null)
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
                        const subWidth = this._subdivideRules[_grid.level][0]
                        const children = _grid.children.filter(child => child !== null)
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
                        const [ subWidth, subHeight ] = this._subdivideRules[_grid.level]
                        const children = _grid.children.filter(child => child !== null)
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
                        const subWidth = this._subdivideRules[_grid.level][0]
                        const children = _grid.children.filter(child => child !== null)
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

        this._dbActions.push({ type: 'U', data: grid, tableName: 'GridNode' })

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
                storageId: this.registeredGridCount++,
                globalRange: [ subGlobalWidth, subGlobalHeight ]
            })

            grid.children[localId] = subGrid
            this.storageId_grid_map.set(subGrid.uuId, subGrid)
            this._levelInfos[level + 1].grids[subGlobalId] = subGrid
            this._dbActions.push({ type: 'C', tableName: 'GridNode', data: subGrid })

            callback && callback(subGrid)
        }
    }

    // Submit grid CRUD actions to IndexedDB
    submit(callback?: Callback<GridNode[]>) {

        this._actor.send('gridProcess', this._dbActions, callback)
        this._dbActions = new Array<DbAction>()
    }

    removeGrid(grid: GridNode, callback?: Function) {

        if (!grid) return

        // Find last valid grid
        const lastValidGrid = this.storageId_grid_map.get(this.registeredGridCount - 1)!
        this.storageId_grid_map.delete(lastValidGrid.uuId)

        // Overwrite the texture data of this deleted grid to the valid one
        if (!lastValidGrid.equal(grid)) {

            this.storageId_grid_map.set(grid.uuId, lastValidGrid)
            lastValidGrid.uuId = grid.uuId
            callback && callback(lastValidGrid)
        }

        // Remove record from parent
        const parent = this.getGridParent(grid)
        if (parent) parent.children[grid.localId] = null

        // Remove grid
        this._levelInfos[grid.level].grids[grid.globalId] = undefined
        this.registeredGridCount--
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
        return neighbour_storageIds.map(id => this.storageId_grid_map.get(id)).filter(node => node !== undefined)
    }
}

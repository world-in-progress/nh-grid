import axios from 'axios'
import { GUI } from 'dat.gui'
import { VibrantColorGenerator } from './VibrantColorGenerator'
import { EDGE_CODE_EAST, EDGE_CODE_NORTH, EDGE_CODE_SOUTH, EDGE_CODE_WEST, GridEdge, GridEdgeRecoder, GridNode } from './GridNode'
import { BoundingBox2D } from './BoundingBox2D'

export default class GridLayer {

    /**
     * @param {{
     *      srcCS: number,
     *      maxGridNum: number,
     *      edgeProperties: string[],
     *      maxSubdividedDepth: number,
     *      subdivideRules: [number, number][]
     *      boundaryCondition: [number, number, number, number]
     * }} options 
     */
    constructor(options) {

        // Layer-related //////////////////////////////////////////////////

        this.type = 'custom'
        this.map = undefined
        this.id = 'GridLayer'
        this.renderingMode = '3d'
        this.isInitialized = false

        // Function-related //////////////////////////////////////////////////

        /** Update set
         * @type { Set<{level: number, globalId: number, hitOrNot: boolean} | {lon: number, lat: number}> } 
        */
        this.hitSet = new Set()

        /** Hit grid list used in Editor Type 
         * @type { GridNode[] } 
        */
        this.hitGridList = []

        // Subdivide rule
        this.srcCS = options.srcCS
        this.subdivideRules = options.subdivideRules || [[1, 1]]

        // Grid properties
        this.registeredGridCount = 0
        /** @type { Map<number, GridNode> } */
        this.storageIdGridMap = new Map()
        this.maxGridNum = options.maxGridNum
        this.bBox = new BoundingBox2D(...options.boundaryCondition)

        /** @type {{width: number, height: number, count: number, grids: GridNode[]}[]} */
        this.gridRecoder = new Array(this.subdivideRules.length)

        this.edgeRecoder = new GridEdgeRecoder(options.edgeProperties)

        // Add rootGrid to gridRecoder
        const rootGrid = new GridNode({
            localId: 0,
            globalId: 0,
            storageId: this.registeredGridCount++
        })
        this.gridRecoder[0] = {
            width: 1,
            height: 1,
            count: 1,
            grids: [ rootGrid ]
        }

        // Init gridRecoder
        this.subdivideRules.forEach((_, ruleLevel, rules) => {
            if (ruleLevel === 0) return

            const width = this.gridRecoder[ruleLevel - 1].width * rules[ruleLevel - 1][0]
            const height = this.gridRecoder[ruleLevel - 1].height * rules[ruleLevel - 1][1]

            this.gridRecoder[ruleLevel] = {
                width,
                height,
                count: 0,
                grids: undefined,
            }
            this.gridRecoder[ruleLevel].grids = new Array(width * height)
        })

        // Grid render list
        this.fillList = []
        this.lineList = []

        // Storage texture memory
        this.storageTextureSize = Math.ceil(Math.sqrt(options.maxGridNum))

        // Palette color list
        const colorGenerator = new VibrantColorGenerator()
        this.paletteColorList = new Uint8Array(this.subdivideRules.length * 3)
        for (let i = 0; i < this.subdivideRules.length; i++) {
            const color = colorGenerator.nextColor().map(channel => channel * 255.0)
            this.paletteColorList.set(color, i * 3)
        }

        // GPU-related //////////////////////////////////////////////////

        /** @type { WebGL2RenderingContext } */
        this._gl = undefined

        // Texture resource
        this.xTexture = undefined
        this.yTexture = undefined
        this.levelTexture = undefined
        this.paletteTexture = undefined
        this.fillIndexTexture = undefined
        this.lineIndexTexture = undefined

        // Interaction-related //////////////////////////////////////////////////

        this.isShiftClick = false

        // Event handler
        this.mouseupHandler = this._mouseupHandler.bind(this)
        this.mousedownHandler = this._mousedownHandler.bind(this)
        this.mousemoveHandler = this._mousemoveHandler.bind(this)

        // Mode
        this.typeChanged = false
        this.EDITOR_TYPE = 0b01
        this.SUBDIVIDER_TYPE = 0b11
        this._currentType = this.SUBDIVIDER_TYPE

        // Interaction option
        this.uiOption = {
            capacity: 0.0,
            level: this.subdivideRules.length - 1
        }

        // Dat.GUI
        this.gui = new GUI()
        const brushFolder = this.gui.addFolder('Brush')
        brushFolder.add(this.uiOption, 'level', 1, this.subdivideRules.length - 1, 1)
        brushFolder.open()
        this.gui.add(this.uiOption, 'capacity',0, this.maxGridNum).name('Capacity').listen().onChange()

        this.capacityController = this.gui.__controllers[0]
        this.capacityController.setValue(0.0)
        this.capacityController.domElement.style.pointerEvents = 'none'

    }

    /**
     * @param {number} type
     */
    set currentType(type) {

        if (type === this._currentType) return

        this.typeChanged = true
        this._currentType = type

        if (type === this.EDITOR_TYPE) {

            // Change event handlers
            this.addEditorUIHandler()

            // Find neighbours for all grids
            this.findNeighbours()

            // Generate hit list
            this.storageIdGridMap.forEach(grid => {
                if (grid.hit === true && grid.level !== 0) {
                    this.hitGridList.push(grid)
                    grid.hit = false
                }
            })

            // Set show list (it is static when in Editor type)
            this.lineList = this.hitGridList.map(grid => grid.storageId)

            // Refill palette texture
            fillSubTexture2DByArray(this._gl, this.paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, this._gl.RGB, this._gl.UNSIGNED_BYTE, this.paletteColorList)

        } else {

            // Change event handlers
            this.addSubdividerUIHandler()

            // Release cache
            this.hitGridList.forEach(grid => grid.hit = true)
            this.hitGridList = []

            // Refill palette texture
            const colorList = new Uint8Array(this.subdivideRules.length * 3)
            for (let i = 0; i < this.subdivideRules.length; i++) {
                colorList.set([ 0, 127, 127 ], i * 3)
            }
            fillSubTexture2DByArray(this._gl, this.paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, this._gl.RGB, this._gl.UNSIGNED_BYTE, colorList)
        }

        this.map.triggerRepaint()
    }

    /**
     * When changing into Editor Type, neighbours of each grid need to be determined.
     */
    findNeighbours() {

        const that = this
        /**
         * 
         * @param { number } u 
         * @param { number } v 
         * @param { number } level 
         * @returns { GridNode | null }
         */
        function getGrid(u, v, level) {

            const width = this.gridRecoder[level].width
            const height = this.gridRecoder[level].height

            if (u < 0 || u >= width || v < 0 || v > height) return null

            const globalId = v * width + u
            return this.gridRecoder[level].grids[globalId]
        }
            
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
         * @type { GridNode[] } 
        */
        const validGrids = []
        this.storageIdGridMap.forEach(grid => {
            if (grid.hit) validGrids.push(grid)
        })

        // Iterate all valid grids and find their neighbours
        validGrids.forEach(grid => {
            
            const level = grid.level
            const width = this.gridRecoder[level].width

            const globalU = grid.globalId % width
            const globalV = Math.floor(grid.globalId / width)

            const tGrid = getGrid.call(this, globalU, globalV + 1, level)
            const lGrid = getGrid.call(this, globalU - 1, globalV, level)
            const bGrid = getGrid.call(this, globalU, globalV - 1, level)
            const rGrid = getGrid.call(this, globalU + 1, globalV, level)

            // Check top edge with tGrid
            if (tGrid) {
                
                // Get all children of tGrid, adjacent to grid

                /** @type { GridNode[] } */
                const adjChildren = []

                /** @type { GridNode[] } */
                const stack = [ tGrid ]

                while (stack.length) {
                    const _grid = stack.pop()

                    if (_grid.children.length) {
                        const [ subWidth, subHeight ] = this.subdivideRules[_grid.level]
                        stack.push(..._grid.children.filter(childGrid => childGrid.localId < subWidth))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(childGrid => childGrid.hit).forEach(childGrid => {
                    grid.neighbours[EDGE_CODE_NORTH].add(childGrid)
                    childGrid.neighbours[EDGE_CODE_SOUTH].add(grid)
                })
            }

            // Check left edge with lGrid
            if (lGrid) {
                    
                // Get all children of lGrid, adjacent to grid

                /** @type { GridNode[] } */
                const adjChildren = []
    
                /** @type { GridNode[] } */
                const stack = [ lGrid ]

                while (stack.length) {
                    const _grid = stack.pop()
    
                    if (_grid.children.length) {
                        const [ subWidth, subHeight ] = this.subdivideRules[_grid.level]
                        stack.push(..._grid.children.filter(childGrid => (childGrid.localId % subWidth) === subWidth - 1))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(childGrid => childGrid.hit).forEach(childGrid => {
                    grid.neighbours[EDGE_CODE_WEST].add(childGrid)
                    childGrid.neighbours[EDGE_CODE_EAST].add(grid)
                })
            }

            // Check bottom edge with rGrid
            if (bGrid) {
                    
                // Get all children of bGrid, adjacent to grid

                /** @type { GridNode[] } */
                const adjChildren = []
    
                /** @type { GridNode[] } */
                const stack = [ bGrid ]

                while (stack.length) {
                    const _grid = stack.pop()
    
                    if (_grid.children.length) {
                        const [ subWidth, subHeight ] = this.subdivideRules[_grid.level]
                        stack.push(..._grid.children.filter(childGrid => childGrid.localId >= subWidth * (subHeight - 1)))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(childGrid => childGrid.hit).forEach(childGrid => {
                    grid.neighbours[EDGE_CODE_SOUTH].add(childGrid)
                    childGrid.neighbours[EDGE_CODE_NORTH].add(grid)
                })
            }

            // Check right edge with rGrid
            if (rGrid) {
                    
                // Get all children of rGrid, adjacent to grid

                /** @type { GridNode[] } */
                const adjChildren = []
    
                /** @type { GridNode[] } */
                const stack = [ rGrid ]

                while (stack.length) {
                    const _grid = stack.pop()
    
                    if (_grid.children.length) {
                        const [ subWidth, subHeight ] = this.subdivideRules[_grid.level]
                        stack.push(..._grid.children.filter(childGrid => (childGrid.localId % subWidth) === 0))
                    } else adjChildren.push(_grid)
                }

                adjChildren.filter(childGrid => childGrid.hit).forEach(childGrid => {
                    grid.neighbours[EDGE_CODE_EAST].add(childGrid)
                    childGrid.neighbours[EDGE_CODE_WEST].add(grid)
                })
            }

            grid.resetEdges()
        })
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { number } level Level of grid
     * @param { number } globalId Global id of grid
    */
    subdivideGrid(gl, level, globalId) {

        // Subdivide parent if this grid does not exist
        if (!this.gridRecoder[level].grids[globalId]) this.subdivideGrid(gl, level - 1, this.getParentGlobalId(level, globalId))

        const grid = this.gridRecoder[level].grids[globalId]

        // Return if grid has been subdivided
        if (grid.children.length !== 0) return

        // Subdivide
        const [subWidth, subHeight] = this.subdivideRules[level]
        const globalU = globalId % this.gridRecoder[level].width
        const globalV = Math.floor(globalId / this.gridRecoder[level].width)
        const subGlobalWidth = this.gridRecoder[level + 1].width
        const subGlobalHeight = this.gridRecoder[level + 1].height

        for (let localId = 0; localId < subWidth * subHeight; localId++) {

            const subU = localId % subWidth
            const subV = Math.floor(localId / subWidth)
            
            const subGlobalU = globalU * subWidth + subU
            const subGlobalV = globalV * subHeight + subV
            const subGlobalId = subGlobalV * (this.gridRecoder[level].width * subWidth) + subGlobalU
            
            const subGrid = new GridNode({
                localId,
                parent: grid,
                globalId: subGlobalId,
                storageId: this.registeredGridCount++,
                globalRange: [ subGlobalWidth, subGlobalHeight ]
            })
            this.writeGridInfoToTexture(gl, subGrid)

            grid.children.push(subGrid)
            this.gridRecoder[level + 1].count += 1
            this.gridRecoder[level + 1].grids[subGlobalId] = subGrid

            this.storageIdGridMap.set(subGrid.storageId, subGrid)
        }
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { number } level Level of grid
     * @param { number } globalId Global id of grid
     * @param { boolean } hitOrNot Hit or not
    */
    hitSubdivider(gl, level, globalId, hitOrNot) {

        // Subdivide parent first (to create this grid if it does not exist)
        const parentGlobalId = this.getParentGlobalId(level, globalId)
        this.subdivideGrid(gl, level - 1, parentGlobalId)
        
        // Skip if grid has been hit
        const grid = this.gridRecoder[level].grids[globalId]
        if (grid.hit) return

        // Remove parent hitting if it has been hit
        let parent = grid.parent
        while (parent) {
            parent.hit = false
            parent = parent.parent
        }
        
        // Remove children if they have existed
        const stack = [...grid.children]
        while (stack.length > 0) {
            const currentGrid = stack.pop()
            if (!currentGrid) continue

            stack.push(...currentGrid.children)
            this.removeGrid(gl, currentGrid)
        }
        grid.children = []

        // Hit
        grid.hit = hitOrNot
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { number } lon
     * @param { number } lat
    */
    hitEditor(gl, lon, lat) {

        this.hitGridList.forEach(grid => {
            if (grid.within(this.bBox, lon, lat)) {
                grid.hit = true
                grid.calcEdges(this.edgeRecoder)
                console.log(grid.edges)
            }
        })
    }

    /**
     * @param { WebGL2RenderingContext } gl 
     * @param { GridNode } grid 
     */
    removeGrid(gl, grid) {

        if (grid === undefined) return

        // Find last valid grid
        const lastValidGrid = this.storageIdGridMap.get(this.registeredGridCount - 1)
        this.storageIdGridMap.delete(lastValidGrid.storageId)

        // Overwrite the texture data of the grid to the valid one
        if (!lastValidGrid.equal(grid)) {

            this.storageIdGridMap.set(grid.storageId, lastValidGrid)
            
            lastValidGrid.storageId = grid.storageId
            this.writeGridInfoToTexture(gl, lastValidGrid)
        }

        // Remove
        this.gridRecoder[grid.level].grids[grid.globalId] = undefined
        this.registeredGridCount--
        grid.release()
    }

    /** 
     * @param {WebGL2RenderingContext} gl 
     * @param {GridNode} grid
    */
    writeGridInfoToTexture(gl, grid) {

        const vertices = grid.getVertices(this.srcCS, this.bBox)
        const storageU = grid.storageId % this.storageTextureSize
        const storageV = Math.floor(grid.storageId / this.storageTextureSize)

        fillSubTexture2DByArray(gl, this.xTexture, 0, storageU, storageV, 1, 1, gl.RG, gl.FLOAT, vertices.slice(0, 2))
        fillSubTexture2DByArray(gl, this.yTexture, 0, storageU, storageV, 1, 1, gl.RG, gl.FLOAT, vertices.slice(2, 4))
        fillSubTexture2DByArray(gl, this.levelTexture, 0, storageU, storageV, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array([grid.level]))
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { ArrayLike } list 
     * @param { WebGLTexture } texture 
    */
    writeIndicesToTexture(gl, list, texture) {
        
        const listLength = list.length
        const blockWidth = this.storageTextureSize
        const blockHeight = Math.ceil(listLength / this.storageTextureSize)
        const blockData = new Uint32Array(blockWidth * blockHeight) // TODO: can be made as pool
        blockData.set(list, 0)

        fillSubTexture2DByArray(gl, texture, 0, 0, 0, blockWidth, blockHeight, gl.RED_INTEGER, gl.UNSIGNED_INT, blockData)
    }

    /**
     * @param { WebGL2RenderingContext } gl
    */
    tickSubdivider(gl) {

        this.fillList = []
        this.lineList = []

        const stack = [this.gridRecoder[0].grids[0]]
        while(stack.length > 0) {

            const grid = stack.pop()

            // Add hit grid to render list
            if (grid.hit || grid.children.length === 0) {

                this.lineList.push(grid.storageId)
                grid.hit && this.fillList.push(grid.storageId)
                
            } else {
                stack.push(...grid.children)
            }
        }
        this.writeIndicesToTexture(gl, this.fillList, this.fillIndexTexture)
        this.writeIndicesToTexture(gl, this.lineList, this.lineIndexTexture)
    }

    /**
     * @param { WebGL2RenderingContext } gl
    */
    tickEditor(gl) {
        
        this.fillList = this.hitGridList.filter(grid => grid.hit).map(grid => grid.storageId)
        this.writeIndicesToTexture(gl, this.fillList, this.fillIndexTexture)
        this.writeIndicesToTexture(gl, this.lineList, this.lineIndexTexture)
    }

    /**
     * @param { WebGL2RenderingContext } gl
    */
    hitGrids(gl) {
        
        if (this.hitSet.size === 0 && !this.typeChanged) return

        if (this._currentType === this.SUBDIVIDER_TYPE) {

            this.hitSet.forEach(({ level, globalId, hitOrNot }) => {
                this.hitSubdivider(gl, level, globalId, hitOrNot === undefined ? true : hitOrNot)
            })

            this.tickSubdivider(gl)

        } else {

            this.hitSet.forEach(({ lon, lat }) => {
                this.hitEditor(gl, lon, lat)
            })
            
            this.tickEditor(gl)
        }

        this.hitSet.clear()
        this.typeChanged = false

        // Update display of capacity
        this.uiOption.capacity = this.storageIdGridMap.size
        this.capacityController.updateDisplay()
    }

    serialize() {

        /**
         * @type {{
         *      extent: [ number, number, number, number ],
         *      grids: { id: number, xMinPercent: [ number, number ], yMinPercent: [ number, number ], xMaxPercent: [ number, number ], yMaxPercent: [ number, number ] }[]
         *      edges: { id: number, adjGrids: [ number | null, number | null ], minPercent: [ number, number ], maxPercent: [ number, number ], edgeCode: number }[]
         * }}
         */
        const serializedData = {
            extent: this.bBox.boundary,
            grids: [],
            edges: []
        }
        const grids = serializedData.grids
        const edges = serializedData.edges

        /** @type { Map<string, number> } */
        const levelGlobalId_serializedId_Map = new Map()

        // Serialized edge recoder used to record valid edges
        const sEdgeRecoder = new GridEdgeRecoder()

        // Serialize grids //////////////////////////////////////////////////

        // Iterate hit grids in Editor Type
        if (this._currentType === this.EDITOR_TYPE) {
            this.hitGridList.forEach((grid, index) => {

                grids.push({
                    id: index,
                    xMinPercent: grid._xMinPercent,
                    yMinPercent: grid._yMinPercent,
                    xMaxPercent: grid._xMaxPercent,
                    yMaxPercent: grid._yMaxPercent
                })
                const key = [ grid.level, grid.globalId ].join('-')
                levelGlobalId_serializedId_Map.set(key, index)

                // Avoid edge miss and record valid key
                grid.calcEdges(this.edgeRecoder)
                grid.edgeKeys.forEach(key => {
                    const edge = this.edgeRecoder.getEdgeByKey(key)
                    sEdgeRecoder.addEdge(edge)
                })
            })
        }
        // Iterate hit grids in Subdivider Type
        else {

            // Find neighbours for all grids
            this.findNeighbours()
            
            let index = 0
            this.storageIdGridMap.forEach(grid => {
                if (grid.hit) {

                    grids.push({
                        id: index,
                        xMinPercent: grid._xMinPercent,
                        yMinPercent: grid._yMinPercent,
                        xMaxPercent: grid._xMaxPercent,
                        yMaxPercent: grid._yMaxPercent
                    })

                    const key = [ grid.level, grid.globalId ].join('-')
                    levelGlobalId_serializedId_Map.set(key, index)
                    index++

                    // Avoid edge miss and record valid key
                    grid.calcEdges(this.edgeRecoder)
                    grid.edgeKeys.forEach(key => {
                        const edge = this.edgeRecoder.getEdgeByKey(key)
                        sEdgeRecoder.addEdge(edge)
                    })
                }
            })
        }

        // Serialize edges //////////////////////////////////////////////////

        let index = 0
        sEdgeRecoder._edgeMap.forEach(edge => {

            const { adjGrids, minPercent, maxPercent, edgeCode } = edge.serialization
            const grid1 = adjGrids[0] !== 'null-null' ? levelGlobalId_serializedId_Map.get(adjGrids[0]) : null
            const grid2 = adjGrids[1] !== 'null-null' ? levelGlobalId_serializedId_Map.get(adjGrids[1]) : null

            edges.push({
                id: index++,
                adjGrids: [ grid1, grid2 ],
                minPercent,
                maxPercent,
                edgeCode
            })
        })

        return serializedData
    }
    
    _mousedownHandler(e) {
        
        if (e.originalEvent.shiftKey && e.originalEvent.button === 0) {
            this.isShiftClick = true
            this.map.dragPan.disable()
        }
    }

    _mouseupHandler(e) {

        if (this.isShiftClick) {
            this.map.dragPan.enable()
            this.isShiftClick = false

            const lngLat = this.map.unproject([e.point.x, e.point.y])
            this.hit(lngLat.lng, lngLat.lat, this.uiOption.level)
        }
    }

    _mousemoveHandler(e) {

        if (this.isShiftClick) {
            this.map.dragPan.disable()

            const lngLat = this.map.unproject([e.point.x, e.point.y])
            this.hit(lngLat.lng, lngLat.lat, this.uiOption.level)
        }
    }

    removeUIHandler() {
    
        this.map
        .off('mouseup', this.mouseupHandler)
        .off('mousedown', this.mousedownHandler)
        .off('mousemove', this.mousemoveHandler)
    }

    addSubdividerUIHandler() {

        this.removeUIHandler()
    
        this.map
        .on('mouseup', this.mouseupHandler)
        .on('mousedown', this.mousedownHandler)
        .on('mousemove', this.mousemoveHandler)
    }

    addEditorUIHandler() {

        this.removeUIHandler()
    
        this.map
        .on('mouseup', this.mouseupHandler)
        .on('mousedown', this.mousedownHandler)
    }
    
    async init() {

        const gl = this._gl

        enableAllExtensions(gl)

        // Create shader
        this.terrainMeshShader = await createShader(gl, '/shaders/gridMesh.glsl')
        this.terrainLineShader = await createShader(gl, '/shaders/gridLine.glsl')

        // Create texture
        this.paletteTexture = createTexture2D(gl, 1, this.subdivideRules.length, 1, gl.RGB8)
        this.xTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.RG32F)
        this.yTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.RG32F)
        this.levelTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.R16UI)
        this.fillIndexTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.R32UI)
        this.lineIndexTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.R32UI)

        // Init palette texture (default in subdivider type)
        const colorList = new Uint8Array(this.subdivideRules.length * 3)
        for (let i = 0; i < this.subdivideRules.length; i++) {
            colorList.set([ 0, 127, 127 ], i * 3)
        }
        fillSubTexture2DByArray(gl, this.paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, colorList)
        
        // Init root grid
        const rootGrid = this.gridRecoder[0].grids[0]
        this.writeGridInfoToTexture(gl, rootGrid)
        this.storageIdGridMap.set(rootGrid.storageId, rootGrid)

        for (let globalId = 0; globalId < this.gridRecoder[1].width * this.gridRecoder[1].height; globalId++) {
            
            // Just for initialization and not hit
            this.hitSet.add({
                level: 1,
                globalId,
                hitOrNot: false
            })
        }

        // Init DOM Elements and handlers ////////////////////////////////////////////////////////////

        // [1] Subdivider Type Button
        const subdividerButton = document.createElement('button')
        subdividerButton.title = 'Grid Subdivider'
        subdividerButton.addEventListener('click', () => this.currentType = this.SUBDIVIDER_TYPE)
        axios.get('/icon/Subdivider.svg')
        .then(response => {

            const svgContent = response.data
            subdividerButton.style.top = '45%'
            subdividerButton.innerHTML = svgContent

            const svgElement = subdividerButton.querySelector('svg')
            if (svgElement) {

                svgElement.style.width = '100%'
                svgElement.style.height = '100%'
                svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')
        
                if (!svgElement.getAttribute('viewBox')) {
                    svgElement.setAttribute('viewBox', `0 0 ${svgElement.width.baseVal.value} ${svgElement.height.baseVal.value}`)
                }
            }
            document.body.appendChild(subdividerButton)
        })
        .catch(error => {
            console.error('Error loading SVG: ', error)
        })
        addButtonClickListener(subdividerButton)

        // Make subdivider type as default
        subdividerButton.classList.add('active') // add blooming effect
        this.addSubdividerUIHandler()

        // [2] Editor Type Button
        const editorButton = document.createElement('button')
        editorButton.title = 'Grid Editor'
        editorButton.addEventListener('click', () => this.currentType = this.EDITOR_TYPE)
        axios.get('/icon/Editor.svg')
        .then(response => {

            const svgContent = response.data
            editorButton.style.top = '55%'
            editorButton.innerHTML = svgContent

            const svgElement = editorButton.querySelector('svg')
            if (svgElement) {

                svgElement.style.width = '100%'
                svgElement.style.height = '100%'
                svgElement.style.padding = '0px 0px'
                svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')
        
                if (!svgElement.getAttribute('viewBox')) {
                    svgElement.setAttribute('viewBox', `0 0 ${svgElement.width.baseVal.value} ${svgElement.height.baseVal.value}`)
                }
            }
            document.body.appendChild(editorButton)
        })
        .catch(error => {
            console.error('Error loading SVG: ', error)
        })
        addButtonClickListener(editorButton)

        // [3] Remove Event handler for map boxZoom
        this.map.boxZoom.disable()

        // [4] Add event listener for <Shift + S> (Download serialization json)
        document.addEventListener('keydown', e => {

            if (e.shiftKey && e.key === 'S') {
                let data = this.serialize()
                let jsonData = JSON.stringify(data)
                let blob = new Blob([jsonData], { type: 'application/json' })
                let link = document.createElement('a')
                link.href = URL.createObjectURL(blob)
                link.download = 'gridInfo.json'
                link.click()
            }
        })

        // All done ////////////////////////////////////////////////////////////

        this.isInitialized = true
    }

    /**
     * @param { number } level Level of grid
     * @param { number } globalId Global id of grid
    */
    getGridLocalId(level, globalId) {
        if (level === 0) return 0
    
        const { width } = this.gridRecoder[level]
        const [subWidth, subHeight] = this.subdivideRules[level - 1]
    
        const u = globalId % width
        const v = Math.floor(globalId / width)
    
        return ((v % subHeight) * subWidth) + (u % subWidth);
    }

    /**
     * @param { number } level Level of grid
     * @param { number } globalId Global id of grid
    */
    getParentGlobalId(level, globalId) {
        if (level === 0) return 0

        const { width } = this.gridRecoder[level]
        const [subWidth, subHeight] = this.subdivideRules[level - 1]

        const u = globalId % width
        const v = Math.floor(globalId / width)

        return Math.floor(v / subHeight) * this.gridRecoder[level - 1].width + Math.floor(u / subWidth)
    }

    /** 
     * @param {WebGL2RenderingContext} gl 
    */
    drawGridMesh(gl) {

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LESS)

        gl.useProgram(this.terrainMeshShader)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.xTexture)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.yTexture)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, this.levelTexture)
        gl.activeTexture(gl.TEXTURE3)
        gl.bindTexture(gl.TEXTURE_2D, this.fillIndexTexture)
        gl.activeTexture(gl.TEXTURE4)
        gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture)

        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'xTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'yTexture'), 1)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'levelTexture'), 2)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'indexTexture'), 3)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'paletteTexture'), 4)
        gl.uniform2fv(gl.getUniformLocation(this.terrainMeshShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this.terrainMeshShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainMeshShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.fillList.length)
    }

    /** @param {WebGL2RenderingContext} gl */
    drawGridLine(gl) {

        gl.disable(gl.BLEND)
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this.terrainLineShader)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.xTexture)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.yTexture)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, this.lineIndexTexture)

        gl.uniform1i(gl.getUniformLocation(this.terrainLineShader, 'xTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this.terrainLineShader, 'yTexture'), 1)
        gl.uniform1i(gl.getUniformLocation(this.terrainLineShader, 'indexTexture'), 2)
        gl.uniform2fv(gl.getUniformLocation(this.terrainLineShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this.terrainLineShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainLineShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.LINE_LOOP, 0, 4, this.lineList.length)
    }

    onAdd(map, gl) {

        this._gl = gl
        this.map = map
        this.init()
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { [number] } matrix  
     */
    render(gl, matrix) {

        // Skip if not ready
        if (!this.isInitialized) return

        // Tick logic
        this.map.update()
        this.hitGrids(gl)

        // Tick render: Mesh Pass
        this.drawGridMesh(gl)
        
        // Tick render: Line Pass
        this.drawGridLine(gl)

        // WebGL check
        errorCheck(gl)
    }

    /**
     * @param { number } lon
     * @param { number } lat
     * @param { number } level
    */
    hit(lon, lat, level) {

        const maxLevel = this.subdivideRules.length - 1

        // Subidivider type
        if (this._currentType === this.SUBDIVIDER_TYPE) {
            const hitLevel = level

            if (hitLevel === undefined || hitLevel > maxLevel) return 
    
            const { width, height } = this.gridRecoder[hitLevel]
            const normalizedX = (lon - this.bBox.xMin) / (this.bBox.xMax - this.bBox.xMin)
            const normalizedY = (lat - this.bBox.yMin) / (this.bBox.yMax - this.bBox.yMin)
    
            if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return
    
            const col = Math.floor(normalizedX * width)
            const row = Math.floor(normalizedY * height)
    
            this.hitSet.add({
                level: hitLevel,
                hitOrNot: true,
                globalId: row * width + col
            })
        }
        // Editor type 
        else {
            this.hitSet.add({ lon, lat })
        }

        this.map.triggerRepaint()
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function addButtonClickListener(button) {
    button.addEventListener('click', () => {

      const allButtons = document.querySelectorAll('button')
      allButtons.forEach(btn => btn.classList.remove('active'))
  
      button.classList.add('active')
    });
  }

/** @param {WebGL2RenderingContext} gl */
function errorCheck(gl) {
    const error = gl.getError()
    if (error !== gl.NO_ERROR) {
        console.error('Error happened: ', getWebGLErrorMessage(gl, error))
    }
}

/** @param {WebGL2RenderingContext} gl */
function enableAllExtensions(gl) {

    const extensions = gl.getSupportedExtensions()
    extensions.forEach(ext => {
        gl.getExtension(ext)
        console.log('Enabled extensions: ', ext)
    })
}

/** 
 * @param {WebGL2RenderingContext} gl  
 * @param {string} url 
 */
async function createShader(gl, url) {

    let shaderCode = ''
    await axios.get(url)
    .then(response => shaderCode += response.data)
    const vertexShaderStage = compileShader(gl, shaderCode, gl.VERTEX_SHADER)
    const fragmentShaderStage = compileShader(gl, shaderCode, gl.FRAGMENT_SHADER)

    const shader = gl.createProgram()
    gl.attachShader(shader, vertexShaderStage)
    gl.attachShader(shader, fragmentShaderStage)
    gl.linkProgram(shader)
    if (!gl.getProgramParameter(shader, gl.LINK_STATUS)) {

        console.error('An error occurred linking shader stages: ' + gl.getProgramInfoLog(shader))
    }

    return shader

    function compileShader(gl, source, type) {
    
        const versionDefinition = '#version 300 es\n'
        const module = gl.createShader(type)
        if (type === gl.VERTEX_SHADER) source = versionDefinition + '#define VERTEX_SHADER\n' + source
        else if (type === gl.FRAGMENT_SHADER) source = versionDefinition + '#define FRAGMENT_SHADER\n' + source
    
        gl.shaderSource(module, source)
        gl.compileShader(module)
        if (!gl.getShaderParameter(module, gl.COMPILE_STATUS)) {
            console.error('An error occurred compiling the shader module: ' + gl.getShaderInfoLog(module))
            gl.deleteShader(module)
            return null
        }
    
        return module
    }
}

/**
 * @param { WebGL2RenderingContext } gl 
 * @param { WebGLTexture[] } [ textures ] 
 * @param { WebGLRenderbuffer } [ depthTexture ] 
 * @param { WebGLRenderbuffer } [ renderBuffer ] 
 * @returns { WebGLFramebuffer }
 */
function createFrameBuffer(gl, textures, depthTexture, renderBuffer) {

    const frameBuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer)

    textures?.forEach((texture, index) => {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + index, gl.TEXTURE_2D, texture, 0)
    })

    if (depthTexture) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0)
    }

    if (renderBuffer) {

        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, renderBuffer)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {

        console.error('Framebuffer is not complete')
    }

    return frameBuffer
}

/**
 * @param { WebGL2RenderingContext } gl 
 * @param { number } width 
 * @param { number } height 
 * @param { number } internalFormat 
 * @param { number } format 
 * @param { number } type 
 * @param { ArrayBufferTypes | ImageBitmap } [ resource ]
 */
function createTexture2D(gl, level, width, height, internalFormat, format = undefined, type = undefined, resource = undefined, generateMips = false) {
    
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, generateMips ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    resource ? 
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, 0, format, type, resource)
    : 
    gl.texStorage2D(gl.TEXTURE_2D, level, internalFormat, width, height) 

    gl.bindTexture(gl.TEXTURE_2D, null)

    return texture
}

/**
 * @param { WebGL2RenderingContext } gl 
 * @param { number } width 
 * @param { number } height 
 * @param { number } internalFormat 
 * @param { number } format 
 * @param { number } type 
 * @param { ArrayBufferTypes } array
 */
function fillSubTexture2DByArray(gl, texture, level, xOffset, yOffset, width, height, format, type, array) {
    
    // Bind the texture
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Upload texture data
    gl.texSubImage2D(gl.TEXTURE_2D, 0, xOffset, yOffset, width, height, format, type, array)

    // Unbind the texture
    gl.bindTexture(gl.TEXTURE_2D, null);
}

/**
 * @param { WebGL2RenderingContext } gl 
 * @param { number } width 
 * @param { number } height 
 * @param { number } internalFormat 
 * @param { number } format 
 * @param { number } type 
 * @param { ArrayBufferTypes } array
 */
function fillTexture2DByArray(gl, texture, width, height, internalFormat, format, type, array) {
    
    // Bind the texture
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Upload texture data
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, array)

    // Unbind the texture
    gl.bindTexture(gl.TEXTURE_2D, null);
}

/**
 * @param { WebGL2RenderingContext } gl 
 * @param { number } [ width ] 
 * @param { number } [ height ] 
 * @returns { WebGLRenderbuffer }
 */
function createRenderBuffer(gl, width, height) {

    const bufferWidth = width || gl.canvas.width * window.devicePixelRatio
    const bufferHeight = height || gl.canvas.height * window.devicePixelRatio

    const renderBuffer = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderBuffer)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, bufferWidth, bufferHeight)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)

    return renderBuffer
}

// Helper function to get WebGL error messages
function getWebGLErrorMessage(gl, error) {
    switch (error) {
        case gl.NO_ERROR:
            return 'NO_ERROR';
        case gl.INVALID_ENUM:
            return 'INVALID_ENUM';
        case gl.INVALID_VALUE:
            return 'INVALID_VALUE';
        case gl.INVALID_OPERATION:
            return 'INVALID_OPERATION';
        case gl.OUT_OF_MEMORY:
            return 'OUT_OF_MEMORY';
        case gl.CONTEXT_LOST_WEBGL:
            return 'CONTEXT_LOST_WEBGL';
        default:
            return 'UNKNOWN_ERROR';
    }
}

async function loadImage(url) {
    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
        }
        const blob = await response.blob()
        const imageBitmap = await createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "default" })
        return imageBitmap

    } catch (error) {
        console.error(`Error loading image (url: ${url})`, error)
        throw error
    }
}

function getMaxMipLevel(width, height) {
    return Math.floor(Math.log2(Math.max(width, height)));
}

async function loadF32Image(url) {

    const response = await axios.get(url, {responseType: "blob"})
    const bitmap = await createImageBitmap(response.data, {imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "default"})
    
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const gl = canvas.getContext("webgl2");
    const pixelData = new Uint8Array(bitmap.width * bitmap.height * 4)

    // Create texture
    const oTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, oTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bitmap.width, bitmap.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)

    // Create framebuffer
    const FBO = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, FBO)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, oTexture, 0)

    // Read pixels
    gl.readPixels(0, 0, bitmap.width, bitmap.height, gl.RGBA, gl.UNSIGNED_BYTE, pixelData)

    // Release objects
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.deleteFramebuffer(FBO)
    gl.deleteTexture(oTexture)
    gl.finish()

    return {
        width: bitmap.width,
        height: bitmap.height,
        buffer: new Float32Array(pixelData.buffer)
    }
}

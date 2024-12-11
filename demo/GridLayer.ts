import axios from 'axios'
import proj4 from 'proj4'
import { MapMouseEvent } from 'mapbox-gl'
import { GUI, GUIController } from 'dat.gui'
proj4.defs("ESRI:102140","+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +units=m +no_defs +type=crs")

import NHMap from './map/NHMap'
import { BoundingBox2D } from '../src/BoundingBox2D'
import { VibrantColorGenerator } from '../src/VibrantColorGenerator'
import { GridNode, GridEdgeRecorder, GridNodeRecorder } from '../src/NHGrid'

export interface GridLayerOptions {
    srcCS: string
    maxGridNum: number,
    edgeProperties?: string[], 
    subdivideRules?: [ number, number ][]
    boundaryCondition: [ number, number, number, number ]
}

export interface GridLayerSerializedInfo {
    extent: [ number, number, number, number ]
    grids: { 
        id: number
        xMinPercent: [ number, number ]
        yMinPercent: [ number, number ]
        xMaxPercent: [ number, number ]
        yMaxPercent: [ number, number ] 
    }[]
    edges: {
        id: number
        edgeCode: number
        minPercent: [ number, number ]
        maxPercent: [ number, number ]
        adjGrids: [ number | null, number | null ]
    }[]
}

export default class GridLayer {

    // Layer-related //////////////////////////////////////////////////

    type = 'custom'
    id = 'GridLayer'
    renderingMode = '3d'
    isInitialized = false
    map: NHMap | undefined

    // Function-related //////////////////////////////////////////////////

    // Grid properties
    srcCS: string
    maxGridNum: number
    bBox: BoundingBox2D
    gridRecorder: GridNodeRecorder
    edgeRecorder: GridEdgeRecorder
    subdivideRules: [ number, number ][]

    // Grid render list
    fillList = new Array<number>()
    lineList = new Array<number>()
    hitGridList = new Array<GridNode>()
    hitSet = new Set<{ level: number, globalId: number, hitOrNot: boolean } | { lon: number, lat: number }>

    storageTextureSize: number
    paletteColorList: Uint8Array

    // GPU-related //////////////////////////////////////////////////

    private _gl: WebGL2RenderingContext | undefined

    // Shader
    terrainMeshShader: WebGLProgram = 0
    terrainLineShader: WebGLProgram = 0

    // Texture resource
    levelTexture: WebGLTexture = 0
    paletteTexture: WebGLTexture = 0
    fillIndexTexture: WebGLTexture = 0
    lineIndexTexture: WebGLTexture = 0
    storageTextureArray: WebGLTexture = 0


    // Interaction-related //////////////////////////////////////////////////

    isShiftClick = false
    isDeleteMode = false

    mouseupHandler: Function
    mousedownHandler: Function
    mousemoveHandler: Function
    
    // Mode
    typeChanged = false
    EDITOR_TYPE = 0b01
    SUBDIVIDER_TYPE = 0b11
    private _currentType = 0b11

    uiOption: { capacity: number, level: number }
    
    // Dat.GUI
    gui: GUI
    capacityController: GUIController

    constructor(options: GridLayerOptions) {

        this.srcCS = options.srcCS
        this.subdivideRules = options.subdivideRules || [[1, 1]]

        this.maxGridNum = options.maxGridNum
        this.bBox = new BoundingBox2D(...options.boundaryCondition)
        this.gridRecorder = new GridNodeRecorder(this.subdivideRules)
        this.edgeRecorder = new GridEdgeRecorder(options.edgeProperties)

        // Storage texture memory
        this.storageTextureSize = Math.ceil(Math.sqrt(options.maxGridNum))

        // Palette color list
        const colorGenerator = new VibrantColorGenerator()
        this.paletteColorList = new Uint8Array(this.subdivideRules.length * 3)
        for (let i = 0; i < this.subdivideRules.length; i++) {
            const color = colorGenerator.nextColor().map(channel => channel * 255.0)
            this.paletteColorList.set(color, i * 3)
        }

        // Event handler
        this.mouseupHandler = this._mouseupHandler.bind(this)
        this.mousedownHandler = this._mousedownHandler.bind(this)
        this.mousemoveHandler = this._mousemoveHandler.bind(this)

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
        this.gui.add(this.uiOption, 'capacity',0, this.maxGridNum).name('Capacity').listen()

        this.capacityController = this.gui.__controllers[0]
        this.capacityController.setValue(0.0)
        this.capacityController.domElement.style.pointerEvents = 'none'

    }
    
    set currentType(type: number) {

        const gl = this._gl!

        if (type === this._currentType) return

        this.typeChanged = true
        this._currentType = type

        if (type === this.EDITOR_TYPE) {

            // Change event handlers
            this.addEditorUIHandler()

            // Find neighbours for all grids
            this.gridRecorder.findNeighbours()

            // Generate hit list
            this.gridRecorder.storageId_grid_map.forEach(grid => {
                if (grid.hit === true && grid.level !== 0) {
                    this.hitGridList.push(grid)
                    grid.hit = false
                }
            })

            // Set show list (it is static when in Editor type)
            this.lineList = this.hitGridList.map(grid => grid.storageId)

            // Refill palette texture
            fillSubTexture2DByArray(gl, this.paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, this.paletteColorList)

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
            fillSubTexture2DByArray(gl, this.paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, colorList)
        }

        this.map!.triggerRepaint()
    }
    
    hitSubdivider(level: number, globalId: number, hitOrNot: boolean) {

        // Subdivide parent first (to create this grid if it does not exist)
        const parentGlobalId = this.gridRecorder.getParentGlobalId(level, globalId)
        this.gridRecorder.subdivideGrid(level - 1, parentGlobalId, this.writeGridInfoToTexture.bind(this))
        
        const grid = this.gridRecorder.getGrid(level, globalId)
        if (!grid) {
            console.error('No grid can be hit.')
            return
        }

        // Skip if grid has been hit
        // if (grid.hit) return

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
            this.gridRecorder.removeGrid(currentGrid, this.writeGridInfoToTexture.bind(this))
        }
        grid.children = []

        // Hit
        grid.hit = hitOrNot
    }
    
    hitEditor(lon: number, lat: number) {

        this.hitGridList.forEach(grid => {
            if (grid.within(this.bBox, lon, lat)) {
                grid.hit = true
                grid.calcEdges(this.edgeRecorder)
                console.log(grid.edges)
            }
        })
    }
    
    writeGridInfoToTexture(grid: GridNode) {

        const gl = this._gl!

        const vertices = grid.getVertices(this.srcCS, this.bBox)
        const storageU = grid.storageId % this.storageTextureSize
        const storageV = Math.floor(grid.storageId / this.storageTextureSize)

        fillSubTexture2DArrayByArray(gl, this.storageTextureArray, 0, storageU, storageV, 0, 1, 1, 4, gl.RG, gl.FLOAT, vertices)
        fillSubTexture2DByArray(gl, this.levelTexture, 0, storageU, storageV, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array([grid.level]))
    }
    
    writeIndicesToTexture(list: Array<number>, texture: WebGLTexture) {

        const gl = this._gl!
        
        const listLength = list.length
        const blockWidth = this.storageTextureSize
        const blockHeight = Math.ceil(listLength / this.storageTextureSize)
        const blockData = new Uint32Array(blockWidth * blockHeight) // TODO: can be made as pool
        blockData.set(list, 0)

        fillSubTexture2DByArray(gl, texture, 0, 0, 0, blockWidth, blockHeight, gl.RED_INTEGER, gl.UNSIGNED_INT, blockData)
    }

    tickSubdivider() {

        this.fillList = []
        this.lineList = []

        const stack = [ this.gridRecorder.getGrid(0, 0) ]
        while(stack.length > 0) {

            const grid = stack.pop()
            if (!grid) continue

            // Add hit grid to render list
            if (grid.hit || grid.children.length === 0) {

                this.lineList.push(grid.storageId)
                grid.hit && this.fillList.push(grid.storageId)
                
            } else {
                stack.push(...grid.children.filter(child => child !== null))
            }
        }
        this.writeIndicesToTexture(this.fillList, this.fillIndexTexture)
        this.writeIndicesToTexture(this.lineList, this.lineIndexTexture)
    }

    tickEditor() {
        
        this.fillList = this.hitGridList.filter(grid => grid.hit).map(grid => grid.storageId)
        this.writeIndicesToTexture(this.fillList, this.fillIndexTexture)
        this.writeIndicesToTexture(this.lineList, this.lineIndexTexture)
    }

    hitGrids() {
        
        if (this.hitSet.size === 0 && !this.typeChanged) return

        if (this._currentType === this.SUBDIVIDER_TYPE) {

            (this.hitSet as Set<{ level: number, globalId: number, hitOrNot: boolean }>).forEach(({ level, globalId, hitOrNot }) => {
                this.hitSubdivider(level, globalId, hitOrNot === undefined ? true : hitOrNot)
            })

            this.tickSubdivider()

        } else {

            (this.hitSet as Set<{ lon: number, lat: number }>).forEach(({ lon, lat }) => {
                this.hitEditor(lon, lat)
            })
            
            this.tickEditor()
        }

        this.hitSet.clear()
        this.typeChanged = false

        // Update display of capacity
        this.uiOption.capacity = this.gridRecorder.storageId_grid_map.size
        this.capacityController.updateDisplay()
    }

    serialize() {

        /**
         * @type {}
         */
        const serializedData: GridLayerSerializedInfo = {
            extent: this.bBox.boundary,
            grids: [],
            edges: []
        }
        const grids = serializedData.grids
        const edges = serializedData.edges

        const levelGlobalId_serializedId_Map: Map<string, number> = new Map<string, number>()

        // Serialized edge recoder used to record valid edges
        const sEdgeRecoder = new GridEdgeRecorder()

        // Serialize grids //////////////////////////////////////////////////

        // Iterate hit grids in Editor Type
        if (this._currentType === this.EDITOR_TYPE) {
            this.hitGridList.forEach((grid, index) => {

                const { xMinPercent, yMinPercent, xMaxPercent, yMaxPercent } = grid.serialization
                grids.push({
                    id: index,
                    xMinPercent, yMinPercent,
                    xMaxPercent, yMaxPercent
                })
                const key = [ grid.level, grid.globalId ].join('-')
                levelGlobalId_serializedId_Map.set(key, index)

                // Avoid edge miss and record valid key
                grid.calcEdges(this.edgeRecorder)
                grid.edgeKeys.forEach(key => {
                    const edge = this.edgeRecorder.getEdgeByKey(key)
                    sEdgeRecoder.addEdge(edge)
                })
            })
        }
        // Iterate hit grids in Subdivider Type
        else {

            // Find neighbours for all grids
            this.gridRecorder.findNeighbours()
            
            let index = 0
            this.gridRecorder.storageId_grid_map.forEach(grid => {
                if (grid.hit) {

                    const { xMinPercent, yMinPercent, xMaxPercent, yMaxPercent } = grid.serialization
                    grids.push({
                        id: index,
                        xMinPercent, yMinPercent,
                        xMaxPercent, yMaxPercent
                    })

                    const key = [ grid.level, grid.globalId ].join('-')
                    levelGlobalId_serializedId_Map.set(key, index)
                    index++

                    // Avoid edge miss and record valid key
                    grid.calcEdges(this.edgeRecorder)
                    grid.edgeKeys.forEach(key => {
                        const edge = this.edgeRecorder.getEdgeByKey(key)
                        sEdgeRecoder.addEdge(edge)
                    })
                }
            })
        }

        // Serialize edges //////////////////////////////////////////////////

        let index = 0
        sEdgeRecoder.edges.forEach(edge => {

            const { adjGrids, minPercent, maxPercent, edgeCode } = edge.serialization
            const grid1 = adjGrids[0] !== 'null-null' ? levelGlobalId_serializedId_Map.get(adjGrids[0])! : null
            const grid2 = adjGrids[1] !== 'null-null' ? levelGlobalId_serializedId_Map.get(adjGrids[1])! : null

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
    
    _mousedownHandler(e: MapMouseEvent) {
        
        if (e.originalEvent.shiftKey && e.originalEvent.button === 0) {
            this.isShiftClick = true
            this.map!.dragPan.disable()
        }
    }

    _mouseupHandler(e: MapMouseEvent) {

        if (this.isShiftClick) {
            this.map!.dragPan.enable()
            this.isShiftClick = false

            const lngLat = this.map!.unproject([e.point.x, e.point.y])
            this.hit(lngLat.lng, lngLat.lat, this.uiOption.level)
        }
    }

    _mousemoveHandler(e: MapMouseEvent) {

        if (this.isShiftClick) {
            this.map!.dragPan.disable()

            const lngLat = this.map!.unproject([e.point.x, e.point.y])
            this.hit(lngLat.lng, lngLat.lat, this.uiOption.level)
        }
    }

    removeUIHandler() {
    
        this.map!
        .off('mouseup', this.mouseupHandler as any)
        .off('mousedown', this.mousedownHandler as any)
        .off('mousemove', this.mousemoveHandler as any)
    }

    addSubdividerUIHandler() {

        this.removeUIHandler()
    
        this.map!
        .on('mouseup', this.mouseupHandler as any)
        .on('mousedown', this.mousedownHandler as any)
        .on('mousemove', this.mousemoveHandler as any)
    }

    addEditorUIHandler() {

        this.removeUIHandler()
    
        this.map!
        .on('mouseup', this.mouseupHandler as any)
        .on('mousedown', this.mousedownHandler as any)
    }
    
    async init() {

        const gl = this._gl!

        enableAllExtensions(gl)

        // Create shader
        this.terrainMeshShader = await createShader(gl, '/shaders/gridMesh.glsl')
        this.terrainLineShader = await createShader(gl, '/shaders/gridLine.glsl')

        // Create texture
        this.paletteTexture = createTexture2D(gl, 1, this.subdivideRules.length, 1, gl.RGB8)
        this.levelTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.R16UI)
        this.fillIndexTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.R32UI)
        this.lineIndexTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.R32UI)
        this.storageTextureArray = createTexture2DArray(gl, 1, 4, this.storageTextureSize, this.storageTextureSize, gl.RG32F)

        // Init palette texture (default in subdivider type)
        const colorList = new Uint8Array(this.subdivideRules.length * 3)
        for (let i = 0; i < this.subdivideRules.length; i++) {
            colorList.set([ 0, 127, 127 ], i * 3)
        }
        fillSubTexture2DByArray(gl, this.paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, colorList)
        
        // Init root grid
        const rootGrid = this.gridRecorder.getGrid(0, 0)!
        this.writeGridInfoToTexture(rootGrid)

        for (let globalId = 0; globalId < this.gridRecorder.levelInfos[1].width * this.gridRecorder.levelInfos[1].height; globalId++) {
                
            // Initialization and hit
            this.hitSet.add({
                level: 1,
                globalId,
                hitOrNot: true
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
        this.map!.boxZoom.disable()

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

        // [5] Add event listner for <Shift + D> (Open removing grid mode)
        document.addEventListener('keydown', e => {

            if (e.shiftKey && e.key === 'D') {
                this.isDeleteMode = !this.isDeleteMode 
                console.log(`Delete Mode: ${ this.isDeleteMode ? 'ON' : 'OFF' }`)
            }
        })

        // All done ////////////////////////////////////////////////////////////

        this.isInitialized = true
    }
    
    drawGridMesh() {

        const gl = this._gl!

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LESS)

        gl.useProgram(this.terrainMeshShader)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.storageTextureArray)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.levelTexture)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, this.fillIndexTexture)
        gl.activeTexture(gl.TEXTURE3)
        gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture)

        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'storageTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'levelTexture'), 1)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'indexTexture'), 2)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'paletteTexture'), 3)
        gl.uniform2fv(gl.getUniformLocation(this.terrainMeshShader, 'centerLow'), this.map!.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this.terrainMeshShader, 'centerHigh'), this.map!.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainMeshShader, 'uMatrix'), false, this.map!.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.fillList.length)
    }

    drawGridLine() {

        const gl = this._gl!

        gl.disable(gl.BLEND)
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this.terrainLineShader)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.storageTextureArray)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.lineIndexTexture)

        gl.uniform1i(gl.getUniformLocation(this.terrainLineShader, 'storageTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this.terrainLineShader, 'indexTexture'), 1)
        gl.uniform2fv(gl.getUniformLocation(this.terrainLineShader, 'centerLow'), this.map!.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this.terrainLineShader, 'centerHigh'), this.map!.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainLineShader, 'uMatrix'), false, this.map!.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.LINE_LOOP, 0, 4, this.lineList.length)
    }

    onAdd(map: NHMap, gl: WebGL2RenderingContext) {

        this._gl = gl
        this.map = map
        this.init()
    }
    
    render(gl: WebGL2RenderingContext, _: number[]) {

        // Skip if not ready
        if (!this.isInitialized) return

        // Tick logic
        this.map!.update()
        this.hitGrids()

        // Tick render: Mesh Pass
        this.drawGridMesh()
        
        // Tick render: Line Pass
        this.drawGridLine()

        // WebGL check
        errorCheck(gl)
    }
    
    hit(x: number, y: number, level: number) {

        const maxLevel = this.subdivideRules.length - 1
        const [ lon, lat ] = proj4('EPSG:4326', this.srcCS, [ x, y ])

        // Subidivider type
        if (this._currentType === this.SUBDIVIDER_TYPE) {
            const hitLevel = level

            if (hitLevel === undefined || hitLevel > maxLevel) return 

            const { width, height } = this.gridRecorder.levelInfos[hitLevel]
            const normalizedX = (lon - this.bBox.xMin) / (this.bBox.xMax - this.bBox.xMin)
            const normalizedY = (lat - this.bBox.yMin) / (this.bBox.yMax - this.bBox.yMin)
    
            if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return
    
            const col = Math.floor(normalizedX * width)
            const row = Math.floor(normalizedY * height)
            const globalId = row * width + col

            if (this.isDeleteMode) {
                
                const grid = this.gridRecorder.getGrid(hitLevel, globalId)
                if (grid) {

                    const stack: GridNode[] = [ grid ]
                    while (stack.length) {
                        const _grid = stack.pop()!
                        const children = _grid.children.filter(child => child)

                        if (children.length) {
                            _grid.children = []
                            stack.push(_grid, ...children.filter(child => child !== null))
                        } else {
                            this.gridRecorder.removeGrid(_grid, this.writeGridInfoToTexture.bind(this))
                        }

                        stack.push()
                    }

                    this.tickSubdivider()

                    // Update display of capacity
                    this.uiOption.capacity = this.gridRecorder.storageId_grid_map.size
                    this.capacityController.updateDisplay()
                }

            } else {
    
                this.hitSet.add({
                    level: hitLevel,
                    hitOrNot: true,
                    globalId
                })
            }
        }
        // Editor type 
        else {
            this.hitSet.add({ lon, lat })
        }

        this.map!.triggerRepaint()
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function addButtonClickListener(button: HTMLButtonElement) {
    button.addEventListener('click', () => {

      const allButtons = document.querySelectorAll('button')
      allButtons.forEach(btn => btn.classList.remove('active'))
  
      button.classList.add('active')
    });
  }

function errorCheck(gl: WebGL2RenderingContext) {
    const error = gl.getError()
    if (error !== gl.NO_ERROR) {
        console.error('Error happened: ', getWebGLErrorMessage(gl, error))
    }
}

function enableAllExtensions(gl: WebGL2RenderingContext) {

    const extensions = gl.getSupportedExtensions()!
    extensions.forEach(ext => {
        gl.getExtension(ext)
        console.log('Enabled extensions: ', ext)
    })
}

async function createShader(gl: WebGL2RenderingContext, url: string) {

    let shaderCode = ''
    await axios.get(url)
    .then(response => shaderCode += response.data)
    const vertexShaderStage = compileShader(gl, shaderCode, gl.VERTEX_SHADER)!
    const fragmentShaderStage = compileShader(gl, shaderCode, gl.FRAGMENT_SHADER)!

    const shader = gl.createProgram()!
    gl.attachShader(shader, vertexShaderStage)
    gl.attachShader(shader, fragmentShaderStage)
    gl.linkProgram(shader)
    if (!gl.getProgramParameter(shader, gl.LINK_STATUS)) {

        console.error('An error occurred linking shader stages: ' + gl.getProgramInfoLog(shader))
    }

    return shader

    function compileShader(gl: WebGL2RenderingContext, source: string, type: number) {
    
        const versionDefinition = '#version 300 es\n'
        const module = gl.createShader(type)!
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

function createFrameBuffer(gl: WebGL2RenderingContext, textures: WebGLTexture[], depthTexture: WebGLTexture, renderBuffer: WebGLRenderbuffer) {

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

function createTexture2D(gl: WebGL2RenderingContext, level: number, width: number, height: number, internalFormat: number, format?: number, type?: number, resource?: ArrayBufferView, generateMips = false): WebGLTexture {
    
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, generateMips ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    resource ? 
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, 0, format!, type!, resource)
    : 
    gl.texStorage2D(gl.TEXTURE_2D, level, internalFormat, width, height) 

    gl.bindTexture(gl.TEXTURE_2D, null)

    return texture
}

function createTexture2DArray(gl: WebGL2RenderingContext, level: number, layers: number, width: number, height: number, internalFormat: number): WebGLTexture {
    
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, level, internalFormat, width, height, layers)

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    return texture
}

function fillSubTexture2DByArray(gl: WebGL2RenderingContext, texture: WebGLTexture, level: number, xOffset: number, yOffset: number, width: number, height: number, format: number, type: number, array: ArrayBufferView): void {
    
    // Bind the texture
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Upload texture data
    gl.texSubImage2D(gl.TEXTURE_2D, level, xOffset, yOffset, width, height, format, type, array)

    // Unbind the texture
    gl.bindTexture(gl.TEXTURE_2D, null);
}

function fillSubTexture2DArrayByArray(gl: WebGL2RenderingContext, texture: WebGLTexture, level: number, xOffset: number, yOffset: number, zOffset: number, width: number, height: number, depth: number, format: number, type: number, array: ArrayBufferView): void {
    
    // Bind the texture
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)

    // Upload texture data
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, xOffset, yOffset, zOffset, width, height, depth, format, type, array, 0)

    // Unbind the texture
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
}

function fillTexture2DByArray(gl: WebGL2RenderingContext, texture: WebGLTexture, width: number, height: number, internalFormat: number, format: number, type: number, array: ArrayBufferView): void {
    
    // Bind the texture
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Upload texture data
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, array)

    // Unbind the texture
    gl.bindTexture(gl.TEXTURE_2D, null);
}

function createRenderBuffer(gl: WebGL2RenderingContext, width: number, height: number): WebGLRenderbuffer {

    const bufferWidth = width || gl.canvas.width * window.devicePixelRatio
    const bufferHeight = height || gl.canvas.height * window.devicePixelRatio

    const renderBuffer = gl.createRenderbuffer()!
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderBuffer)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, bufferWidth, bufferHeight)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)

    return renderBuffer
}

// Helper function to get WebGL error messages
function getWebGLErrorMessage(gl: WebGL2RenderingContext, error: number) {
    switch (error) {
        case gl.NO_ERROR:
            return 'NO_ERROR'
        case gl.INVALID_ENUM:
            return 'INVALID_ENUM'
        case gl.INVALID_VALUE:
            return 'INVALID_VALUE'
        case gl.INVALID_OPERATION:
            return 'INVALID_OPERATION'
        case gl.OUT_OF_MEMORY:
            return 'OUT_OF_MEMORY'
        case gl.CONTEXT_LOST_WEBGL:
            return 'CONTEXT_LOST_WEBGL'
        default:
            return 'UNKNOWN_ERROR'
    }
}

async function loadImage(url: string) {
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

function getMaxMipLevel(width: number, height: number) {
    return Math.floor(Math.log2(Math.max(width, height)));
}

async function loadF32Image(url: string) {

    const response = await axios.get(url, {responseType: "blob"})
    const bitmap = await createImageBitmap(response.data, {imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "default"})
    
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const gl = canvas.getContext("webgl2")!
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

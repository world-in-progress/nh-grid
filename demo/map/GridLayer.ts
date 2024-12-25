import axios from 'axios'
import proj4 from 'proj4'
import { mat4 } from 'gl-matrix'
import { MapMouseEvent } from 'mapbox-gl'
import { GUI, GUIController } from 'dat.gui'

import gll from './GlLib'
import NHMap from './NHMap'
import BoundingBox2D from '../../src/core/util/boundingBox2D'
import { GridNodeRecorder } from '../../src/core/grid/NHGridRecorder'
import VibrantColorGenerator from '../../src/core/util/vibrantColorGenerator'

proj4.defs("ESRI:102140", "+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +units=m +no_defs +type=crs")

export interface GridLayerOptions {

    maxGridNum?: number
    edgeProperties?: string[]
}

export default class GridLayer {

    // Layer-related //////////////////////////////////////////////////

    type = 'custom'
    id = 'GridLayer'
    renderingMode = '3d'
    isInitialized = false

    // Function-related //////////////////////////////////////////////////

    // Grid properties
    maxGridNum: number
    bBox: BoundingBox2D
    hitSet = new Set<string>
    projConverter: proj4.Converter
    gridRecorder: GridNodeRecorder
    subdivideRules: [ number, number ][]
    subdivideStacks = new Array<[ level: number, globalId: number ][]>()

    // GPU-related //////////////////////////////////////////////////

    storageTextureSize: number
    paletteColorList: Uint8Array

    private _gl: WebGL2RenderingContext

    // Shader
    private _pickingShader: WebGLProgram = 0
    private _terrainMeshShader: WebGLProgram = 0
    private _terrainLineShader: WebGLProgram = 0

    // Texture resource
    private _levelTexture: WebGLTexture = 0
    private _paletteTexture: WebGLTexture = 0
    private _storageTextureArray: WebGLTexture = 0

    // Picking pass resource
    private _pickingFBO: WebGLFramebuffer = 0
    private _pickingTexture: WebGLTexture = 0
    private _pickingRBO: WebGLRenderbuffer = 0

    // GPU grid update function
    updateGPUGrid: Function
    updateGPUGrids: Function

    // Interaction-related //////////////////////////////////////////////////
    
    // Interaction mode
    typeChanged = false
    EDITOR_TYPE = 0b01
    SUBDIVIDER_TYPE = 0b11
    private _currentType = 0b11

    isShiftClick = false
    isDeleteMode = false
    isTransparent = false

    mouseupHandler: Function
    mousedownHandler: Function
    mousemoveHandler: Function
    
    // Dat.GUI
    gui: GUI
    capacityController: GUIController
    uiOption: { capacity: number, level: number }

    constructor(
        public  map:                NHMap,
        public  srcCS:              string,
        public  firstLevelSize:     [ number, number ],
                subdivideRules:     [ number, number ][],
                boundaryCondition:  [ number, number, number, number ],
                options:            GridLayerOptions = {}
    ) {

        // Set basic members
        this.projConverter = proj4(this.srcCS, 'EPSG:4326')
        this.maxGridNum = options.maxGridNum || 4096 * 4096

        // Resize boundary condition by the first level size
        boundaryCondition[2] = boundaryCondition[0] + Math.ceil((boundaryCondition[2] - boundaryCondition[0]) / this.firstLevelSize[0]) * this.firstLevelSize[0] 
        boundaryCondition[3] = boundaryCondition[1] + Math.ceil((boundaryCondition[3] - boundaryCondition[1]) / this.firstLevelSize[1]) * this.firstLevelSize[1]
        this.bBox = new BoundingBox2D(...boundaryCondition)

        // Set first level rule of subdivide rules by new boundary condition
        this.subdivideRules = [[  
            (boundaryCondition[2] - boundaryCondition[0]) / this.firstLevelSize[0],
            (boundaryCondition[3] - boundaryCondition[1]) / this.firstLevelSize[1],
        ]]
        // Add other level rules to subdivide rules
        this.subdivideRules.push(...subdivideRules)

        // Create core recorders
        this.gridRecorder = new GridNodeRecorder({
            bBox: this.bBox,
            srcCS: this.srcCS,
            targetCS: 'EPSG:4326',
            rules: this.subdivideRules
        }, 
        this.maxGridNum,
        {  
            workerCount: 4,
            operationCapacity: 1000,
        })

        // Set WebGL2 context
        this._gl = this.map.painter.context.gl

        // Set storage texture memory
        this.storageTextureSize = Math.ceil(Math.sqrt(this.maxGridNum))

        // Make palette color list
        const colorGenerator = new VibrantColorGenerator()
        this.paletteColorList = new Uint8Array(this.subdivideRules.length * 3)
        for (let i = 0; i < this.subdivideRules.length; i++) {
            const color = colorGenerator.nextColor().map(channel => channel * 255.0)
            this.paletteColorList.set(color, i * 3)
        }

        // Bind callbacks and event handlers
        this.updateGPUGrid = this._updateGPUGrid.bind(this)
        this.updateGPUGrids = this._updateGPUGrids.bind(this)
        this.mouseupHandler = this._mouseupHandler.bind(this)
        this.mousedownHandler = this._mousedownHandler.bind(this)
        this.mousemoveHandler = this._mousemoveHandler.bind(this)

        // Init interaction option
        this.uiOption = {
            level: 2,
            capacity: 0.0,
        }

        // Launch Dat.GUI
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

        const gl = this._gl

        if (type === this._currentType) return

        this.typeChanged = true
        this._currentType = type

        if (type === this.EDITOR_TYPE) {

            // // Change event handlers
            // this.addEditorUIHandler()

            // // Find neighbours for all grids
            // // this.gridRecorder.findNeighbours()

            // // Generate hit list
            // this.gridRecorder.uuId_gridNode_map.forEach(grid => {
            //     if (grid.hit === true && grid.level !== 0) {
            //         this.hitGridList.push(grid)
            //         grid.hit = false
            //     }
            // })

            // // Set show list (it is static when in Editor type)
            // this.lineList = this.hitGridList.map(grid => this.gridRecorder.uuId_storageId_map.get(grid.uuId)!)

            // // Refill palette texture
            // gll.fillSubTexture2DByArray(gl, this._paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, this.paletteColorList)

        } else {

            // Change event handlers
            this.addSubdividerUIHandler()

            // Release cache
            // this.hitGridList.forEach(grid => grid.hit = true)
            // this.hitGridList = []

            // Refill palette texture
            const colorList = new Uint8Array(this.subdivideRules.length * 3)
            for (let i = 0; i < this.subdivideRules.length; i++) {
                colorList.set([ 0, 127, 127 ], i * 3)
            }
            gll.fillSubTexture2DByArray(gl, this._paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, colorList)
        }

        this.map.triggerRepaint()
    }
    
    hitEditor(lon: number, lat: number) {

        // this.hitGridList.forEach(grid => {
        //     if (grid.within(this.bBox, lon, lat)) {
        //         grid.hit = true
        //         // this.edgeRecorder.calcGridEdges(grid, this.gridRecorder)
        //         console.log(grid.edges)
        //     }
        // })
    }
    
    // Fast function to upload one grid rendering info to GPU stograge texture
    writeGridInfoToTexture(info: [ storageId: number, level: number, vertices: Float32Array ]) {

        const gl = this._gl
        const [ storageId, level, vertices ] = info
        const storageU = storageId % this.storageTextureSize
        const storageV = Math.floor(storageId / this.storageTextureSize)

        gll.fillSubTexture2DArrayByArray(gl, this._storageTextureArray, 0, storageU, storageV, 0, 1, 1, 4, gl.RG, gl.FLOAT, vertices)
        gll.fillSubTexture2DByArray(gl, this._levelTexture, 0, storageU, storageV, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array([level]))
    }

    // Optimized function to upload multiple grid rendering info to GPU storage texture
    // Note: grids must have continuous storageIds between 'fromStorageId' and 'toStogrageId'
    writeMultiGridInfoToTexture(infos: [ fromStorageId: number, toStorageId: number, levels: Uint16Array, vertices: Float32Array ]) {

        const gl = this._gl
        const [ fromStorageId, toStorageId, levels, vertices ] = infos

        const fromStorageU = fromStorageId % this.storageTextureSize
        const fromStorageV = Math.floor(fromStorageId / this.storageTextureSize)

        const toStorageU = toStorageId % this.storageTextureSize
        const toStorageV = Math.floor(toStorageId / this.storageTextureSize)

        const updateBlockHeight = toStorageV - fromStorageV + 1

        // FromStorageId and ToStorageId are on the same row of the storage texture
        if (updateBlockHeight === 1) {

            const updateBlockWidth = toStorageU - fromStorageU + 1
            gll.fillSubTexture2DArrayByArray(gl, this._storageTextureArray, 0, fromStorageU, fromStorageV, 0, updateBlockWidth, updateBlockHeight, 4, gl.RG, gl.FLOAT, vertices)
            gll.fillSubTexture2DByArray(gl, this._levelTexture, 0, fromStorageU, fromStorageV, updateBlockWidth, updateBlockHeight, gl.RED_INTEGER, gl.UNSIGNED_SHORT, levels)

        } else {

            const gridCount = vertices.length / 8
            const fullBlockRows = Math.max(updateBlockHeight - 2, 0)

            // Pre-allocate memory for a Float32Array that can satisfy all three updated situations
            const size_within_fromStorageU_textureSize = this.storageTextureSize - fromStorageU
            const size_within_fromStorageV_toStorageV = this.storageTextureSize * fullBlockRows
            const size_within_0_toStorageU = toStorageU + 1

            // Use the maximum size to allocate this memory
            const subBlockSize = Math.max(size_within_0_toStorageU, Math.max(size_within_fromStorageU_textureSize, size_within_fromStorageV_toStorageV))
            const subVertices = new Float32Array(subBlockSize * 8)

            // Update grid info for situation 1 //////////////////////////////////////////////////
            let srcOffset = 0
            let updateBlockWidth = this.storageTextureSize - fromStorageU
            let elementSize = updateBlockWidth * 2
            for (let i = 0; i < 4; i++) {
                const offset = (gridCount * i + srcOffset) * 2
                subVertices.set(vertices.subarray(offset, offset + elementSize), i * elementSize)
            }
            gll.fillSubTexture2DArrayByArray(gl, this._storageTextureArray, 0, fromStorageU, fromStorageV, 0, updateBlockWidth, 1, 4, gl.RG, gl.FLOAT, subVertices)
            gll.fillSubTexture2DByArray(gl, this._levelTexture, 0, fromStorageU, fromStorageV, updateBlockWidth, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, levels, srcOffset)

            // Update grid info for situation 2 //////////////////////////////////////////////////
            srcOffset += updateBlockWidth
            if (fullBlockRows > 0) {

                updateBlockWidth = this.storageTextureSize
                elementSize = updateBlockWidth * fullBlockRows * 2
                for (let i = 0; i < 4; i++) {
                    const offset = (gridCount * i + srcOffset) * 2
                    subVertices.set(vertices.subarray(offset, offset + elementSize), i * elementSize)
                }
                gll.fillSubTexture2DArrayByArray(gl, this._storageTextureArray, 0, 0, fromStorageV + 1, 0, updateBlockWidth, fullBlockRows, 4, gl.RG, gl.FLOAT, subVertices)
                gll.fillSubTexture2DByArray(gl, this._levelTexture, 0, 0, fromStorageV + 1, updateBlockWidth, fullBlockRows, gl.RED_INTEGER, gl.UNSIGNED_SHORT, levels, srcOffset)
            }

            // Update grid info for situation 3 //////////////////////////////////////////////////
            srcOffset += updateBlockWidth * fullBlockRows
            updateBlockWidth = toStorageU + 1
            elementSize = updateBlockWidth * 2
            for (let i = 0; i < 4; i++) {
                const offset = (gridCount * i + srcOffset) * 2
                subVertices.set(vertices.subarray(offset, offset + elementSize), i * elementSize)
            }
            gll.fillSubTexture2DArrayByArray(gl, this._storageTextureArray, 0, 0, toStorageV, 0, updateBlockWidth, 1, 4, gl.RG, gl.FLOAT, subVertices)
            gll.fillSubTexture2DByArray(gl, this._levelTexture, 0, 0, toStorageV, updateBlockWidth, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, levels, srcOffset)
        }
    }
    
    async init() {

        // Init DOM Elements and handlers ////////////////////////////////////////////////////////////

        // [1] Remove Event handler for map boxZoom
        this.map.boxZoom.disable()

        // [2] Subdivider Type Button
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

        // [3] Editor Type Button
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

        // [4] Add event listner for <Shift + D> (Open removing grid mode)
        document.addEventListener('keydown', e => {

            if (e.shiftKey && e.key === 'D') {
                this.isDeleteMode = !this.isDeleteMode 
                console.log(`Delete Mode: ${ this.isDeleteMode ? 'ON' : 'OFF' }`)
            }
        })

        // [5] Add event listner for <Shift + T> (Set grid transparent or not)
        document.addEventListener('keydown', e => {

            if (e.shiftKey && e.key === 'T') {
                this.isTransparent = !this.isTransparent 
                console.log(`Grid Transparent: ${ this.isTransparent ? 'ON' : 'OFF' }`)
                this.map.triggerRepaint()
            }
        })

        // Init GPU resources ////////////////////////////////////////////////////////////

        const gl = this._gl

        gll.enableAllExtensions(gl)

        // Create shader
        this._pickingShader = await gll.createShader(gl, '/shaders/picking.glsl')
        this._terrainLineShader = await gll.createShader(gl, '/shaders/gridLine.glsl')
        this._terrainMeshShader = await gll.createShader(gl, '/shaders/gridMesh.glsl')

        // Set static uniform in shaders
        gl.useProgram(this._terrainLineShader)
        gl.uniform1i(gl.getUniformLocation(this._terrainLineShader, 'storageTexture'), 0)

        gl.useProgram(this._terrainMeshShader)
        gl.uniform1i(gl.getUniformLocation(this._terrainMeshShader, 'storageTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this._terrainMeshShader, 'levelTexture'), 1)
        gl.uniform1i(gl.getUniformLocation(this._terrainMeshShader, 'paletteTexture'), 2)

        gl.useProgram(this._pickingShader)
        gl.uniform1i(gl.getUniformLocation(this._pickingShader, 'storageTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this._pickingShader, 'paletteTexture'), 1)

        gl.useProgram(null)

        // Create texture
        this._paletteTexture = gll.createTexture2D(gl, 1, this.subdivideRules.length, 1, gl.RGB8)
        this._levelTexture = gll.createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.R16UI)
        this._storageTextureArray = gll.createTexture2DArray(gl, 1, 4, this.storageTextureSize, this.storageTextureSize, gl.RG32F)

        // Create picking pass
        this._pickingTexture = gll.createTexture2D(gl, 0, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([ 0, 0, 0, 0 ]))
        this._pickingRBO = gll.createRenderBuffer(gl, 1, 1)
        this._pickingFBO = gll.createFrameBuffer(gl, [ this._pickingTexture ], 0, this._pickingRBO)

        // Init palette texture (default in subdivider type)
        const colorList = new Uint8Array(this.subdivideRules.length * 3)
        for (let i = 0; i < this.subdivideRules.length; i++) {
            colorList.set([ 0, 127, 127 ], i * 3)
        }
        gll.fillSubTexture2DByArray(gl, this._paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, this.paletteColorList)
        
        // Init workers of gridRecorder ////////////////////////////////////////////////////////////

        this.gridRecorder.init(() => {

            this.gridRecorder.subdivideGrid(0, 0, (infos: any) => {
                this.updateGPUGrids(infos)

                // Raise flag when the root grid (level: 0, globalId: 0) has been subdivided
                this.isInitialized = true
            })
        })
    }

    removeUIHandler() {
    
        this.map
        .off('mouseup', this.mouseupHandler as any)
        .off('mousedown', this.mousedownHandler as any)
        .off('mousemove', this.mousemoveHandler as any)
    }

    addSubdividerUIHandler() {

        this.removeUIHandler()
    
        this.map
        .on('mouseup', this.mouseupHandler as any)
        .on('mousedown', this.mousedownHandler as any)
        .on('mousemove', this.mousemoveHandler as any)
    }

    addEditorUIHandler() {

        this.removeUIHandler()
    
        this.map
        .on('mouseup', this.mouseupHandler as any)
        .on('mousedown', this.mousedownHandler as any)
    }

    hit(storageId: number, coordinates: [ number, number ]) {

        // Delete mode
        if (this.isDeleteMode) {

            this.gridRecorder.removeGrid(storageId, this.updateGPUGrid)
        }
        // Subdivider type
        else if (this._currentType === this.SUBDIVIDER_TYPE) {

            const maxLevel = this.subdivideRules.length - 1
            const [ hitLevel ] = this.gridRecorder.getGridInfoByStorageId(storageId)
    
            // Nothing will happen if the hit grid has the maximize level
            if (hitLevel === maxLevel) return
    
            const targetLevel = Math.min(this.uiOption.level, maxLevel)

            // Nothing will happen if subdivide grids more than one level
            // Or target subdivided level equals to hitLevel
            if (targetLevel - hitLevel > 1 || targetLevel == hitLevel) return

            const [ lon, lat ] = this.projConverter.inverse(coordinates)
            const { width, height } = this.gridRecorder.levelInfos[targetLevel]
            const normalizedX = (lon - this.bBox.xMin) / (this.bBox.xMax - this.bBox.xMin)
            const normalizedY = (lat - this.bBox.yMin) / (this.bBox.yMax - this.bBox.yMin)
    
            // Nothing will happen if mouse is out of boundary condition
            if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return

            // Calculate globalId of the target grid
            const col = Math.floor(normalizedX * (width - 1))
            const row = Math.floor(normalizedY * (height - 1))
            const globalId = row * width + col

            this.hitSet.add([ 
                hitLevel,       // FromLevel
                storageId,      // FromStorageId
                targetLevel,    // ToLevel
                globalId,       // ToGlobalId
            ].join('-'))
        }

        this.map.triggerRepaint()
    }

    removeGrid(storageId: number) {
        this.gridRecorder.removeGrid(storageId, this.updateGPUGrid)
        this.map.triggerRepaint()
    }

    subdivideGrid(info: string) {
        const [ level, globalId ] = decodeInfo(info)
        this.gridRecorder.subdivideGrid(level, globalId, this.updateGPUGrids)
    }

    tickGrids() {

        if (this._currentType === this.SUBDIVIDER_TYPE) {

            // Parse hitSet
            this.hitSet.forEach(hitActionInfo => {
                const [ fromLevel, fromStorageId, toLevel, toGlobalId ] = decodeInfo(hitActionInfo)
                const removableGlobalId = this.gridRecorder.getGridInfoByStorageId(fromStorageId)[1]

                // Check if valid
                let parentGlobalId = this.gridRecorder.getParentGlobalId(toLevel, toGlobalId)
                for (let parentLevel = toLevel - 1; parentLevel >= fromLevel; parentLevel--) {
                    if (parentLevel === fromLevel && removableGlobalId !== parentGlobalId) return
                    parentGlobalId = this.gridRecorder.getParentGlobalId(parentLevel, parentGlobalId)
                }

                // Remove grids
                this.removeGrid(fromStorageId)

                // Parse info about subdividable grid
                const subdivideStack: Array<string> = []
                parentGlobalId = this.gridRecorder.getParentGlobalId(toLevel, toGlobalId)
                for (let parentLevel = toLevel - 1; parentLevel >= fromLevel; parentLevel--) {
                    subdivideStack.push([ parentLevel, parentGlobalId ].join('-'))
                    parentGlobalId = this.gridRecorder.getParentGlobalId(parentLevel, parentGlobalId)
                }

                // Subdivide grids
                while(subdivideStack.length) {
                    const subdivideTask = subdivideStack.pop()!
                    this.subdivideGrid(subdivideTask)
                }
            })

        } else {

            // (this.hitSet as Set<{ lon: number, lat: number }>).forEach(({ lon, lat }) => {
            //     this.hitEditor(lon, lat)
            // })
            
            // this.tickEditor()
        }

        this.hitSet.clear()
        this.typeChanged = false
    }

    async onAdd(_: NHMap, gl: WebGL2RenderingContext) {

        this._gl = gl
        await this.init()
    }
    
    render(gl: WebGL2RenderingContext, _: number[]) {

        // Skip if not ready
        if (!this.isInitialized || !this.gridRecorder.isReady) return

        // Tick logic
        this.map.update()
        this.tickGrids()

        // Tick render: Mesh Pass
        ;(!this.isTransparent) && this.drawGridMesh()
        
        // Tick render: Line Pass
        this.drawGridLine()

        // WebGL check
        gll.errorCheck(gl)

        // Update display of capacity
        this.uiOption.capacity = this.gridRecorder.nextStorageId
        this.capacityController.updateDisplay()
    }

    /**
     * @param pickingMatrix 
     * @returns { number } StorageId of the picked grid
     */
    picking(pickingMatrix: mat4): number {

        const gl = this._gl

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickingFBO)
        gl.viewport(0, 0, 1, 1)

        gl.clearColor(1.0, 1.0, 1.0, 1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.disable(gl.BLEND)

        gl.depthFunc(gl.LESS)
        gl.enable(gl.DEPTH_TEST)

        gl.useProgram(this._pickingShader)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._storageTextureArray)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this._paletteTexture)

        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'pickingMatrix'), false, pickingMatrix)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.gridRecorder.nextStorageId)

        gl.flush()

        const pixel = new Uint8Array(4)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)

        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
 
        // Return storageId of the picked grid
        return pixel[0] + (pixel[1] << 8) + (pixel[2] << 16) + (pixel[3] << 24)
    }
    
    drawGridMesh() {

        const gl = this._gl

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LESS)

        gl.useProgram(this._terrainMeshShader)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._storageTextureArray)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this._levelTexture)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, this._paletteTexture)

        gl.uniform2fv(gl.getUniformLocation(this._terrainMeshShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this._terrainMeshShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._terrainMeshShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.gridRecorder.nextStorageId)
    }

    drawGridLine() {

        const gl = this._gl

        gl.disable(gl.BLEND)
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this._terrainLineShader)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._storageTextureArray)

        gl.uniform2fv(gl.getUniformLocation(this._terrainLineShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this._terrainLineShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._terrainLineShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.LINE_LOOP, 0, 4, this.gridRecorder.nextStorageId)
    }

    private _updateGPUGrid(info?: [ storageId: number, level: number, vertices: Float32Array ]) {

        if (info) {
            this.writeGridInfoToTexture(info)
            this._gl.flush()
        }
        this.map.triggerRepaint()
    }

    private _updateGPUGrids(infos?: [ fromStorageId: number, toStorageId: number, levels: Uint16Array, vertices: Float32Array ]) {

        if (infos) {
            this.writeMultiGridInfoToTexture(infos)
            this._gl.flush()
        }
        this.map.triggerRepaint()
    }

    private _calcPickingMatrix(e: MapMouseEvent) {

        const canvas = this._gl.canvas
        const offsetX = e.originalEvent.clientX
        const offsetY = e.originalEvent.clientY

        const pixelRatio = window.devicePixelRatio || 1
        const canvasWidth = canvas.width
        const canvasHeight = canvas.height

        const ndcX = (offsetX * pixelRatio + 0.5) / canvasWidth * 2.0 - 1.0
        const ndcY = 1.0 - (offsetY * pixelRatio + 0.5) / canvasHeight * 2.0

        const pickingMatrix = mat4.create()
        mat4.scale(pickingMatrix, pickingMatrix, [ canvasWidth * 0.5, canvasHeight * 0.5, 1.0 ])
        mat4.translate(pickingMatrix, pickingMatrix, [ -ndcX, -ndcY, 0.0 ])

        return pickingMatrix
    }
    
    private _mousedownHandler(e: MapMouseEvent) {
        
        if (e.originalEvent.shiftKey && e.originalEvent.button === 0) {
            this.isShiftClick = true
            this.map.dragPan.disable()
        }
    }

    private _mouseupHandler(e: MapMouseEvent) {

        if (this.isShiftClick) {
            this.map.dragPan.enable()
            this.isShiftClick = false

            const storageId = this.picking(this._calcPickingMatrix(e))
            storageId >= 0 && this.hit(storageId, e.lngLat.toArray())

            // GPU Picking Vs CPU Picking
            if (0) {
                // let start = 0, end = 0

                // // GPU Picking
                // start = Date.now()
                // let uuid: string | null = this.picking(this._calcPickingMatrix(e))
                // if (uuid) {
                //     const [ level, globalId ] = uuid.split('-').map(key => Number(key))
                //     console.log(level, globalId)
                //     end = Date.now()
                //     console.log(`GPU Picking: ${end - start} ms`)
                // }

                // // CPU Picking
                // uuid = ''
                // start = Date.now()
                // const [ lon, lat ] = this.projConverter.inverse(e.lngLat.toArray())
                // this.gridRecorder.storageId_uuId_map.values()
                // .filter(uuId => node.hit && node.within(this.bBox, lon, lat)).forEach(node => uuid = node.uuId)
                // if (uuid !== '') {
                //     const [ level, globalId ] = uuid.split('-').map(key => Number(key))
                //     console.log(level, globalId)
                //     end = Date.now()
                //     console.log(`CPU Picking: ${end - start} ms`)
                // }
            }
        }
    }

    private _mousemoveHandler(e: MapMouseEvent) {

        if (this.isShiftClick) {
            this.map.dragPan.disable()

            const storageId = this.picking(this._calcPickingMatrix(e))
            storageId >= 0 && this.hit(storageId, e.lngLat.toArray())
        }
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function addButtonClickListener(button: HTMLButtonElement) {
    button.addEventListener('click', () => {

      const allButtons = document.querySelectorAll('button')
      allButtons.forEach(btn => btn.classList.remove('active'))
  
      button.classList.add('active')
    })
}

function decodeInfo(infoKey: string): Array<number> {

    return infoKey.split('-').map(key => +key)
}

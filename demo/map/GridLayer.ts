import proj4 from 'proj4'
import { mat4 } from 'gl-matrix'
import { MapMouseEvent } from 'mapbox-gl'
import { GUI, GUIController } from 'dat.gui'

import "../pannel.css"
import gll from './GlLib'
import NHMap from './NHMap'
import BoundingBox2D from '../../src/core/util/boundingBox2D'
import GridRecorder from '../../src/core/grid/NHGridRecorder'
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
    gridRecorder: GridRecorder
    subdivideRules: [ number, number ][]
    subdivideStacks = new Array<[ level: number, globalId: number ][]>()

    // GPU-related //////////////////////////////////////////////////

    storageTextureSize: number
    paletteColorList: Uint8Array

    private _gl: WebGL2RenderingContext

    // Shader
    private _edgeShader: WebGLProgram = 0
    private _pickingShader: WebGLProgram = 0
    private _gridMeshShader: WebGLProgram = 0
    private _gridLineShader: WebGLProgram = 0

    // Texture resource
    private _levelTexture: WebGLTexture = 0
    private _paletteTexture: WebGLTexture = 0
    private _storageTextureArray: WebGLTexture = 0

    private _gridTlStorageBuffer: WebGLBuffer = 0
    private _gridTrStorageBuffer: WebGLBuffer = 0
    private _gridBlStorageBuffer: WebGLBuffer = 0
    private _gridBrStorageBuffer: WebGLBuffer = 0
    private _gridLevelStorageBuffer: WebGLBuffer = 0
    private _gridStorageVAO: WebGLVertexArrayObject = 0

    private _edgeStorageBuffer: WebGLBuffer = 0
    private _edgeStorageVAO: WebGLVertexArrayObject = 0

    // Picking pass resource
    private _pickingFBO: WebGLFramebuffer = 0
    private _pickingTexture: WebGLTexture = 0
    private _pickingRBO: WebGLRenderbuffer = 0

    ////// ADDON
    // Box Picking pass resource
    private _boxPickingFBO: WebGLFramebuffer = 0
    private _boxPickingTexture: WebGLTexture = 0
    private _boxPickingRBO: WebGLRenderbuffer = 0

    private _boxPickingStart: MapMouseEvent | null = null
    private _boxPickingEnd: MapMouseEvent | null = null

    private ctx: CanvasRenderingContext2D | null = null


    // GPU grid update function
    updateGPUGrid: Function
    updateGPUGrids: Function
    updateGPUEdges: (fromStorageId: number, vertexBuffer: Float32Array) => void

    // Interaction-related //////////////////////////////////////////////////

    // Interaction mode
    private _EditorState: Record<string, string> = {
        editor: 'none',   // 'none' | 'topology' | 'attribute'
        tool: 'none',     // 'none' | 'brush' | 'box'
        mode: 'none'      // 'none' | 'subdivide' | 'delete'
    }
    EditorState: Record<string, string> = {}

    typeChanged = false
    isShiftClick = false
    isTransparent = false

    resizeHandler: Function
    mouseupHandler: Function
    mouseoutHandler: Function
    mousedownHandler: Function
    mousemoveHandler: Function

    // Dat.GUI
    gui: GUI
    capacityController: GUIController
    uiOption: { capacity: number, level: number }

    constructor(
        public map: NHMap,
        public srcCS: string,
        public firstLevelSize: [number, number],
        subdivideRules: [number, number][],
        boundaryCondition: [number, number, number, number],
        options: GridLayerOptions = {}
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
        this.gridRecorder = new GridRecorder({
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
        this.updateGPUEdges = this._updateGPUEdges.bind(this)

        this.resizeHandler = this._resizeHandler.bind(this)
        this.mouseupHandler = this._mouseupHandler.bind(this)
        this.mouseoutHandler = this._mouseoutHandler.bind(this)
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
        this.gui.add(this.uiOption, 'capacity', 0, this.maxGridNum).name('Capacity').listen()

        this.capacityController = this.gui.__controllers[0]
        this.capacityController.setValue(0.0)
        this.capacityController.domElement.style.pointerEvents = 'none'
    }

    // set currentType(type: number) {

    //     const gl = this._gl

    //     if (type === this._currentType) return

    //     this.typeChanged = true
    //     this._currentType = type

    //     if (type === this.EDITOR_TYPE) {

    //         // // Change event handlers
    //         // this.addEditorUIHandler()

    //         // // Find neighbours for all grids
    //         // // this.gridRecorder.findNeighbours()

    //         // // Generate hit list
    //         // this.gridRecorder.uuId_gridNode_map.forEach(grid => {
    //         //     if (grid.hit === true && grid.level !== 0) {
    //         //         this.hitGridList.push(grid)
    //         //         grid.hit = false
    //         //     }
    //         // })

    //         // // Set show list (it is static when in Editor type)
    //         // this.lineList = this.hitGridList.map(grid => this.gridRecorder.uuId_storageId_map.get(grid.uuId)!)

    //         // // Refill palette texture
    //         // gll.fillSubTexture2DByArray(gl, this._paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, this.paletteColorList)

    //     } else {

    //         // Change event handlers
    //         this.addSubdividerUIHandler()

    //         // Release cache
    //         // this.hitGridList.forEach(grid => grid.hit = true)
    //         // this.hitGridList = []

    //         // Refill palette texture
    //         const colorList = new Uint8Array(this.subdivideRules.length * 3)
    //         for (let i = 0; i < this.subdivideRules.length; i++) {
    //             colorList.set([0, 127, 127], i * 3)
    //         }
    //         gll.fillSubTexture2DByArray(gl, this._paletteTexture, 0, 0, 0, this.subdivideRules.length, 1, gl.RGB, gl.UNSIGNED_BYTE, colorList)
    //     }

    //     this.map.triggerRepaint()
    // }

    hitAttributeEditor(lon: number, lat: number) {

        // this.hitGridList.forEach(grid => {
        //     if (grid.within(this.bBox, lon, lat)) {
        //         grid.hit = true
        //         // this.edgeRecorder.calcGridEdges(grid, this.gridRecorder)
        //         console.log(grid.edges)
        //     }
        // })
    }

    // Fast function to upload one grid rendering info to GPU stograge buffer
    writeGridInfoToStorageBuffer(info: [ storageId: number, level: number, vertices: Float32Array ]) {

        const gl = this._gl
        const levelByteStride = 1 * 2
        const vertexByteStride = 2 * 4
        const [ storageId, level, vertices ] = info

        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridTlStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, vertices, 0, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridTrStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, vertices, 2, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridBlStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, vertices, 4, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridBrStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, vertices, 6, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridLevelStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * levelByteStride, new Uint16Array([level]), 0, 1)

        gl.bindBuffer(gl.ARRAY_BUFFER, null)
    }

    // Optimized function to upload multiple grid rendering info to GPU storage buffer
    // Note: grids must have continuous storageIds from 'storageid' to 'toStorageId'
    writeMultiGridInfoToStorageBuffer(infos: [ fromStorageId: number, toStorageId: number, levels: Uint16Array, vertices: Float32Array ]) {
        
        const gl = this._gl
        const [ fromStorageId, _, levels, vertices ] = infos
        const levelByteStride = 1 * 2
        const vertexByteStride = 2 * 4
        const gridCount = vertices.length / 8
        const lengthPerAttribute = 2 * gridCount

        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridTlStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertices, lengthPerAttribute * 0, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridTrStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertices, lengthPerAttribute * 1, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridBlStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertices, lengthPerAttribute * 2, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridBrStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertices, lengthPerAttribute * 3, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridLevelStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * levelByteStride, levels)

        gl.bindBuffer(gl.ARRAY_BUFFER, null)
    }
    
    async init() {

        // Init DOM Elements and handlers ////////////////////////////////////////////////////////////
        // [0] Box Picking Canvas
        const canvas2d = document.querySelector('#canvas2d') as HTMLCanvasElement
        const rect = canvas2d.getBoundingClientRect()
        canvas2d.width = rect.width
        canvas2d.height = rect.height
        this.ctx = canvas2d.getContext('2d')

        // [1] Create Control Pannel Dom
        const pannel = document.createElement('div')
        pannel.id = 'pannel'
        pannel.classList.add('pannel')
        pannel.innerHTML = `
            <div class="pannel-title f-center f3">Control-Pannel</div>
            <div class="pannel-content">
              <div class="tool-container f-row">
                <div class="tool-title f-center f2">Tool</div>
                <div class="tool-content f-row">
                  <div class="tool-item pic" id="brush" data-active="false" data-type="tool" data-val="brush"></div>
                  <div class="tool-item pic" id="box"   data-active="false" data-type="tool" data-val="box"></div>
                </div>
              </div>
              <div class="editor-container f-row">
                <div class="editor-title f-center f2">Editor</div>
                <div class="editor-content f-col">
                  <div class="editor-item p0_0_1_0" id="topology" data-active="false" data-type="editor" data-val="topology">
                    <div class="f-center p5_0 f1 editor-name">Topology-Editor</div>
                    <div class="f-row f-even">
                      <div class="f0 sub-item p0_5" id="subdivide" data-active="false" data-type="mode" data-val="subdivide">Subdivide</div>
                      <div class="f0 sub-item p0_5" id="delete"    data-active="false" data-type="mode" data-val="delete">Delete</div>
                    </div>
                  </div>
                  <div class="editor-item" id="attribute" data-active="false" data-type="editor" data-val="attribute">
                    <div class="f-center p10_5 f1 editor-name">Attribute-Editor</div>
                  </div>
                </div>
              </div>
            </div>
        `
        document.body.appendChild(pannel)

        // [2] Setup Control Panne Surface Interaction
        const ids = ['box', 'brush', 'topology', 'attribute', 'subdivide', 'delete']
        const doms = ids.map(id => document.querySelector(`#${id}`)! as HTMLDivElement)

        const handleClick = (dom: HTMLDivElement) => {
            const { type, val, active } = dom.dataset as { type: string, val: string, active: string }
            if (active === 'true' && val === 'topology') {
                for (let dom of doms) {
                    if (dom.dataset.type === 'mode' && dom.dataset.active === 'true') {
                        return
                    }
                }
            }
            else if (active === 'true') {
                dom.dataset.active = 'false' //only cancel the active
                this.EditorState[type] = 'none'
                val === 'attribute' && (this.EditorState.mode = 'none')
                return
            }
            deactivate(type)
            activate.call(this, dom)
            this.EditorState[type] = val

            // Local helper
            function deactivate(type: string) {
                doms.forEach(d => d.dataset.type === type && (d.dataset.active = 'false'))
                requestAnimationFrame(() => {
                    type === "editor" && deactivate("mode")
                })
            }
    
            function activate(this: GridLayer, dom: HTMLDivElement) {
                dom.dataset.active = 'true'
                if (dom.dataset.val === "topology") {
                    requestAnimationFrame(() => {
                        const modeDom = doms.find(d => d.dataset.val === this.EditorState.mode)
                        modeDom && (modeDom!.dataset.active = 'true')
                    })
                }
            }
        }

        doms.forEach((dom: HTMLDivElement) => {
            (dom).addEventListener('click', _ => { handleClick(dom) })
        })

        // [3] Setup Control Panne Core Interaction
        const proxyHandler = {
            set: this._handleStateSet.bind(this),
            get: this._handleStateGet.bind(this)
        }

        this.EditorState = new Proxy(this._EditorState, proxyHandler)

        // Default Editor State
        const initState = (state: { editor: string, mode: string, tool: string }) => {
            requestAnimationFrame(() => {
                doms.forEach((d: HTMLDivElement) => {
                    const activateVal = Object.values(state)
                    if (activateVal.includes(d.dataset.val as string)) {
                        d.dataset.active = 'true'
                    }
                })
                this.EditorState.editor = state.editor
                this.EditorState.mode = state.mode
                this.EditorState.tool = state.tool
            })
        }

        initState(/* defaultState */ {
            editor: 'topology',
            tool: 'brush',
            mode: 'subdivide'
        })
        

        // [4] Remove Event handler for map boxZoom
        this.map.boxZoom.disable()

        // [5] Add event listner for <Shift + T> (Set grid transparent or not)
        document.addEventListener('keydown', e => {

            if (e.shiftKey && e.key === 'T') {
                this.isTransparent = !this.isTransparent 
                console.log(`Grid Transparent: ${ this.isTransparent ? 'ON' : 'OFF' }`)
                this.map.triggerRepaint()
            }
        })

        // [6] Add event listner for <Shift + E> (Parse topology for grids and edges)
        document.addEventListener('keydown', e => {

            if (e.shiftKey && e.key === 'E') {

                this.gridRecorder.parseGridTopology(this.updateGPUEdges)

                this.map.triggerRepaint()
            }
        })


        // Init GPU resources ////////////////////////////////////////////////////////////

        const gl = this._gl

        gll.enableAllExtensions(gl)

        // Create shader
        this._edgeShader = await gll.createShader(gl, '/shaders/edge.glsl')
        this._pickingShader = await gll.createShader(gl, '/shaders/picking.glsl')
        this._gridLineShader = await gll.createShader(gl, '/shaders/gridLine.glsl')
        this._gridMeshShader = await gll.createShader(gl, '/shaders/gridMesh.glsl')

        // Set static uniform in shaders
        gl.useProgram(this._gridMeshShader)
        gl.uniform1i(gl.getUniformLocation(this._gridMeshShader, 'paletteTexture'), 0)

        gl.useProgram(this._edgeShader)
        gl.uniform1i(gl.getUniformLocation(this._edgeShader, 'paletteTexture'), 0)

        gl.useProgram(null)

        // Create edge storage buffer
        this._edgeStorageVAO = gl.createVertexArray()
        // Max edge Size = maxGridNum * 4
        this._edgeStorageBuffer = gll.createArrayBuffer(gl, this.maxGridNum * 4 * 4 * 4, gl.DYNAMIC_DRAW)!

        gl.bindVertexArray(this._edgeStorageVAO)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._edgeStorageBuffer)
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 4 * 4, 0)
        gl.enableVertexAttribArray(0)
        gl.vertexAttribDivisor(0, 1)

        gl.bindVertexArray(null)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)

        // Create grid storage buffer
        this._gridStorageVAO = gl.createVertexArray()
        this._gridTlStorageBuffer = gll.createArrayBuffer(gl, this.maxGridNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._gridTrStorageBuffer = gll.createArrayBuffer(gl, this.maxGridNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._gridBlStorageBuffer = gll.createArrayBuffer(gl, this.maxGridNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._gridBrStorageBuffer = gll.createArrayBuffer(gl, this.maxGridNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._gridLevelStorageBuffer = gll.createArrayBuffer(gl, this.maxGridNum * 1 * 2, gl.DYNAMIC_DRAW)!

        gl.bindVertexArray(this._gridStorageVAO)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridTlStorageBuffer)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(0)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridTrStorageBuffer)
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(1)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridBlStorageBuffer)
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(2)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridBrStorageBuffer)
        gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(3)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._gridLevelStorageBuffer)
        gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_SHORT, 1 * 2, 0)
        gl.enableVertexAttribArray(4)

        gl.vertexAttribDivisor(0, 1)
        gl.vertexAttribDivisor(1, 1)
        gl.vertexAttribDivisor(2, 1)
        gl.vertexAttribDivisor(3, 1)
        gl.vertexAttribDivisor(4, 1)

        gl.bindVertexArray(null)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)

        // Create texture
        this._paletteTexture = gll.createTexture2D(gl, 1, this.subdivideRules.length, 1, gl.RGB8)

        // Create picking pass
        this._pickingTexture = gll.createTexture2D(gl, 0, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
        this._pickingRBO = gll.createRenderBuffer(gl, 1, 1)
        this._pickingFBO = gll.createFrameBuffer(gl, [this._pickingTexture], 0, this._pickingRBO)

        this._boxPickingTexture = gll.createTexture2D(gl, 0, gl.canvas.width, gl.canvas.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(gl.canvas.width * gl.canvas.height * 4).fill(0))
        this._boxPickingRBO = gll.createRenderBuffer(gl, gl.canvas.width, gl.canvas.height)
        this._boxPickingFBO = gll.createFrameBuffer(gl, [this._boxPickingTexture], 0, this._boxPickingRBO)


        // Init palette texture (default in subdivider type)
        const colorList = new Uint8Array(this.subdivideRules.length * 3)
        for (let i = 0; i < this.subdivideRules.length; i++) {
            colorList.set([0, 127, 127], i * 3)
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
            .off('mouseout', this.mouseoutHandler as any)
            .off('resize', this.resizeHandler as any)

    }

    addTopologyEditorUIHandler() {

        this.removeUIHandler()

        this.map
            .on('mouseup', this.mouseupHandler as any)
            .on('mousedown', this.mousedownHandler as any)
            .on('mousemove', this.mousemoveHandler as any)
            .on('mouseout', this.mouseoutHandler as any)
            .on('resize', this.resizeHandler as any)
    }

    addAttributeEditorUIHandler() {
        this.removeUIHandler()

        this.map
            .on('mouseup', this.mouseupHandler as any)
            .on('mousedown', this.mousedownHandler as any)
    }

    hit(storageIds: number | number[]) {

        // Delete mode
        if (this.EditorState.mode === 'delete') {
            if (Array.isArray(storageIds))
                this.gridRecorder.removeGrids(storageIds, this.updateGPUGrid);
            else
                storageIds >= 0 && this.gridRecorder.removeGrid(storageIds, this.updateGPUGrid);
        }
        // Subdivider type
        else if (this.EditorState.mode === 'subdivide') {

            const ids = Array.isArray(storageIds) ? storageIds : [storageIds];
            ids.forEach((storageId: number) => {
                if (storageId < 0) return
                const maxLevel = this.subdivideRules.length - 1
                const [hitLevel] = this.gridRecorder.getGridInfoByStorageId(storageId)

                // Nothing will happen if the hit grid has the maximize level
                if (hitLevel === maxLevel) return

                const targetLevel = Math.min(this.uiOption.level, maxLevel)

                // Nothing will happen if subdivide grids more than one level
                // Or target subdivided level equals to hitLevel
                if (targetLevel - hitLevel > 1 || targetLevel == hitLevel) return

                this.hitSet.add([
                    storageId,      // FromStorageId
                    targetLevel,    // ToLevel
                ].join('-'))
            })
        }

        this.map.triggerRepaint()
    }

    removeGrid(storageId: number) {
        this.gridRecorder.removeGrid(storageId, this.updateGPUGrid)
        this.map.triggerRepaint()
    }

    removeGrids(storageIds: number[]) {
        this.gridRecorder.removeGrids(storageIds, this.updateGPUGrid)
        this.map.triggerRepaint()
    }

    subdivideGrid(info: string) {
        const [level, globalId] = decodeInfo(info)
        this.gridRecorder.subdivideGrid(level, globalId, this.updateGPUGrids)
    }

    tickGrids() {

        // if (this._currentType === this.SUBDIVIDER_TYPE) {
        if (this.EditorState.editor === "topology") {

            // Parse hitSet
            const subdividableUUIDs = new Array<string>()
            const removableStorageIds = new Array<number>()
            this.hitSet.forEach(hitActionInfo => {
                const [fromStorageId, toLevel] = decodeInfo(hitActionInfo)
                const [removableLevel, removableGlobalId] = this.gridRecorder.getGridInfoByStorageId(fromStorageId)

                // Check if valid
                if (removableLevel >= toLevel || toLevel - removableLevel > 1) return

                // Add removable grids
                removableStorageIds.push(fromStorageId)

                // add subdividable grids
                subdividableUUIDs.push([removableLevel, removableGlobalId].join('-'))
            })
            removableStorageIds.length && this.removeGrids(removableStorageIds)
            subdividableUUIDs.forEach(uuid => this.subdivideGrid(uuid))

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
        ;(!this.isTransparent) && this.drawGridMeshes()
        
        // Tick render: Line Pass
        if (this.gridRecorder.edgeNum) {
            !this.isTransparent && this.drawEdges()
        } else {
            (!this.isTransparent) && this.drawGridLines()
        }

        // WebGL check
        gll.errorCheck(gl)

        // Update display of capacity
        this.uiOption.capacity = this.gridRecorder.gridNum
        this.capacityController.updateDisplay()
    }

    picking(e: MapMouseEvent, e2: MapMouseEvent | undefined = undefined) {
        let storageIds
        if (e2) { //box mode
            const canvas = this._gl.canvas as HTMLCanvasElement
            const box = genPickingBox(canvas, this._boxPickingStart!, this._boxPickingEnd!)
            storageIds = this._boxPicking(box)
        } else {
            storageIds = this._brushPicking(this._calcPickingMatrix(e))
        }
        return storageIds
    }

    drawGridMeshes() {

        const gl = this._gl

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LESS)

        gl.useProgram(this._gridMeshShader)

        gl.bindVertexArray(this._gridStorageVAO)
        
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this._paletteTexture)

        gl.uniform2fv(gl.getUniformLocation(this._gridMeshShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this._gridMeshShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._gridMeshShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.gridRecorder.gridNum)
    }

    drawGridLines() {

        const gl = this._gl

        gl.disable(gl.BLEND)
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this._gridLineShader)

        gl.bindVertexArray(this._gridStorageVAO)

        gl.uniform2fv(gl.getUniformLocation(this._gridLineShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this._gridLineShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._gridLineShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.LINE_LOOP, 0, 4, this.gridRecorder.gridNum)
    }

    drawEdges() {

        const gl = this._gl

        gl.disable(gl.BLEND)
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this._edgeShader)

        gl.bindVertexArray(this._edgeStorageVAO)

        gl.uniform2fv(gl.getUniformLocation(this._edgeShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this._edgeShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._edgeShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.LINE_STRIP, 0, 2, this.gridRecorder.edgeNum)
    }

    /**
     * @param pickingMatrix 
     * @returns { number } StorageId of the picked grid
     */
    private _brushPicking(pickingMatrix: mat4): number {

        const gl = this._gl

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickingFBO)
        gl.viewport(0, 0, 1, 1)

        gl.clearColor(1.0, 1.0, 1.0, 1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.disable(gl.BLEND)

        gl.depthFunc(gl.LESS)
        gl.enable(gl.DEPTH_TEST)

        gl.useProgram(this._pickingShader)
        
        gl.bindVertexArray(this._gridStorageVAO)

        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'pickingMatrix'), false, pickingMatrix)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.gridRecorder.gridNum)

        gl.flush()

        const pixel = new Uint8Array(4)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)

        // Return storageId of the picked grid
        return pixel[0] + (pixel[1] << 8) + (pixel[2] << 16) + (pixel[3] << 24)
    }

    private _boxPicking(pickingBox: number[]) {

        const gl = this._gl
        const canvas = gl.canvas as HTMLCanvasElement
        const computedStyle = window.getComputedStyle(canvas)
        const canvasWidth = +computedStyle.width.split('px')[0]
        const canvasHeight = +computedStyle.height.split('px')[0]

        const minx = Math.min(pickingBox[0], pickingBox[2])
        const miny = Math.max(pickingBox[1], pickingBox[3])
        const maxx = Math.max(pickingBox[0], pickingBox[2])
        const maxy = Math.min(pickingBox[1], pickingBox[3])

        const [startX, startY, endX, endY] = [minx, miny, maxx, maxy]

        const pixelX = (startX)
        const pixelY = (canvasHeight - startY - 1)
        const pixelEndX = (endX)
        const pixelEndY = (canvasHeight - endY - 1)
        const width = Math.floor(pixelEndX - pixelX)
        const height = Math.floor(pixelEndY - pixelY)

        const boxPickingMatrix = mat4.create()

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._boxPickingFBO)
        gl.viewport(0, 0, canvasWidth, canvasHeight)

        gl.clearColor(1.0, 1.0, 1.0, 1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.disable(gl.BLEND)

        gl.depthFunc(gl.LESS)
        gl.enable(gl.DEPTH_TEST)

        gl.useProgram(this._pickingShader)

        gl.bindVertexArray(this._gridStorageVAO)

        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'pickingMatrix'), false, boxPickingMatrix)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.gridRecorder.gridNum)

        gl.flush()

        const pixel = new Uint8Array(4 * width * height)
        gl.readPixels(pixelX, pixelY, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)

        const set = new Set<number>()
        const targetLevel = Math.min(this.uiOption.level, this.subdivideRules.length - 1)
        for (let i = 0; i < height; i += 1) {
            for (let j = 0; j < width; j += 1) {

                const pixleId = 4 * (i * width + j)
                const storageId = pixel[pixleId] + (pixel[pixleId + 1] << 8) + (pixel[pixleId + 2] << 16) + (pixel[pixleId + 3] << 24)
                if (storageId < 0 || set.has(storageId)) continue

                if (this.EditorState.mode === 'subdivide' &&
                    targetLevel - this.gridRecorder.getGridInfoByStorageId(storageId)[0] != 1)
                    continue

                set.add(storageId)
            }
        }
        return Array.from(set)
    }

    private _updateGPUGrid(info?: [storageId: number, level: number, vertices: Float32Array]) {

        if (info) {
            this.writeGridInfoToStorageBuffer(info)
            this._gl.flush()
        }
        this.map.triggerRepaint()
    }

    private _updateGPUGrids(infos?: [fromStorageId: number, toStorageId: number, levels: Uint16Array, vertices: Float32Array]) {

        if (infos) {
            this.writeMultiGridInfoToStorageBuffer(infos)
            this._gl.flush()
        }
        this.map.triggerRepaint()
    }

    private _updateGPUEdges(fromStorageId: number, vertexBuffer: Float32Array) {

        const gl = this._gl
        const vertexByteStride = 4 * 4

        gl.bindBuffer(gl.ARRAY_BUFFER, this._edgeStorageBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertexBuffer)

        gl.bindBuffer(gl.ARRAY_BUFFER, null)

        this.map.triggerRepaint()
    }

    private _calcPickingMatrix(e: MapMouseEvent) {

        const canvas = this._gl.canvas as HTMLCanvasElement
        const offsetX = e.originalEvent.clientX
        const offsetY = e.originalEvent.clientY

        const computedStyle = window.getComputedStyle(canvas)
        const canvasWidth = +computedStyle.width.split('px')[0]
        const canvasHeight = +computedStyle.height.split('px')[0]

        const ndcX = offsetX / canvasWidth * 2.0 - 1.0
        const ndcY = 1.0 - offsetY / canvasHeight * 2.0

        const pickingMatrix = mat4.create()
        mat4.scale(pickingMatrix, pickingMatrix, [canvasWidth * 0.5, canvasHeight * 0.5, 1.0])
        mat4.translate(pickingMatrix, pickingMatrix, [-ndcX, -ndcY, 0.0])

        return pickingMatrix
    }

    private _mousedownHandler(e: MapMouseEvent) {

        if (e.originalEvent.shiftKey && e.originalEvent.button === 0 && this.EditorState.tool === 'brush') {
            this.isShiftClick = true
            this.map.dragPan.disable()
        }
        //// ADDON 
        if (e.originalEvent.shiftKey && e.originalEvent.button === 0 && this.EditorState.tool === 'box') {
            this.isShiftClick = true
            this.map.dragPan.disable()
            this.map.scrollZoom.disable()
            this._boxPickingStart = e
            this._boxPickingEnd = e
            // drawRectangle(this.ctx,)
        }
    }

    private _mouseupHandler(e: MapMouseEvent) {

        if (this.isShiftClick) {

            this.map.dragPan.enable()
            this.map.scrollZoom.enable()

            let e1, e2
            if (this.EditorState.tool === 'brush') {
                e1 = e
                e2 = undefined
            } else {
                this._boxPickingEnd = e
                e1 = this._boxPickingStart!
                e2 = this._boxPickingEnd
            }

            const storageIds = this.picking(e1, e2)
            this.hit(storageIds)

            clear(this.ctx!)
            this._boxPickingStart = null
            this._boxPickingEnd = null
            this.isShiftClick = false

        }


        /*        
        if (this.isShiftClick && this.EditorState.tool === 'brush') {
            this.map.dragPan.enable()
            this.isShiftClick = false

            const storageId = this.picking(this._calcPickingMatrix(e))
            storageId >= 0 && this.hit(storageId)

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
        //// ADDON 2025/1/3
        if (this.isShiftClick && this.EditorState.tool === 'box') {

            this.map.dragPan.enable()
            this.map.scrollZoom.enable()
            this.isShiftClick = false
            this._boxPickingEnd = e

            const canvas = this._gl.canvas as HTMLCanvasElement
            const box = genPickingBox(canvas, this._boxPickingStart!, this._boxPickingEnd!)
            const storageIds = this.boxPicking(box)

            // storageIds.forEach(sid => this.hit(sid))
            this.hits(storageIds)

            // reset
            clear(this.ctx!)
            this._boxPickingStart = null
            this._boxPickingEnd = null
        }

        */

    }

    private _mousemoveHandler(e: MapMouseEvent) {

        if (this.isShiftClick && this.EditorState.tool === 'brush') {
            this.map.dragPan.disable()

            // const storageId = this.picking(this._calcPickingMatrix(e))
            // storageId >= 0 && this.hit(storageId)
            const storageId = this.picking(e) as number
            this.hit(storageId)
        }

        if (this.isShiftClick && this.EditorState.tool === 'box' && this._boxPickingStart) {
            // render the picking box
            this._boxPickingEnd = e
            const canvas = this._gl.canvas as HTMLCanvasElement
            const box = genPickingBox(canvas, this._boxPickingStart, this._boxPickingEnd!)
            drawRectangle(this.ctx!, box)
        }
    }

    private _mouseoutHandler(e: MapMouseEvent) {

        if (this.isShiftClick && this.EditorState.tool === 'box') {

            this._boxPickingEnd = e

            const storageIds = this.picking(this._boxPickingStart!, this._boxPickingEnd!)
            this.hit(storageIds)

            // reset
            clear(this.ctx!)
            this._boxPickingStart = null
            this._boxPickingEnd = null

        }
        this.map.dragPan.enable()
        this.map.scrollZoom.enable()
        this.isShiftClick = false
    }

    private _resizeHandler(e: Event) {
        // resize canvas 2d
        const canvas = this.ctx!.canvas;
        if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        }
    }

    private _handleStateGet(target: Record<string, string>, prop: string): string {
        return Reflect.get(target, prop);
    }
    
    private _handleStateSet(target: Record<string, string>, prop: string, value: string): boolean {
        if (!(prop in target))
            throw new Error(`Property ${prop} does not exist on editorControl`);

        target[prop] = value;
        switch (prop) {
            case 'editor':
                console.log('set editor ', value)
                this.typeChanged = true
                switch (value) {
                    case 'topology':
                        this.addTopologyEditorUIHandler()
                        break;
                    case 'attribute':
                        this._EditorState.mode = 'none'
                        this.addAttributeEditorUIHandler()
                        /*
                        attribute setup
                        */
                        break;
                }
                this.map.triggerRepaint()
                break;
            case 'tool':
                console.log('set tool ', value)
                // switch (value) {
                //     case 'brush':
                //         break;
                //     case 'box':
                //         break;
                // }
                break;
            case 'mode':
                console.log('set mode ', value)
                // switch (value) {
                //     case 'subdivide':
                //         break;
                //     case 'delete':
                //         break;
                // }
                break
        }
        return true;
    }

    // Fast function to upload one grid rendering info to GPU stograge texture
    /** @deprecated */
    writeGridInfoToTexture(info: [storageId: number, level: number, vertices: Float32Array]) {

        const gl = this._gl
        const [storageId, level, vertices] = info
        const storageU = storageId % this.storageTextureSize
        const storageV = Math.floor(storageId / this.storageTextureSize)

        gll.fillSubTexture2DArrayByArray(gl, this._storageTextureArray, 0, storageU, storageV, 0, 1, 1, 4, gl.RG, gl.FLOAT, vertices)
        gll.fillSubTexture2DByArray(gl, this._levelTexture, 0, storageU, storageV, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array([level]))
    }

    /** @deprecated */
    writeMultiGridInfoToTexture(infos: [fromStorageId: number, toStorageId: number, levels: Uint16Array, vertices: Float32Array]) {

        const gl = this._gl
        const [fromStorageId, toStorageId, levels, vertices] = infos

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
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function decodeInfo(infoKey: string): Array<number> {

    return infoKey.split('-').map(key => +key)
}

// ADDON
function genPickingBox(canvas: HTMLCanvasElement, startEvent: MapMouseEvent, endEvent: MapMouseEvent) {

    const rect = canvas.getBoundingClientRect()
    const _pickingBox = [
        startEvent.point.x - rect.left,
        startEvent.point.y - rect.top,
        endEvent.point.x - rect.left,
        endEvent.point.y - rect.top
    ]
    return _pickingBox as [number, number, number, number]

}

function clear(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function drawRectangle(ctx: CanvasRenderingContext2D, pickingBox: [number, number, number, number]) {

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    let [startX, startY, endX, endY] = pickingBox

    if (startX > endX) { [startX, endX] = [endX, startX] }
    if (startY > endY) { [startY, endY] = [endY, startY] }

    const width = (endX - startX)
    const height = (endY - startY)

    ctx.strokeStyle = 'rgba(227, 102, 0, 0.67)'
    ctx.fillStyle = 'rgba(235, 190, 148, 0.52)';
    ctx.lineWidth = 2
    ctx.setLineDash([5, 3])
    ctx.strokeRect(startX, startY, width, height)
    ctx.fillRect(startX, startY, width, height)
}



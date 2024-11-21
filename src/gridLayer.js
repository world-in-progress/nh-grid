import axios from 'axios'
import { GridNode } from './grid'
import { BoundingBox2D } from './boundingBox2D'

export default class GridLayer {

    /**
     * @param {{
     *      srcCS: number,
     *      maxGridNum: number,
     *      maxSubdividedDepth: number,
     *      subdivideRules: [number, number][]
     *      boundaryCondition: [number, number, number, number]
     * }} options 
     */
    constructor(options) {

        // Layer
        this.type = 'custom'
        this.map = undefined
        this.id = 'GridLayer'
        this.renderingMode = '3d'

        // Screen properties
        this.canvasWidth = 0
        this.canvasHeight = 0

        // Update set
        /** @type {Set<{level: number, globalId: number}>} */
        this.hitSet = new Set()

        // Subdivide rule
        this.srcCS = options.srcCS
        this.subdivideRules = options.subdivideRules || [[1, 1]]

        // Grid properties
        this.registeredGridCount = 0
        this.maxGridNum = options.maxGridNum
        this.boundaryCondition = new BoundingBox2D(...options.boundaryCondition)

        /** @type {{width: number, height: number, count: number, grids: GridNode[]}[]} */
        this.gridRecoder = new Array(this.subdivideRules.length)

        // Add rootGrid to gridRecoder
        const rootGrid = new GridNode({
            localId: 0,
            bBox: this.boundaryCondition,
            subdivideRule: this.subdivideRules[0]
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
        this.renderList = undefined

        // Storage texture memory
        this.storageTextureSize = Math.ceil(Math.sqrt(options.maxGridNum))

        // GPU resource
        this.xTexture = undefined
        this.yTexture = undefined
        this.indexTexture = undefined

        // Init flag
        this.isInitialized = false
    }

    hit(lon, lat) {

        const maxLevel = this.subdivideRules.length - 1
        const { width, height } = this.gridRecoder[maxLevel]

        const normalizedX = (lon - this.boundaryCondition.xMin) / (this.boundaryCondition.xMax - this.boundaryCondition.xMin)
        const normalizedY = (lat - this.boundaryCondition.yMin) / (this.boundaryCondition.yMax - this.boundaryCondition.yMin)

        if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
            return
        }
        const col = Math.floor(normalizedX * width)
        const row = Math.floor(normalizedY * height)

        this.hitSet.add({
            level: maxLevel,
            globalId: row * width + col
        })

        this.map.triggerRepaint()
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { number } level Level of hitted grid
     * @param { number } globalId Global id of Hitted grid
    */
    subdivideGrid(gl, level, globalId) {

        // Subdivide parent if this grid does not exist
        if (this.gridRecoder[level].grids[globalId] === undefined) this.subdivideGrid(gl, level - 1, this.getParentGlobalId(level, globalId))

        const grid = this.gridRecoder[level].grids[globalId]

        // Return if has been subdivided
        if (grid.children.length !== 0) return

        // Subdivide
        const [subWidth, subHeight] = this.subdivideRules[level]
        const globalU = globalId % this.gridRecoder[level].width
        const globalV = Math.floor(globalId / this.gridRecoder[level].width)

        for (let localId = 0; localId < subWidth * subHeight; localId++) {

            const subU = localId % subWidth
            const subV = Math.floor(localId / subWidth)
            
            const subGlobalU = globalU * subWidth + subU
            const subGlobalV = globalV * subHeight + subV
            const subGlobalId = subGlobalV * (this.gridRecoder[level].width * subWidth) + subGlobalU

            const subGrid = new GridNode({
                localId,
                parent: grid,
                subdivideRule: this.subdivideRules[level]
            })
            
            grid.children.push(subGrid)
            this.gridRecoder[level + 1].grids[subGlobalId] = subGrid
            this.writeGridInfoToTexture(gl, this.registeredGridCount++, subGrid)
        }
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { number } level Level of hitted grid
     * @param { number } globalId Global id of Hitted grid
    */
    hitGrid(gl, level, globalId) {

        // Subdivide parent first (to create this grid if it does not exist)
        const parentGlobalId = this.getParentGlobalId(level, globalId)
        this.subdivideGrid(gl, level - 1, parentGlobalId)
        
        // Skip if grid has been hitted
        const grid = this.gridRecoder[level].grids[globalId]
        if (grid.hit) return

        // Remove parent hit if it has been hitted
        const parent = this.gridRecoder[level - 1].grids[parentGlobalId]
        if (parent.hit) {
            parent.hit = false
        }

        // Hit
        grid.hit = true
    }

    /** 
     * @param {WebGL2RenderingContext} gl 
     * @param {number} storageId
     * @param {GridNode} grid
    */
    writeGridInfoToTexture(gl, storageId, grid) {

        grid.storageId = storageId

        const vertices = grid.getVertices(this.srcCS)
        const storageU = storageId % this.storageTextureSize
        const storageV = Math.floor(storageId / this.storageTextureSize)

        fillSubTexture2DByArray(gl, this.xTexture, 0, storageU, storageV, 1, 1, gl.RG, gl.FLOAT, vertices.slice(0, 2))
        fillSubTexture2DByArray(gl, this.yTexture, 0, storageU, storageV, 1, 1, gl.RG, gl.FLOAT, vertices.slice(2, 4))
    }

    /** @param { WebGL2RenderingContext } gl */
    tickGridRenderList(gl) {

        this.renderList = []

        const stack = [this.gridRecoder[0].grids[0]]
        while(stack.length > 0) {

            const grid = stack.pop()

            // Add hitted grid to render list
            if (grid.children.length === 0 && grid.hit) {
                this.renderList.push(grid.storageId)
            } else {
                stack.push(...grid.children)
            }
        }
        
        const renderListLength = this.renderList.length
        const blockWidth = this.storageTextureSize
        const blockHeight = Math.ceil(renderListLength / this.storageTextureSize)
        const blockData = new Uint32Array(blockWidth * blockHeight) // TODO: can be made as pool
        blockData.set(this.renderList, 0)
        fillSubTexture2DByArray(gl, this.indexTexture, 0, 0, 0, blockWidth, blockHeight, gl.RED_INTEGER, gl.UNSIGNED_INT, blockData)
    }

    /**
     * @param { WebGL2RenderingContext } gl
    */
    hitGrids(gl) {
        
        if (this.hitSet.size === 0) return

        this.hitSet.forEach(({level, globalId}) => {
            this.hitGrid(gl, level, globalId)
        })
        this.tickGridRenderList(gl)

        this.hitSet.clear()
    }

    /** @param { WebGL2RenderingContext } gl */
    async init(gl) {

        enableAllExtensions(gl)

        this.canvasWidth = gl.canvas.width
        this.canvasHeight = gl.canvas.height

        // this.registerGridsInLevel1(gl) // create storage texture (xTexture, yTexture)
        this.terrainMeshShader = await createShader(gl, '/shaders/gridMesh.glsl')
        this.terrainLineShader = await createShader(gl, '/shaders/gridLine.glsl')
        this.xTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.RG32F)
        this.yTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.RG32F)
        this.indexTexture = createTexture2D(gl, 1, this.storageTextureSize, this.storageTextureSize, gl.R32UI)

        for (let globalId = 0; globalId < this.gridRecoder[1].width * this.gridRecoder[1].height; globalId++) {
            this.hitSet.add({
                level: 1,
                globalId
            })
        }

        this.isInitialized = true
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { [number] } matrix  
     */
    render(gl, matrix) {

        // Skip if not ready
        if (!this.isInitialized) return

        //// Tick logic //////////////////////////////////////////////////////////////////////////////////////////
        this.hitGrids(gl)

        //// Tick render: Mesh Pass///////////////////////////////////////////////////////////////////////////////
        /**/ this.drawGridMesh(gl) /**/////////////////////////////////////////////////////////////////////////
        
        //// Tick render: Line Pass //////////////////////////////////////////////////////////////////////////////
        /**/ this.drawGridLine(gl) /**////////////////////////////////////////////////////////////////////////////

        //////////////////////////////////////////////////////////////////////////////////////////////////////////
        /**/ errorCheck(gl) //////////////////////////////////////////////////////////////////////////////////////
        
    }

    /**
     * @param { number } level Level of hitted grid
     * @param { number } globalId Global id of Hitted grid
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
     * @param { number } level Level of hitted grid
     * @param { number } globalId Global id of Hitted grid
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
        gl.bindTexture(gl.TEXTURE_2D, this.indexTexture)

        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'xTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'yTexture'), 1)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'indexTexture'), 2)
        gl.uniform2fv(gl.getUniformLocation(this.terrainMeshShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this.terrainMeshShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainMeshShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.renderList.length)
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

        gl.uniform1i(gl.getUniformLocation(this.terrainLineShader, 'xTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this.terrainLineShader, 'yTexture'), 1)
        gl.uniform2fv(gl.getUniformLocation(this.terrainLineShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this.terrainLineShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainLineShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.LINE_LOOP, 0, 4, this.registeredGridCount)
    }

    onAdd(map, gl) {

        this.map = map
        this.init(gl)
    }
    
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

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

const RAD_TO_DEG = 180.0 / Math.PI

function tile2lon(x, z) {

    return x / Math.pow(2.0, z) * 360.0 - 180.0
}

function tile2lat(y, z) {

    const n = Math.PI - 2.0 * Math.PI * y / Math.pow(2.0, z)
    return RAD_TO_DEG * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function tileToBBox(tile) {

    const w = tile2lon(tile[0], tile[2])
    const e = tile2lon(tile[0] + 1.0, tile[2])
    const n = tile2lat(tile[1], tile[2])
    const s = tile2lat(tile[1] + 1.0, tile[2])

    return [w, s, e, n]
}
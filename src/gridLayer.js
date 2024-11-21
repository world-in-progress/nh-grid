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

        // Subdivide rule
        this.srcCS = options.srcCS
        this.subdivideRules = options.subdivideRules || [[1, 1]]

        // Grid properties
        this.registeredGridCount = 0
        this.maxGridNum = options.maxGridNum
        this.boundaryCondition = new BoundingBox2D(...options.boundaryCondition)

        /** @type {{totalNum: number, count: number, grids: GridNode[]}[]} */
        this.gridRecoder = new Array(this.subdivideRules.length)

        // Init gridRecoder
        let totalNum = 1
        this.subdivideRules.forEach((rule, index) => {
            this.gridRecoder[index] = {
                totalNum,
                count: 0,
                grids: new Array(totalNum)
            }
            totalNum *= rule[0] * rule[1]
        })

        // Add rootGrid to gridRecoder
        const rootGrid = new GridNode({
            localId: 0,
            bBox: this.boundaryCondition,
            subdivideRule: this.subdivideRules[0]
        })
        this.gridRecoder[0].count = 1
        this.gridRecoder[0].grids = [ rootGrid ]

        // Storage texture memory
        this.storageTextureSize = Math.ceil(Math.sqrt(options.maxGridNum))

        // GPU resource
        this.xTexture = undefined
        this.yTexture = undefined
        this.indexTexture = undefined

        // Init flag
        this.isInitialized = false
    }

    // TODO: transfer to registerGrid
    /** @param { WebGL2RenderingContext } gl */
    registerGridsInLevel1(gl) {
        
        const globalSize =  this.gridRecoder[1].totalNum
        const localSize = this.subdivideRules[0][0] * this.subdivideRules[0][1]
        for (let globalId = 0; globalId < globalSize; globalId++) {
            
            const localId = globalId - /* parent globalId */ Math.floor(globalId / localSize) * localSize
            this.gridRecoder[1].grids[globalId] = new GridNode({
                localId: localId,
                parent: this.gridRecoder[0].grids[0],
                subdivideRule: this.subdivideRules[1]
            })
        }
        this.gridRecoder[1].count = globalSize;
        this.registeredGridCount = this.gridRecoder[1].count

        // Init storage texture data
        const xArray = new Float32Array(this.storageTextureSize * this.storageTextureSize * 2)
        const yArray = new Float32Array(this.storageTextureSize * this.storageTextureSize * 2)
        this.gridRecoder[1].grids.forEach((grid, index) => {
            const vertices = grid.getVertices(this.srcCS)
            xArray[2 * index + 0] = vertices[0]; yArray[2 * index + 0] = vertices[1]
            xArray[2 * index + 1] = vertices[2]; yArray[2 * index + 1] = vertices[3]
        })

        // Fill storage texture
        this.xTexture = createTexture2D(gl, this.storageTextureSize, this.storageTextureSize, gl.RG32F, gl.RG, gl.FLOAT, xArray)
        this.yTexture = createTexture2D(gl, this.storageTextureSize, this.storageTextureSize, gl.RG32F, gl.RG, gl.FLOAT, yArray)
    }

    onAdd(map, gl) {

        this.map = map

        this.init(gl)
    }

    /** @param { WebGL2RenderingContext } gl */
    async init(gl) {

        enableAllExtensions(gl)

        this.canvasWidth = gl.canvas.width
        this.canvasHeight = gl.canvas.height

        this.registerGridsInLevel1(gl) // create storage texture (xTexture, yTexture)
        this.terrainMeshShader = await createShader(gl, '/shaders/gridMesh.glsl')
        this.terrainLineShader = await createShader(gl, '/shaders/gridLine.glsl')

        this.isInitialized = true
    }

    /**
     * @param { WebGL2RenderingContext } gl
     * @param { [number] } matrix  
     */
    render(gl, matrix) {

        // Skip if not ready
        if (!this.isInitialized) return

        console.log(this.gridRecoder)

        //// Tick logic //////////////////////////////////////////////////////////////////////////////////////////
        this.map.update()

        //// Tick render: Mesh Pass///////////////////////////////////////////////////////////////////////////////
        /**/ this.drawGridMesh(gl, 1) /**/////////////////////////////////////////////////////////////////////////
        
        //// Tick render: Line Pass //////////////////////////////////////////////////////////////////////////////
        /**/ this.drawGridLine(gl) /**////////////////////////////////////////////////////////////////////////////

        //////////////////////////////////////////////////////////////////////////////////////////////////////////
        /**/ errorCheck(gl) //////////////////////////////////////////////////////////////////////////////////////
        
    }

    /** 
     * @param {WebGL2RenderingContext} gl 
     * @param {number} level
    */
    drawGridMesh(gl, level) {

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LESS)

        gl.useProgram(this.terrainMeshShader)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.xTexture)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.yTexture)

        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'xTexture'), 0)
        gl.uniform1i(gl.getUniformLocation(this.terrainMeshShader, 'yTexture'), 1)
        gl.uniform2fv(gl.getUniformLocation(this.terrainMeshShader, 'centerLow'), this.map.centerLow)
        gl.uniform2fv(gl.getUniformLocation(this.terrainMeshShader, 'centerHigh'), this.map.centerHigh)
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainMeshShader, 'uMatrix'), false, this.map.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.gridRecoder[level].totalNum)
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
function createTexture2D(gl, width, height, internalFormat, format, type, resource, generateMips = false) {
    
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, generateMips ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, resource ? resource : null)

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
function fillTexture2DByArray(gl, texture, width, height, internalFormat, format, type, array) {
    
    // Bind the texture
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    // Upload texture data
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, array);

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
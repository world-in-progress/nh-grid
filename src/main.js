
import GridLayer from './GridLayer.js'
import { vec3, mat4 } from 'gl-matrix'
import 'mapbox-gl/dist/mapbox-gl.css'
import mapboxgl from 'mapbox-gl'
import { GUI } from 'dat.gui'

// DOM Configuration //////////////////////////////////////////////////////////////////////////////////////////////////////

// Map
const mapDiv = document.createElement('div')
mapDiv.style.height = '100%'
mapDiv.style.width = '100%'
mapDiv.style.zIndex = '1'
mapDiv.id = 'map'
document.body.appendChild(mapDiv)

// Map //////////////////////////////////////////////////////////////////////////////////////////////////////
class NHMap extends mapboxgl.Map {

    constructor(options) {

        // Init mapbox map
        super(options)

        // Attributes
        this.mercatorCenter = new mapboxgl.MercatorCoordinate(...this.transform._computeCameraPosition().slice(0, 3))
        this.centerHigh = [ 0.0, 0.0 ]
        this.centerLow = [ 0.0, 0.0 ]

        this.WORLD_SIZE = 1024000 // TILE_SIZE * 2000
        this.worldCamera = undefined
        this.vpMatrix = []
    }

    update() {

        this.mercatorCenter = new mapboxgl.MercatorCoordinate(...this.transform._computeCameraPosition().slice(0, 3))

        const mercatorCenterX = encodeFloatToDouble(this.mercatorCenter.x)
        const mercatorCenterY = encodeFloatToDouble(this.mercatorCenter.y)

        this.centerLow[0] = mercatorCenterX[1]
        this.centerLow[1] = mercatorCenterY[1]
        this.centerHigh[0] = mercatorCenterX[0]
        this.centerHigh[1] = mercatorCenterY[0]

        // this.mercatorMatrix = getMercatorMatrix(this.transform)
        this.relativeEyeMatrix = mat4.multiply([], this.transform.mercatorMatrix, mat4.translate([], mat4.identity([]), vec3.set([], this.centerHigh[0], this.centerHigh[1], 0.0)))
    }
}

// Start Dash /////////////////////////////////////////////////////////////////////////////////////////////////////

mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg'

const gridLayer = new GridLayer({
    maxGridNum: 4096 * 4096,
    srcCS: 4326,
    subdivideRules: [
        [4, 4],
        [4, 4],
        [2, 2],
        [2, 2],
        [2, 2],
        [2, 2],
        [2, 2],
        [2, 2],
        [1, 1]
    ],
    boundaryCondition: [
        113.9031065683563781, 22.3574937445505597, 114.1999667438311548, 22.5363807916184804
    ]
})

// dat.GUI
const gui = new GUI()
const brushFolder = gui.addFolder('Brush')
brushFolder.add(gridLayer.brushOption, 'level', 1, 8, 1)
brushFolder.open()

const map = new NHMap({
    style: "mapbox://styles/ycsoku/cldjl0d2m000501qlpmmex490",
    center: [ 114.051537, 22.446937 ],
    projection: 'mercator',
    GPUFrame: GPUFrame,
    container: 'map',
    antialias: true,
    maxZoom: 22,
    zoom: 11

}).on('load', () => {
    map.addLayer(gridLayer)

})

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////
function encodeFloatToDouble(value) {

    const result = new Float32Array(2);
    result[0] = value;
    
    const delta = value - result[0];
    result[1] = delta;
    return result;
}

function getMercatorMatrix(t) {
    
    if (!t.height) return;

    const offset = t.centerOffset;

    // Z-axis uses pixel coordinates when globe mode is enabled
    const pixelsPerMeter = t.pixelsPerMeter;

    if (t.projection.name === 'globe') {
        t._mercatorScaleRatio = mercatorZfromAltitude(1, t.center.lat) / mercatorZfromAltitude(1, GLOBE_SCALE_MATCH_LATITUDE);
    }

    const projectionT = getProjectionInterpolationT(t.projection, t.zoom, t.width, t.height, 1024)

    // 'this._pixelsPerMercatorPixel' is the ratio between pixelsPerMeter in the current projection relative to Mercator.
    // This is useful for converting e.g. camera position between pixel spaces as some logic
    // such as raycasting expects the scale to be in mercator pixels
    t._pixelsPerMercatorPixel = t.projection.pixelSpaceConversion(t.center.lat, t.worldSize, projectionT)

    t.cameraToCenterDistance = 0.5 / Math.tan(t._fov * 0.5) * t.height * t._pixelsPerMercatorPixel

    t._updateCameraState()

    t._farZ = t.projection.farthestPixelDistance(t)
    // t._farZ = farthestPixelDistanceOnPlane(t, -500 * 100.0, pixelsPerMeter)

    // The larger the value of nearZ is
    // - the more depth precision is available for features (good)
    // - clipping starts appearing sooner when the camera is close to 3d features (bad)
    //
    // Smaller values worked well for mapbox-gl-js but deckgl was encountering precision issues
    // when rendering it's layers using custom layers. This value was experimentally chosen and
    // seems to solve z-fighting issues in deckgl while not clipping buildings too close to the camera.
    t._nearZ = t.height / 50

    const zUnit = t.projection.zAxisUnit === "meters" ? pixelsPerMeter : 1.0;
    const worldToCamera = t._camera.getWorldToCamera(t.worldSize, zUnit);

    let cameraToClip;

    // Projection matrix
    const cameraToClipPerspective = t._camera.getCameraToClipPerspective(t._fov, t.width / t.height, t._nearZ, t._farZ) 
    // Apply offset/padding
    cameraToClipPerspective[8] = -offset.x * 2 / t.width;
    cameraToClipPerspective[9] = offset.y * 2 / t.height;

    if (t.isOrthographic) {
        const cameraToCenterDistance =  0.5 * t.height / Math.tan(t._fov / 2.0) * 1.0;

        // Calculate bounds for orthographic view
        let top = cameraToCenterDistance * Math.tan(t._fov * 0.5);
        let right = top * t.aspect;
        let left = -right;
        let bottom = -top;
        // Apply offset/padding
        right -= offset.x;
        left -= offset.x;
        top += offset.y;
        bottom += offset.y;

        cameraToClip = t._camera.getCameraToClipOrthographic(left, right, bottom, top, t._nearZ, t._farZ);

        // const mixValue = t.pitch >= OrthographicPitchTranstionValue ? 1.0 : t.pitch / OrthographicPitchTranstionValue;
        // lerpMatrix(cameraToClip, cameraToClip, cameraToClipPerspective, easeIn(mixValue));
    } else {
        cameraToClip = cameraToClipPerspective;
    }

    let m = mat4.multiply([], cameraToClip, worldToCamera)

    if (t.projection.isReprojectedInTileSpace) {
        
    } else {
        t.inverseAdjustmentMatrix = [1, 0, 0, 1];
    }

    // The mercatorMatrix can be used to transform points from mercator coordinates
    // ([0, 0] nw, [1, 1] se) to GL coordinates. / zUnit compensates for scaling done in worldToCamera.
    mat4.scale(t.mercatorMatrix, m, [t.worldSize, t.worldSize, t.worldSize / zUnit])

    return t.mercatorMatrix
}

function smoothstep(e0, e1, x) {
    x = clamp((x - e0) / (e1 - e0), 0, 1);
    return x * x * (3 - 2 * x);
}

function circumferenceAtLatitude(latitude) {

    const earthRadius = 6371008.8
    const earthCircumference = 2 * Math.PI * earthRadius
    return earthCircumference * Math.cos(latitude * Math.PI / 180)
}

function mercatorZfromAltitude(altitude, lat) {
    return altitude / circumferenceAtLatitude(lat)
}

function farthestPixelDistanceOnPlane(tr, minElevation, pixelsPerMeter) {
    // Find the distance from the center point [width/2 + offset.x, height/2 + offset.y] to the
    // center top point [width/2 + offset.x, 0] in Z units, using the law of sines.
    // 1 Z unit is equivalent to 1 horizontal px at the center of the map
    // (the distance between[width/2, height/2] and [width/2 + 1, height/2])
    const fovAboveCenter = tr.fovAboveCenter;

    // Adjust distance to MSL by the minimum possible elevation visible on screen,
    // this way the far plane is pushed further in the case of negative elevation.
    const minElevationInPixels = minElevation * pixelsPerMeter;
    const cameraToSeaLevelDistance = ((tr._camera.position[2] * tr.worldSize) - minElevationInPixels) / Math.cos(tr._pitch);
    const topHalfSurfaceDistance = Math.sin(fovAboveCenter) * cameraToSeaLevelDistance / Math.sin(Math.max(Math.PI / 2.0 - tr._pitch - fovAboveCenter, 0.01));

    // Calculate z distance of the farthest fragment that should be rendered.
    const furthestDistance = Math.sin(tr._pitch) * topHalfSurfaceDistance + cameraToSeaLevelDistance;
    const horizonDistance = cameraToSeaLevelDistance * (1 / tr._horizonShift);

    // Add a bit extra to avoid precision problems when a fragment's distance is exactly `furthestDistance`
    return Math.min(furthestDistance * 1.01, horizonDistance);
}

function getProjectionInterpolationT(projection, zoom, width, height, maxSize = Infinity) {
    const range = projection.range;
    if (!range) return 0;

    const size = Math.min(maxSize, Math.max(width, height));
    // The interpolation ranges are manually defined based on what makes
    // sense in a 1024px wide map. Adjust the ranges to the current size
    // of the map. The smaller the map, the earlier you can start unskewing.
    const rangeAdjustment = Math.log(size / 1024) / Math.LN2;
    const zoomA = range[0] + rangeAdjustment;
    const zoomB = range[1] + rangeAdjustment;
    const t = smoothstep(zoomA, zoomB, zoom);
    return t;
}

function makePerspectiveMatrix(fovy, aspect, near, far) {

    const f = 1.0 / Math.tan(fovy / 2),
        nf = 1 / (near - far)

    return  [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, (2 * far * near) * nf, 0
    ]
}

function updateWorldCamera (transform, mercatorWorldSize, minElevation = -30.0) {

    const fov = transform._fov
    const halfFov = transform._fov / 2

    const angle = transform.angle
    const pitch = transform._pitch

    const aspect = transform.width / transform.height

    const cameraToCenterDistance = 0.5 / Math.tan(halfFov) * mercatorWorldSize / transform.scale * transform.height / 512.0
    const cameraToSeaLevelDistance = ((transform._camera.position[2] * mercatorWorldSize) - minElevation) / Math.cos(pitch)
    const topHalfSurfaceDistance = Math.sin(halfFov) * cameraToSeaLevelDistance / Math.sin(Math.max(Math.PI / 2.0 - pitch - halfFov, 0.01))
    const furthestDistance = Math.sin(pitch) * topHalfSurfaceDistance + cameraToSeaLevelDistance
    const horizonDistance = cameraToSeaLevelDistance / transform._horizonShift
    const farZ = Math.min(furthestDistance * 1.01, horizonDistance)
    // const farZ = farthestPixelDistanceOnPlane(transform, -80.06899999999999 * 30.0, transform.pixelsPerMeter)
    const nearZ = transform.height / 50.0

    const pitchMatrix = mat4.rotateX([], mat4.create(), pitch)
    const angleMatrix = mat4.rotateZ([], mat4.create(), angle)
    const worldToCamera = mat4.multiply([], angleMatrix, pitchMatrix)
    
    const x = transform.pointMerc.x
    const y = transform.pointMerc.y
    const centerX = (x - 0.5) * mercatorWorldSize
    const centerY = (0.5 - y) * mercatorWorldSize
    const center = [centerX, centerY, 0]

    const up = vec3.transformMat4([], [0, 1, 0], angleMatrix)
    const position = vec3.add([], vec3.scale([], vec3.transformMat4([], [0, 0, 1], worldToCamera), cameraToCenterDistance), center)

    const view = mat4.invert([], mat4.multiply([], mat4.translate([], mat4.create(), position), worldToCamera))

    return {
        position,
        center,
        up,
        fov,
        aspect,
        view,
        farZ,
        nearZ,
        // nearZ: cameraToCenterDistance / 200,
    }
}

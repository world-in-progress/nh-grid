/*
import mapboxgl, { CustomLayerInterface } from 'mapbox-gl'

import NHMap from './map/NHMap'
import GridLayer from './map/GridLayer'

// DOM Configuration //////////////////////////////////////////////////////////////////////////////////////////////////////

// Map
const mapDiv = document.createElement('div')
mapDiv.style.height = '100%'
mapDiv.style.width = '100%'
mapDiv.style.zIndex = '1'
mapDiv.id = 'map'
document.body.appendChild(mapDiv)

const canvas2d = document.createElement('canvas')
canvas2d.id = "canvas2d"
document.body.appendChild(canvas2d)

// Start Dash /////////////////////////////////////////////////////////////////////////////////////////////////////

mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg'

const map = new NHMap({
    // style: 'mapbox://styles/ycsoku/cm3zhjxbs00pa01sd6hx7grtr',
    style: 'mapbox://styles/ycsoku/clrjfv4jz00pe01pdfxgshp6z',
    center: [114.051537, 22.446937],
    projection: 'mercator',
    container: 'map',
    antialias: true,
    maxZoom: 22,
    zoom: 11

}).on('load', () => {

    const gridLayer = new GridLayer(
        map,
        'ESRI:102140',
        [64, 64],
        [
            [2, 2],
            [2, 2],
            [2, 2],
            [2, 2],
            [2, 2],
            [1, 1]
        ],
        [
            808357.5000000000000000,
            824117.5000000000000000,
            838897.5000000000000000,
            843902.5000000000000000,
        ],
        {
            maxGridNum: 4096 * 4096
        }
    )

    map.addLayer(gridLayer as unknown as CustomLayerInterface)
})
*/


import mapboxgl from "mapbox-gl"
import NHLayerGroup from "./map2/NHLayerGroup"
import GridLayer from "./map2/layers/GridLayer"

// DOM Configuration //////////////////////////////////////////////////////////////////////////////////////////////////////

// Map
const mapDiv = document.createElement('div')
mapDiv.style.height = '100%'
mapDiv.style.width = '100%'
mapDiv.style.zIndex = '1'
mapDiv.id = 'map'
document.body.appendChild(mapDiv)

const canvas2d = document.createElement('canvas')
canvas2d.id = "canvas2d"
document.body.appendChild(canvas2d)

// Start Dash /////////////////////////////////////////////////////////////////////////////////////////////////////

mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg'

const map = new mapboxgl.Map({
    // style: 'mapbox://styles/ycsoku/cm3zhjxbs00pa01sd6hx7grtr',
    style: 'mapbox://styles/ycsoku/clrjfv4jz00pe01pdfxgshp6z',
    center: [114.051537, 22.446937],
    projection: 'mercator',
    container: 'map',
    antialias: true,
    maxZoom: 22,
    zoom: 11

}).on('load', () => {

    const gridLayer = new GridLayer(
        map,
        'ESRI:102140',
        [64, 64],
        [
            [2, 2],
            [2, 2],
            [2, 2],
            [2, 2],
            [2, 2],
            [1, 1]
        ],
        [
            808357.5000000000000000,
            824117.5000000000000000,
            838897.5000000000000000,
            843902.5000000000000000,
        ],
        {
            maxGridNum: 4096 * 4096
        }
    )
    // map.addLayer(gridLayer as unknown as CustomLayerInterface)

    const layerGroup = new NHLayerGroup()
    layerGroup.addLayer(gridLayer)

    map.addLayer(layerGroup)



})
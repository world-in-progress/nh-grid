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

// Start Dash /////////////////////////////////////////////////////////////////////////////////////////////////////

mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg'


const map = new NHMap({
    style: 'mapbox://styles/ycsoku/cm3zhjxbs00pa01sd6hx7grtr',
    center: [ 114.051537, 22.446937 ],
    projection: 'mercator',
    container: 'map',
    antialias: true,
    maxZoom: 22,
    zoom: 11

}).on('load', () => {

    const gridLayer = new GridLayer({
        map,
        maxGridNum: 4096 * 4096,
        srcCS: 'ESRI:102140',
        subdivideRules: [
            // [1018, 382],
            [4, 2],
            [255, 200],
            // [20, 10],
            // [51, 40],
            [3, 3],
            // [3, 3],
            // [2, 2],
            // [2, 2],
            // [2, 2],
            // [2, 2],
            // [2, 2],
            // [2, 2],
            // [2, 2],
            // [2, 2],
            [1, 1]
        ],
        boundaryCondition: [
            // 113.9031065683563781, 22.3574937445505597, 114.1999667438311548, 22.5363807916184804
            808357.5000000000000000, 824117.5000000000000000, 838897.5000000000000000, 843902.5000000000000000        
    
        ]
    })

    map.addLayer(gridLayer as unknown as CustomLayerInterface)
})


import "./attribute.css"
import "./loading.css"


const grid_attribute_cache = Array.from({ length: 10 }, () => {
    return {
        height: -9999,
        type: 0
    }
})

const edge_attribute_cache = Array.from({ length: 10 }, () => {
    return {
        height: -9999,
        type: 0
    }
})

const activedElement = {
    dom: null as HTMLDivElement | null,
    id: -1, // storage id or edge id
    height: -9999,
    type: 0,
    t: 0, // 0: grid, 1: edge
}

const genEdgeHTML = (edgeSide: string, edgeIds: Array<number>) => {
    const rowcol = edgeSide === "top" || edgeSide === "bottom" ? "row" : "col"
    let html = `<div class="${edgeSide} ${rowcol}" id="${edgeSide}">\n`
    edgeIds.forEach(eId => {
        html += `<div class="edge" data-eId="${eId}"></div>\n`
    })
    html += "</div>\n"
    return html
}

const genPropHTML = (ID: number, height: number, type: number) => {
    //ID is storage id or edge id
    return `
    <div class="property col">
      <div class="property-type f-center" id="attr_type" data-ID="${ID}">Grid</div>
      <div class="property-block row ">
        <div class="text">height</div>
        <input class="property-input" type="number" id="height" value="${height}">
      </div>
      <div class="property-block row ">
        <div class="text">type</div>
        <input class="property-input" type="number" id="type" value="${type}">
      </div>
    </div>
    `
}

const genHtml = (info: any) => {
    const top = Array.from(info.top) as Array<number>
    const left = Array.from(info.left) as Array<number>
    const bottom = Array.from(info.bottom) as Array<number>
    const right = Array.from(info.right) as Array<number>

    const [height, type] = getInfoFromCache(activedElement.id, activedElement.t)

    const topHtml = genEdgeHTML("top", top)
    const leftHtml = genEdgeHTML("left", left)
    const bottomHtml = genEdgeHTML("bottom", bottom)
    const rightHtml = genEdgeHTML("right", right)

    const edgesHtml = `
        <div id="edges">
            ${topHtml}
            ${leftHtml}
            ${bottomHtml}
            ${rightHtml}
        </div>
    `
    const propHtml = `
        <div class="property col">
          <div class="property-type f-center" id="attr_type" data-ID="${activedElement.id}">Grid</div>
          <div class="property-block row ">
            <div class="text">height</div>
            <input class="property-input" type="number" id="height" value="${height}">
          </div>
          <div class="property-block row ">
            <div class="text">type</div>
            <input class="property-input" type="number" id="type" value="${type}">
          </div>
        </div>
    `

    let html = `
        ${edgesHtml}
        ${propHtml}
    `
    return html
}


const handleEdgeClick = (e: MouseEvent) => {
    if ((e.target as HTMLDivElement).classList.contains("edge")) {
        // deactive last actived element
        if (activedElement.dom) {
            activedElement.dom.classList.remove("actived")
        }
        const attrTypeDom = document.querySelector('#attr_type') as HTMLDivElement
        attrTypeDom.textContent = 'Edge';

        (e.target as HTMLDivElement).classList.add("actived")
        const eID = (e.target as HTMLDivElement).dataset.eid
        activedElement.dom = e.target as HTMLDivElement
        activedElement.id = Number(eID)
        activedElement.t = 1
        const [height, type] = getInfoFromCache(activedElement.id, activedElement.t)
        activedElement.height = height
        activedElement.type = type;

        (document.querySelector('#height') as HTMLInputElement).value = height + '';
        (document.querySelector('#type') as HTMLInputElement).value = type + ''

    }
}

const handleInput = (e: FocusEvent) => {
    const [attr, value] = [
        (e.target as HTMLInputElement).id,
        (e.target as HTMLInputElement).value
    ]
    activedElement[attr as "height" | "type"] = +value
    setCacheInfo(activedElement.id, activedElement.t, activedElement.height, activedElement.type)
}

const updateAttrSetter = (info: any) => {

    //////// parse grid and edge info
    const gridStorageId = info.gridStorageId
    const top = Array.from(info.top)
    const left = Array.from(info.left)
    const bottom = Array.from(info.bottom)
    const right = Array.from(info.right)

    // reset default :: grid clicked
    const [height, type] = getInfoFromCache(gridStorageId, 0) // 0 grid, 1 edge
    activedElement.id = gridStorageId
    activedElement.dom = null
    activedElement.t = 0
    activedElement.height = height
    activedElement.type = type

    // reset grid dom data-id and input value
    const attrTypeDom = document.querySelector('#attr_type') as HTMLDivElement;
    attrTypeDom.dataset.id = gridStorageId;

    (document.querySelector('#height') as HTMLInputElement).value = height + '';
    (document.querySelector('#type') as HTMLInputElement).value = type + '';

    // reset edges dom
    const topHtml = genEdgeHTML("top", top as number[])
    const leftHtml = genEdgeHTML("left", left as number[])
    const bottomHtml = genEdgeHTML("bottom", bottom as number[])
    const rightHtml = genEdgeHTML("right", right as number[])

    const edgesInnerHtml = `
        ${topHtml}
        ${leftHtml}
        ${bottomHtml}
        ${rightHtml}
    `
    const edgesDom = document.querySelector('#edges') as HTMLDivElement
    edgesDom.innerHTML = edgesInnerHtml


}

const setSingleGridAttrSetter = (info: any) => {

    //////// parse grid and edge info
    const gridStorageId = info.gridStorageId
    const top = Array.from(info.top)
    const left = Array.from(info.left)
    const bottom = Array.from(info.bottom)
    const right = Array.from(info.right)

    // default :: grid clicked
    const [height, type] = getInfoFromCache(gridStorageId, 0) // 0 grid, 1 edge
    activedElement.id = gridStorageId
    activedElement.dom = null
    activedElement.t = 0
    activedElement.height = height
    activedElement.type = type

    //////// set HTML
    const html = genHtml({
        top,
        left,
        bottom,
        right
    })
    const attrSetter = document.createElement('div')
    attrSetter.id = 'attrSetter'
    attrSetter.classList.add("property-editor")
    attrSetter.innerHTML = html
    document.body.appendChild(attrSetter)

    //////// set Handler
    // edge click
    // const edgeDoms = ["top", "left", "right", "bottom"].map(id => document.querySelector('#' + id) as HTMLDivElement)
    // edgeDoms.forEach(edgeDom => {
    //     edgeDom.addEventListener('click', handleEdgeClick)
    // })
    const edgeDom = document.querySelector('#edges') as HTMLDivElement
    edgeDom.addEventListener('click', handleEdgeClick)


    // grid click 
    const attrTypeDom = document.querySelector('#attr_type') as HTMLDivElement
    // activedElement.dom = gridDom //default dom
    attrTypeDom.addEventListener('click', e => {
        if (activedElement.dom) {
            activedElement.dom.classList.remove("actived");
        }
        activedElement.dom = (e.target as HTMLDivElement)
        activedElement.id = +(e.target as HTMLDivElement).dataset.id!
        activedElement.t = 0
        const [height, type] = getInfoFromCache(activedElement.id, activedElement.t)
        activedElement.height = height
        activedElement.type = type;
        attrTypeDom.textContent = "Grid";

        (document.querySelector('#height') as HTMLInputElement).value = height + '';
        (document.querySelector('#type') as HTMLInputElement).value = type + ''

    })

    // input focusout
    const attrInputDoms = ["height", "type"].map(id => document.querySelector('#' + id) as HTMLInputElement)
    attrInputDoms.forEach(inputDom => {
        inputDom.addEventListener('focusout', handleInput)
    })
}


const getInfoFromCache = (ID: number, T: number) => {
    let height = 0, type = 0

    if (T === 0) {
        height = grid_attribute_cache[ID].height
        type = grid_attribute_cache[ID].type
    } else {
        height = edge_attribute_cache[ID].height
        type = edge_attribute_cache[ID].type
    }
    return [height, type]
}

const setCacheInfo = (ID: number, T: number, height: number, type: number) => {
    if (T === 0) {
        grid_attribute_cache[ID].height = height
        grid_attribute_cache[ID].type = type
    } else {
        edge_attribute_cache[ID].height = height
        edge_attribute_cache[ID].type = type
    }
}

const initLoadingDOM = () => {
    const loadingDom = document.createElement('div')
    loadingDom.id = 'loading-container'
    loadingDom.innerHTML = `
        <div class="loading"></div>
        <div class="loading-text">Topology Parsing...</div>
    `
    document.body.appendChild(loadingDom)

    return (show: Boolean) => {
        loadingDom.style.display = show ? 'block' : 'none'
    }
}

const main = () => {
    // const a = {
    //     "gridStorageId": 0,
    //     "top": new Set([1, 2, 3]),
    //     "left": new Set([4]),
    //     "bottom": new Set([5]),
    //     "right": new Set([6]),
    // }

    // const b = {
    //     "gridStorageId": 2,
    //     "top": new Set([7]),
    //     "left": new Set([8]),
    //     "bottom": new Set([9]),
    //     "right": new Set([]),
    // }

    // setSingleGridAttrSetter(a)




    const showLoading = initLoadingDOM()

    document.addEventListener('keydown', e => {
        if (e.key === 'p') {
            showLoading(true)
        } else if (e.key === 'o') {
            showLoading(false)
        }
    })
}



main()
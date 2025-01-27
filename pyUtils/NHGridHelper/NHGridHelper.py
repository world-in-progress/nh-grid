import os
import math
import json
from osgeo import ogr, osr

import utils.DemSampler as DS

# Constants ####################################################################################################

EDGE_CODE_NORTH = 0b00
EDGE_CODE_WEST  = 0b01
EDGE_CODE_SOUTH = 0b10
EDGE_CODE_EAST  = 0b11

EDGE_ATTRIBUTE_VERTICAL = 0b10
EDGE_ATTRIBUTE_HORIZONTAL = 0b01

# Helpers ######################################################################################################

def lerp(a: float, b: float, t: float):
    
    t = min(max(t, 0.0), 1.0)
    return (1.0 - t) * a + t * b

def distance2D(x1: float, y1: float, x2: float, y2: float):
    
    dx = x1 - x2
    dy = y1 - y2
    return math.sqrt(dx ** 2 + dy ** 2)

# NHGridNode ###################################################################################################

class NHGridNode:
    
    def __init__(self, id: int, level: int, global_id: int, type: int, altitude: float, vertices: list[float], edges: list[list[int]]):
        
        self.id = id
        self.type = type
        self.level = level
        self.edge_ids = edges
        self.altitude = altitude
        self.x_min = vertices[0]
        self.y_min = vertices[1]
        self.x_max = vertices[2]
        self.y_max = vertices[3]
        self.global_id = global_id
        
    def get_bl(self) -> list[float]:
        
        return [ self.x_min, self.y_min ]
        
    def get_br(self) -> list[float]:
        
        return [ self.x_max, self.y_min ]
        
    def get_tl(self) -> list[float]:
        
        return [ self.x_min, self.y_max ]
        
    def get_tr(self) -> list[float]:
        
        return [ self.x_max, self.y_max ]
        
    def get_extent(self) -> list[float]:
        
        return [ self.x_min, self.y_min, self.x_max, self.y_max ]
    
    def get_north_edge_num(self) -> int:
        
        return len(self.edge_ids[EDGE_CODE_NORTH])
    
    def get_west_edge_num(self) -> int:
        
        return len(self.edge_ids[EDGE_CODE_WEST])
    
    def get_south_edge_num(self) -> int:
        
        return len(self.edge_ids[EDGE_CODE_SOUTH])
    
    def get_east_edge_num(self) -> int:
        
        return len(self.edge_ids[EDGE_CODE_EAST])
    
    def get_north_edge_ids(self) -> list[int]:
        
        return self.edge_ids[EDGE_CODE_NORTH]
    
    def get_west_edge_ids(self) -> list[int]:
        
        return self.edge_ids[EDGE_CODE_WEST]
    
    def get_south_edge_ids(self) -> list[int]:
        
        return self.edge_ids[EDGE_CODE_SOUTH]
    
    def get_east_edge_ids(self) -> list[int]:
        
        return self.edge_ids[EDGE_CODE_EAST]
    
    def get_width(self) -> float:
        
        return abs(self.x_max - self.x_min)
    
    def get_height(self) -> float:
        
        return abs(self.y_max - self.y_min)
    
    def get_center(self) -> list[float]:
        
        return [
            (self.x_min + self.x_max) / 2.0,
            (self.y_min + self.y_max) / 2.0
        ]
    
# NHGridEdge ####################################################################################################

class NHGridEdge:
    
    def __init__(self, id: int, key: str, type: int, altitude: float, adjacent_grids: list[int], vertices: list[float]):
        
        self.id = id
        self.key = key
        self.type = type
        self.x1 = vertices[0]
        self.y1 = vertices[1]
        self.x2 = vertices[2]
        self.y2 = vertices[3]
        self.altitude = altitude
        self.grid_ids: list[int | None] = adjacent_grids
            
    def get_p1(self) -> list[float]:
        
        return [ self.x1, self.y1 ]
    
    def get_p2(self) -> list[float]:
        
        return [ self.x2, self.y2 ]
    
    def get_p1_p2(self) -> list[float]:
        
        return [ self.x1, self.y1, self.x2, self.y2 ]
    
    def get_length(self) -> float:
        
        return distance2D(self.x1, self.y1, self.x2, self.y2)
    
    def get_direction(self) -> int:
        
        direction = self.key[0]
        if direction == 'h':
            return EDGE_ATTRIBUTE_HORIZONTAL
        else:
            return EDGE_ATTRIBUTE_VERTICAL
    
    def get_north_grid_id(self) -> int | None:
        return self.grid_ids[EDGE_CODE_NORTH]
    
    def get_west_grid_id(self) -> int | None:
        return self.grid_ids[EDGE_CODE_WEST]
    
    def get_south_grid_id(self) -> int | None:
        return self.grid_ids[EDGE_CODE_SOUTH]
            
    def get_east_grid_id(self) -> int | None:
        return self.grid_ids[EDGE_CODE_EAST]
    
    def get_center(self) -> list[float]:
        
        return [
            (self.x1 + self.x2) / 2.0,
            (self.y1 + self.y2) / 2.0
        ]
    
    @staticmethod
    def get_op_edge_code(edge_code: int) -> int:
        
        if edge_code == EDGE_CODE_NORTH:
            return EDGE_CODE_SOUTH
        
        elif edge_code == EDGE_CODE_WEST:
            return EDGE_CODE_EAST
        
        elif edge_code == EDGE_CODE_SOUTH:
            return EDGE_CODE_NORTH
        
        else:
            return EDGE_CODE_WEST

# NHGridHelper ##################################################################################################

class NHGridHelper:
    
    def __init__(self, path: str):
        
        self.path = path
        with open(path, 'r', encoding='utf-8') as file:
            data = json.load(file)
        
        # Deserialize grid layer attributes
        self.CRS: str = data['CRS']
        self.extent: list[float] = data['extent']
        self.level_infos: list[dict[str, int]] = data['levelInfos']
        self.subdivide_rules: list[list[float]] = data['subdivideRules']
        
        # Deserialize grids
        self.grids: dict[int, NHGridNode] = {}
        for grid_info in data['grids']:
            
            # Parse info
            grid_id: int = grid_info['index']
            grid_type: int = grid_info['type']
            grid_level: int = grid_info['level']
            grid_altitude: float = grid_info['height']
            grid_global_id: int = grid_info['globalId']
            grid_edges: list[list[int]] = grid_info['edges']
            grid_vertices: list[float] = self.create_grid_vertices(grid_global_id, self.level_infos[grid_level]['width'], self.level_infos[grid_level]['height'])
            
            # Create grid
            grid = NHGridNode(
                grid_id,
                grid_level,
                grid_global_id,
                grid_type,
                grid_altitude,
                grid_vertices,
                grid_edges
            )
            self.grids[grid_id] = grid
            
        # Deserialize edges
        self.edges: dict[int, NHGridEdge] = {}
        for edge_info in data['edges']:
            
            # Parse info
            edge_id: int = edge_info['index']
            edge_key: str = edge_info['key']
            edge_type: int = edge_info['type']
            edge_altitude: float = edge_info['height']
            adj_grids: list[int] = edge_info['adjGrids']
            edge_vertices: list[float] = self.create_edge_vertices(edge_key)
            
            # Create edge
            edge = NHGridEdge(
                edge_id,
                edge_key,
                edge_type,
                edge_altitude,
                adj_grids,
                edge_vertices
            )
            self.update_adjacent_grids_along_edge(edge)
            self.edges[edge_id] = edge
                
        # Validate edges in grids
        # for grid in self.grids.values():
        #     north_edges = [ self.get_edge_by_id(edge_id) for edge_id in grid.edge_ids[EDGE_CODE_NORTH] ]
        #     west_edges = [ self.get_edge_by_id(edge_id) for edge_id in grid.edge_ids[EDGE_CODE_WEST] ]
        #     south_edges = [ self.get_edge_by_id(edge_id) for edge_id in grid.edge_ids[EDGE_CODE_SOUTH] ]
        #     east_edges = [ self.get_edge_by_id(edge_id) for edge_id in grid.edge_ids[EDGE_CODE_EAST] ]
            
        #     invalid_n_edges = self.validate_edges(north_edges)
        #     invalid_e_edges = self.validate_edges(west_edges)
        #     invalid_s_edges = self.validate_edges(south_edges)
        #     invalid_w_edges = self.validate_edges(east_edges)
            
        #     if len(invalid_n_edges) != 0:
        #         self.process_invalid_edge(invalid_n_edges)
        #     if len(invalid_e_edges) != 0:
        #         self.process_invalid_edge(invalid_e_edges)
        #     if len(invalid_s_edges) != 0:
        #         self.process_invalid_edge(invalid_s_edges)
        #     if len(invalid_w_edges) != 0:
        #         self.process_invalid_edge(invalid_w_edges)
    
    def create_grid_vertices(self, global_id: int, global_width: int, global_height: int) -> list[float]:
        
        extent = self.extent
        global_u = global_id % global_width
        global_v = math.floor(global_id / global_width)
        
        x_min = lerp(extent[0], extent[2], global_u / global_width)
        y_min = lerp(extent[1], extent[3], global_v / global_height)
        x_max = lerp(extent[0], extent[2], (global_u + 1) / global_width)
        y_max = lerp(extent[1], extent[3], (global_v + 1) / global_height)
        
        return [ x_min, y_min, x_max, y_max ]

    def create_edge_vertices(self, key: str) -> list[float]:
        
        extent = self.extent
        direction = key[0]
        pos_info = key[1:].split('-')
        min = float(pos_info[0]) / float(pos_info[1])
        max = float(pos_info[2]) / float(pos_info[3])
        shared = float(pos_info[4]) / float(pos_info[5])
        
        if direction == 'h':
            min = lerp(extent[0], extent[2], min)
            max = lerp(extent[0], extent[2], max)
            shared = lerp(extent[1], extent[3], shared)
            return [ min, shared, max, shared ]
        else:
            min = lerp(extent[1], extent[3], min)
            max = lerp(extent[1], extent[3], max)
            shared = lerp(extent[0], extent[2], shared)
            return [ shared, min, shared, max ]
        
    def check_edge_code_along_grid(self, edge_id: int, grid: NHGridNode) -> int:
        
        for edge_code, edges in enumerate(grid.edge_ids):
            for _edge_id in edges:
                if edge_id == _edge_id:
                    return edge_code

    def update_adjacent_grids_along_edge(self, edge: NHGridEdge) -> None:
        
        grids = [ None, None, None, None ]
        for grid_id in edge.grid_ids:
            edge_code = self.check_edge_code_along_grid(edge.id, self.grids[grid_id])
            grids[NHGridEdge.get_op_edge_code(edge_code)] = grid_id
        edge.grid_ids = grids
            
    def process_invalid_edge(self, edges: list[NHGridEdge]):
        
        for edge in edges:
            del self.edges[edge.id]
            
            for grid in self.get_grids_adjacent_to_edge(edge):
                for edge_set in grid.edge_ids:
                    if edge.id in edge_set:
                        edge_set.discard(edge.id)
    
    def validate_edges(self, edges: list[NHGridEdge]) -> list[NHGridEdge]:
        
        invalid_edges = set()

        if len(edges) == 1:
            return list(invalid_edges)
        
        for i in range(len(edges)):
            for j in range(len(edges)):
                if i == j:
                    continue
                
                edge1: NHGridEdge = edges[i]
                edge2: NHGridEdge = edges[j]
                if self.is_edges_overlapped(edge1, edge2):
                    if None in edge1.grid_ids:
                        invalid_edges.add(edge1)
        return list(invalid_edges)
    
    def is_edges_overlapped(self, edge1: NHGridEdge, edge2: NHGridEdge) -> bool:
        
        [ x11, y11, x12, y12 ] = edge1.get_p1_p2()
        [ x21, y21, x22, y22 ] = edge2.get_p1_p2()
        
        if edge1.get_direction() == EDGE_ATTRIBUTE_HORIZONTAL:
            p1_min, p1_max = sorted((x11, x12))
            p2_min, p2_max = sorted((x21, x22))
        else:
            p1_min, p1_max = sorted((y11, y12))
            p2_min, p2_max = sorted((y21, y22))
        
        if p1_max > p2_min and p1_min < p2_max:
            return True
        if p1_min <= p2_min and p1_max >= p2_max:
            return True
        return False
    
    def get_grid_by_id(self, id: int) -> NHGridNode:
        
        return self.grids.get(id, None)

    def get_edge_by_id(self, id: int) -> NHGridEdge:
        
        return self.edges.get(id, None)
    
    def get_grids_adjacent_to_edge(self, edge: NHGridEdge) -> list[NHGridNode]:
        
        return [ self.grids[grid_id] for grid_id in edge.grid_ids if grid_id is not None ]
    
    def get_edges_belong_to_grid(self, grid: NHGridNode) -> list[NHGridEdge]:
            
        return [ self.edges[edge_id] for edge_set in grid.edge_ids for edge_id in edge_set ]
    
    def export(self, output_path: str, dem_path: str = '', invalid_data: float = -9999):
        
        if not os.path.exists(output_path):
            os.makedirs(output_path)
        
        if dem_path != '':
            sampler = DS.DemSampler(dem_path, invalid_data)
        
        gridInfo = ''
        for id in self.grids:
            grid = self.grids[id]
            
            left_edge_num = grid.get_west_edge_num()
            left_edge_ids = ', '.join(map(str, [id + 1 for id in grid.get_west_edge_ids()]))
            
            right_edge_num = grid.get_east_edge_num()
            right_edge_ids = ', '.join(map(str, [id + 1 for id in grid.get_east_edge_ids()]))
            
            bottom_edge_num = grid.get_south_edge_num()
            bottom_edge_ids = ', '.join(map(str, [id + 1 for id in grid.get_south_edge_ids()]))
            
            top_edge_num = grid.get_north_edge_num()
            top_edge_ids = ', '.join(map(str, [id + 1 for id in grid.get_north_edge_ids()]))
            
            center_point = grid.get_center()
            center = ', '.join(map(str, [ *center_point, sampler.sampling(*center_point) if grid.altitude == invalid_data else grid.altitude ]))
            
            gridInfo += f'{id + 1}, {left_edge_num}, {right_edge_num}, {bottom_edge_num}, {top_edge_num}, {left_edge_ids}, {right_edge_ids}, {bottom_edge_ids}, {top_edge_ids}, {center}, {grid.type}\n'
                
        with open(os.path.join(output_path, 'ne.txt'), 'w', encoding='utf-8') as file:
            file.write(gridInfo)
        
        edge_info = ''
        for id in self.edges:
            edge = self.edges[id]
            
            direction = edge.get_direction()
            
            west_id = edge.get_west_grid_id()
            left_grid_id = west_id + 1 if west_id is not None else 0
            
            east_id = edge.get_east_grid_id()
            right_grid_id = east_id + 1 if east_id is not None else 0
            
            north_id = edge.get_north_grid_id()
            top_grid_id = north_id + 1 if north_id is not None else 0
            
            south_id = edge.get_south_grid_id()
            bottom_grid_id = south_id + 1 if south_id is not None else 0
            
            center_point = edge.get_center()
            center = ', '.join(map(str, [ *center_point, sampler.sampling(*center_point) if edge.altitude == invalid_data else edge.altitude ]))
            
            distance = edge.get_length()
            
            edge_info += f'{id + 1}, {direction}, {left_grid_id}, {right_grid_id}, {bottom_grid_id}, {top_grid_id}, {distance}, {center}, {edge.type}\n'
        
        with open(os.path.join(output_path, 'ns.txt'), 'w', encoding='utf-8') as file:
            file.write(edge_info)
            
    def export_shp(self, output_path: str, EPSG_code: int, dem_path: str = '', invalid_data: float = -9999):
        
        if not os.path.exists(os.path.dirname(output_path)):
            os.makedirs(output_path)
        
        driver = ogr.GetDriverByName('ESRI Shapefile')
        data_source = driver.CreateDataSource(output_path)
        
        spatial_ref = osr.SpatialReference()
        spatial_ref.ImportFromEPSG(EPSG_code)
        
        layer = data_source.CreateLayer('NHGridNode', spatial_ref, ogr.wkbPolygon)
        field_id = ogr.FieldDefn('ID', ogr.OFTInteger)
        layer.CreateField(field_id)
        
        for id in self.grids:
            grid = self.grids[id]
            
            ring = ogr.Geometry(ogr.wkbLinearRing)
            ring.AddPoint(grid.x_min, grid.y_min)
            ring.AddPoint(grid.x_max, grid.y_min)
            ring.AddPoint(grid.x_max, grid.y_max)
            ring.AddPoint(grid.x_min, grid.y_max)
            ring.AddPoint(grid.x_min, grid.y_min)
            
            polygon = ogr.Geometry(ogr.wkbPolygon)
            polygon.AddGeometry(ring)
            
            feature = ogr.Feature(layer.GetLayerDefn())
            feature.SetGeometry(polygon)
            feature.SetField('ID', grid.id + 1)
            
            layer.CreateFeature(feature)
            
            feature.Destroy()
            polygon.Destroy()
        
        data_source.Destroy()

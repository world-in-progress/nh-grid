import os
import math
import json

import utils.DemSampler as util

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
    
    def __init__(self, extent: list[float], id: int, x_min_percent: list[int], y_min_percent: list[int], x_max_percent: list[int], y_max_percent: list[int]):
        
        self.id = id
        self.x_min = lerp(extent[0], extent[2], x_min_percent[0] / x_min_percent[1])
        self.x_max = lerp(extent[0], extent[2], x_max_percent[0] / x_max_percent[1])
        self.y_min = lerp(extent[1], extent[3], y_min_percent[0] / y_min_percent[1])
        self.y_max = lerp(extent[1], extent[3], y_max_percent[0] / y_max_percent[1])
        
        self.edge_ids = [
            set(), set(), set(), set()
        ]
    
    def add_edge(self, edge_code: int, edge_id: int):
        
        self.edge_ids[edge_code].add(edge_id)
        
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
        
        return list(self.edge_ids[EDGE_CODE_NORTH])
    
    def get_west_edge_ids(self) -> list[int]:
        
        return list(self.edge_ids[EDGE_CODE_WEST])
    
    def get_south_edge_ids(self) -> list[int]:
        
        return list(self.edge_ids[EDGE_CODE_SOUTH])
    
    def get_east_edge_ids(self) -> list[int]:
        
        return list(self.edge_ids[EDGE_CODE_EAST])
    
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
    
    def __init__(self, extent: list[float], id: int, adjacent_grids: list[NHGridNode | None], min_percent: list[int], max_percent: list[int], edge_code: int):
        
        self.id = id
        self.edge_code = edge_code
        self.grid_ids: list[int] = [ None, None ]
        
        # Add grid id to edge
        for index, grid in enumerate(adjacent_grids):
            if grid is not None:
                self.grid_ids[index] = grid.id
        
        # North edge of adjacent_grids[0]
        if edge_code == EDGE_CODE_NORTH:
            self.y1 = self.y2 = adjacent_grids[1].y_min if adjacent_grids[0] is None else adjacent_grids[0].y_max
            self.x1 = lerp(extent[0], extent[2], min_percent[0] / min_percent[1])
            self.x2 = lerp(extent[0], extent[2], max_percent[0] / max_percent[1])
        
        # West edge of adjacent_grids[0]
        elif edge_code == EDGE_CODE_WEST:
            self.x1 = self.x2 = adjacent_grids[1].x_max if adjacent_grids[0] is None else adjacent_grids[0].x_min
            self.y1 = lerp(extent[1], extent[3], min_percent[0] / min_percent[1])
            self.y2 = lerp(extent[1], extent[3], max_percent[0] / max_percent[1])
            
        # South edge of adjacent_grids[0]
        elif edge_code == EDGE_CODE_SOUTH:
            self.y1 = self.y2 = adjacent_grids[1].y_max if adjacent_grids[0] is None else adjacent_grids[0].y_min
            self.x1 = lerp(extent[0], extent[2], min_percent[0] / min_percent[1])
            self.x2 = lerp(extent[0], extent[2], max_percent[0] / max_percent[1])
        
        # East edge of adjacent_grids[0]
        elif edge_code == EDGE_CODE_EAST:
            self.x1 = self.x2 = adjacent_grids[1].x_min if adjacent_grids[0] is None else adjacent_grids[0].x_max
            self.y1 = lerp(extent[1], extent[3], min_percent[0] / min_percent[1])
            self.y2 = lerp(extent[1], extent[3], max_percent[0] / max_percent[1])
            
    def get_p1(self) -> list[float]:
        
        return [ self.x1, self.y1 ]
    
    def get_p2(self) -> list[float]:
        
        return [ self.x2, self.y2 ]
    
    def get_p1_p2(self) -> list[float]:
        
        return [ self.x1, self.y1, self.x2, self.y2 ]
    
    def get_length(self) -> float:
        
        return distance2D(self.x1, self.y1, self.x2, self.y2)
    
    def get_direction(self) -> int:
        
        if self.edge_code == EDGE_CODE_NORTH or self.edge_code == EDGE_CODE_SOUTH:
            return EDGE_ATTRIBUTE_HORIZONTAL
        else:
            return EDGE_ATTRIBUTE_VERTICAL
    
    def get_north_grid_id(self) -> int | None:
        
        if self.edge_code == EDGE_CODE_SOUTH:
            return self.grid_ids[0]
        elif self.edge_code == EDGE_CODE_NORTH:
            return self.grid_ids[1]
        else:
            return None
    
    def get_west_grid_id(self) -> int | None:
        
        if self.edge_code == EDGE_CODE_EAST:
            return self.grid_ids[0]
        elif self.edge_code == EDGE_CODE_WEST:
            return self.grid_ids[1]
        else:
            return None
    
    def get_south_grid_id(self) -> int | None:
        
        if self.edge_code == EDGE_CODE_NORTH:
            return self.grid_ids[0]
        elif self.edge_code == EDGE_CODE_SOUTH:
            return self.grid_ids[1]
        else:
            return None
            
    def get_east_grid_id(self) -> int | None:
        
        if self.edge_code == EDGE_CODE_WEST:
            return self.grid_ids[0]
        elif self.edge_code == EDGE_CODE_EAST:
            return self.grid_ids[1]
        else:
            return None
    
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
        
        # Deserialize extent
        self.extent = data['extent']
        
        # Deserialize grids
        self.grids: dict[int, NHGridNode] = {}
        for grid_info in data['grids']:
            
            # Parse info
            grid_id = grid_info['id']
            
            # Create grid
            grid = NHGridNode(
                self.extent,
                grid_id,
                grid_info['xMinPercent'],
                grid_info['yMinPercent'],
                grid_info['xMaxPercent'],
                grid_info['yMaxPercent'],
            )
            self.grids[grid_id] = grid
            
        # Deserialize edges
        self.edges: dict[int, NHGridEdge] = {}
        for edge_info in data['edges']:
            
            # Parse info
            edge_id = edge_info['id']
            edge_code = edge_info['edgeCode']
            op_edge_code = NHGridEdge.get_op_edge_code(edge_code)
            
            adj_grids: list[NHGridNode] = [ None, None ]
            for (index, grid_id) in enumerate(edge_info['adjGrids']):
                if grid_id is not None:
                    adj_grids[index] = self.grids[grid_id]
            
            # Create edge
            edge = NHGridEdge(
                self.extent,
                edge_id,
                adj_grids,
                edge_info['minPercent'],
                edge_info['maxPercent'],
                edge_code,
            )
            self.edges[edge_id] = edge
            
            # Add edge id to grids
            if adj_grids[0] is not None:
                adj_grids[0].add_edge(edge_code, edge_id)
            if adj_grids[1] is not None:
                adj_grids[1].add_edge(op_edge_code, edge_id)
    
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
            sampler = util.DemSampler(dem_path, invalid_data)
        
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
            center = ', '.join(map(str, [ *center_point, sampler.sampling(*center_point) ]))
            
            gridInfo += f'{id + 1}, {left_edge_num}, {right_edge_num}, {bottom_edge_num}, {top_edge_num}, {left_edge_ids}, {right_edge_ids}, {bottom_edge_ids}, {top_edge_ids}, {center}\n'
                
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
            center = ', '.join(map(str, [ *center_point, sampler.sampling(*center_point) ]))
            
            distance = edge.get_length()
            
            edge_info += f'{id + 1}, {direction}, {left_grid_id}, {right_grid_id}, {top_grid_id}, {bottom_grid_id}, {distance}, {center}\n'
        
        with open(os.path.join(output_path, 'ns.txt'), 'w', encoding='utf-8') as file:
            file.write(edge_info)

# Demo ##########################################################################################################

if __name__ == '__main__':
    
    """ 
    ---- Demo for Python lib NHGridHelper ----
    
    'gridInfo.json' is a serialization file generated by 'NHGrid JS'.
    
    This demo shows how to use 'NHGridHelper' to obtain all useful topology information in 'gridInfo.json'.
    
    This demo is based on Grid 4 in 'gridInfo.json'.
    
    Grid 4 looks like:
    
    ----|----- Edge 16 -----|----
        |                   |     
        |                Edge 19  
        |                   |    
    Edge 17     Grid 4      |----
        |                   |    
        |                Edge 18  
        |                   |     
    ----|----- Edge 12 -----|----
        |                   |
         
    Note: Edge 16 is part of the Top Boundary.
    
    """
    
    # Initialize grid helper by gridInfo.json
    helper = NHGridHelper('./testRes/gridInfo.json')
    
    # Get Grid 4 by id
    grid_4 = helper.get_grid_by_id(4)
    
    # Grid 4 can also be obtained through topology
    edge_16 = helper.get_edge_by_id(16)
    grid_4 = helper.get_grids_adjacent_to_edge(edge_16)[0]
    
    # Get id of Grid 4
    grid_id = grid_4.id
    
    # Get extent of Grid 4
    extent = grid_4.get_extent()
    
    # Get width and height of Grid 4
    width = grid_4.get_width()
    height = grid_4.get_height()
    
    # Get north edge information of Grid 4
    north_edge_num = grid_4.get_north_edge_num()
    north_edge_ids = grid_4.get_north_edge_ids()
    
    # Get west edge information of Grid 4
    west_edge_num = grid_4.get_west_edge_num()
    west_edge_ids = grid_4.get_west_edge_ids()
    
    # Get south edge information of Grid 4
    south_edge_num = grid_4.get_south_edge_num()
    south_edge_ids = grid_4.get_south_edge_ids()
    
    # Get east edge information of Grid 4
    east_edge_num = grid_4.get_east_edge_num()
    east_edge_ids = grid_4.get_east_edge_ids()
    
    print('\n------ Grid Info ------\n')
    print(f'Grid ID: {grid_id}\n\nGrid Extent: {extent}\n\nGrid Width: {width}\n\nGrid Height: {height}\n\nNorth Edge Num: {north_edge_num}\n\nNorth Edge IDs: {north_edge_ids}\n\nWest Edge Num: {west_edge_num}\n\nWest Edge IDs: {west_edge_ids}\n\nSouth Edge Num: {south_edge_num}\n\nSouth Edge IDs: {south_edge_ids}\n\nEast Edge Num: {east_edge_num}\n\nEast Edge IDs: {east_edge_ids}\n\n\nEdge List:')
    
    # Get edges adjacent to Grid 4 based on topology
    edges = helper.get_edges_belong_to_grid(grid_4)
    
    # Edges can also be obtained through id
    edges = [ helper.get_edge_by_id(id) for id in [ *north_edge_ids, *west_edge_ids, *south_edge_ids, *east_edge_ids ] ]
    
    for edge in edges:
        
        # Get id of this edge
        edge_id = edge.id
        
        # Get direction of this edge (Horizontal: 1, Vertical: 2)
        edge_direction = edge.get_direction()
        
        # Get length of this edge
        edge_length = edge.get_length()
        
        # Get point 1 and point 2 of this edge
        point_1 = edge.get_p1()
        point_2 = edge.get_p2()
        
        # Point 1 and point 2 can also be obtained at one time
        points = edge.get_p1_p2()
        point_1, point_2 = points[:2], points[2:]
        
        # Get id of the north grid adjacent to this edge (if no grid, return None)
        north_grid_id = edge.get_north_grid_id()
        
        # Get id of the west grid adjacent to this edge (if no grid, return None)
        west_grid_id = edge.get_west_grid_id()
        
        # Get id of the south grid adjacent to this edge (if no grid, return None)
        south_grid_id = edge.get_south_grid_id()
        
        # Get id of the east grid adjacent to this edge (if no grid, return None)
        east_grid_id = edge.get_east_grid_id()
        
        # Collect all adjacent grid ids and remove invalid grid id (None)
        adj_grid_ids = [ id for id in [ north_grid_id, west_grid_id, south_grid_id, east_grid_id ] if id is not None ]
        
        # These grid ids can also be obtained through topology (without direction information)
        adjacent_grids = helper.get_grids_adjacent_to_edge(edge)
        adj_grid_ids = [ grid.id for grid in adjacent_grids ]
        
        print(f'\n------\n')
        print(f'Edge ID: {edge_id}\n\nEdge Length: {edge_length}\n\nPoint1: {point_1}\n\nPoint2: {point_2}\n\nAdjacent Grid IDs: {adj_grid_ids}\n')

 
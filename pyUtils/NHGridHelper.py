import json

# Constants ####################################################################################################

EDGE_CODE_NORTH = 0b00
EDGE_CODE_WEST  = 0b01
EDGE_CODE_SOUTH = 0b10
EDGE_CODE_EAST  = 0b11

# Helpers ######################################################################################################

def lerp(a: float, b: float, t: float):
    
    t = min(max(t, 0.0), 1.0)
    return (1.0 - t) * a + t * b

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

# NHGridEdge ####################################################################################################

class NHGridEdge:
    
    def __init__(self, extent: list[float], id: int, adjacent_grids: list[NHGridNode | None], min_percent: list[int], max_percent: list[int], edge_code: int):
        
        self.id = id
        self.edge_code = edge_code
        self.grid_ids: list[int] = []
        
        # Add grid id to edge
        for grid in adjacent_grids:
            if grid is not None:
                self.grid_ids.append(grid.id)
        
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
        
        grids = []
        for grid_id in edge.grid_ids:
            grids.append(self.grids[grid_id])
        
        return grids
    
    def get_edges_belong_to_grid(self, grid: NHGridNode) -> list[NHGridEdge]:
        
        edges = []
        for edge_set in grid.edge_ids:
            for edge_id in edge_set:
                edges.append(self.edges[edge_id])
            
        return edges

# Demo ##########################################################################################################

if __name__ == '__main__':
    
    helper = NHGridHelper('./testRes/gridInfo.json')
    
    grid_0 = helper.get_grid_by_id(4)
    edges = helper.get_edges_belong_to_grid(grid_0)
    
    print('\n------ Grid Info ------\n')
    print(f'Grid ID: {grid_0.id}\n\nExtent: {grid_0.get_extent()}\n\nEdge List:')
    
    for edge in edges:
        
        edge_id = edge.id
        
        # p1 & p2 can also be obtained through <edge.get_p1_p2()>
        p1 = edge.get_p1()
        p2 = edge.get_p2()
        
        adjacent_grids = helper.get_grids_adjacent_to_edge(edge)
        adj_grid_ids = [ grid.id for grid in adjacent_grids ]
        
        print(f'\n------\n')
        print(f'Edge ID: {edge_id}\n\nPoint1: {p1}\n\nPoint2: {p2}\n\nAdjacent Grid IDs: {adj_grid_ids}\n')
 
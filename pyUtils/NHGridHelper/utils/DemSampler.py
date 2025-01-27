import numpy as np
from osgeo import gdal

# Helpers ######################################################################################################

def lerp(a: float, b: float, t: float):
    
    t = min(max(t, 0.0), 1.0)
    return (1.0 - t) * a + t * b

# DemSampler ######################################################################################################

class DemSampler:
    
    def __init__(self, path: str, invalid_data = -9999):
        
        self.path = path
        self.dataset = gdal.Open(path)
        self.invalid_data = invalid_data
    
        trans = self.dataset.GetGeoTransform()
        self.origin_x = trans[0]
        self.origin_y = trans[3]
        self.pixel_width = trans[1]
        self.pixel_height = trans[5]
        self.width = self.dataset.RasterXSize
        self.height = self.dataset.RasterYSize
        
        band = self.dataset.GetRasterBand(1)
        self.data = np.array(band.ReadAsArray(0, 0, self.width, self.height).astype(np.float32))
    
    def sampling(self, x: float, y: float):
        
        def clamp(_x, _max):
            return min(_max, max(_x, 0))
        
        u = (x - self.origin_x) / self.pixel_width
        v = (y - self.origin_y) / self.pixel_height
        uv_desc = [ int(v), int(u), v % 1, u % 1 ]
        
        y = uv_desc[0]
        x = uv_desc[1]
        ym1 = int(clamp(y - 1, self.height - 1))
        xm1 = int(clamp(x - 1, self.width - 1))
        yp1 = int(clamp(y + 1, self.height - 1))
        xp1 = int(clamp(x + 1, self.width - 1))
        
        ratio_y = uv_desc[2]
        ratio_x = uv_desc[3]
        interpolated_pixel = []
        if ratio_y <= 0.5 and ratio_x <= 0.5:
            interpolated_pixel = [xm1, ym1, x, ym1, xm1, y, x, y]
        elif ratio_y <= 0.5 and ratio_x > 0.5:
            interpolated_pixel = [x, ym1, xp1, ym1, x, y, xp1, y]
        elif ratio_y > 0.5 and ratio_x <= 0.5:
            interpolated_pixel = [xm1, y, x, y, xm1, yp1, x, yp1]
        elif ratio_y > 0.5 and ratio_x > 0.5:
            interpolated_pixel = [x, y, xp1, y, x, yp1, xp1, yp1]
        
        z1 = self.data[interpolated_pixel[1]][interpolated_pixel[0]]
        z2 = self.data[interpolated_pixel[3]][interpolated_pixel[2]]
        z3 = self.data[interpolated_pixel[5]][interpolated_pixel[4]]
        z4 = self.data[interpolated_pixel[7]][interpolated_pixel[6]]
        zs = [
            0 if z1 == self.invalid_data else z1,
            0 if z2 == self.invalid_data else z2,
            0 if z3 == self.invalid_data else z3,
            0 if z4 == self.invalid_data else z4,
        ]
        
        p1 = 0
        p2 = 0
        if ratio_y < 0.5 and ratio_x < 0.5:
            p1 = 0.5 + ratio_y
            p2 = 0.5 + ratio_x
        elif ratio_y < 0.5 and ratio_x > 0.5:
            p1 = 0.5 + ratio_y
            p2 = ratio_x - 0.5
        elif ratio_y > 0.5 and ratio_x < 0.5:
            p1 = ratio_y - 0.5
            p2 = 0.5 + ratio_x
        elif ratio_y > 0.5 and ratio_x > 0.5:
            p1 = ratio_y - 0.5
            p2 = ratio_x - 0.5
        
        z_left = lerp(zs[0], zs[2], p1)
        z_right = lerp(zs[1], zs[3], p1)
        return lerp(z_left, z_right, p2)

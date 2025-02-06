import os
import shutil
from ...grid import NHGridHelper

# Helpers ##################################################

def create_zip_from_folder(source_folder: str, output_zip_file: str):
    
    if os.path.exists(output_zip_file + '.zip'):
        return
    
    shutil.make_archive(output_zip_file, 'zip', source_folder)
    
# Processors ##################################################

DIR_DEM_RESOURCE = os.path.abspath(os.path.join(os.path.dirname(__file__), 'dem', 'Digital Terrain Model.tif'))

def process_grid_info(serealized_data, output_path):
    
    # Calculate the grid info file path
    file_path = os.path.abspath(os.path.join(output_path, 'gridInfo'))
    output_zip_file = file_path
    zip_name = 'gridInfo.zip'
    
    # Make directory for file path
    if not os.path.exists(file_path):
        os.makedirs(file_path)
    
    # Process the grid info json by the serialized data to file path
    helper = NHGridHelper(serealized_data)
    helper.export(file_path, DIR_DEM_RESOURCE)
    create_zip_from_folder(file_path, output_zip_file)
    
    return zip_name

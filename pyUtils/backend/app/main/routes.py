import os
import util
import backend.config
from NHGridHelper import NHGridHelper as NH
from backend.app.main import bp
from flask import jsonify, render_template, request, send_file

######################################## API for NHGrid ########################################

@bp.route('/')
def index():

    return render_template('index.html')

@bp.route('/process', methods=[ 'POST' ])
def grid_info_json_process():

    # Reset DIR_OUTPUT
    if (os.path.exists(backend.config.DIR_OUTPUT)):
        util.delete_folder_contents(backend.config.DIR_OUTPUT)
    
    # Process the grid info json by the serialized data
    serealized_data = request.get_json()
    helper = NH(serealized_data)
    helper.export(backend.config.DIR_OUTPUT, backend.config.DIR_DEM)
    util.create_zip_from_folder(backend.config.DIR_OUTPUT, 'gridInfo.zip')
    
    return jsonify({
        'status': 200,
        'message': 'Ready for Download'
    })     

@bp.route('/download', methods=[ 'GET' ]) 
def download_processed_zip():

    # Calc the download path
    file_path = os.path.join(backend.config.DIR_OUTPUT, 'gridInfo.zip')
    
    # Case file not found
    if not os.path.exists(file_path):
        return jsonify({
            'status': 404,
            'message': 'File not found'
        }), 404
    
    return send_file(file_path, as_attachment=True, download_name='gridInfo.zip')

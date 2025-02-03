import os,sys,re,time
import backend.config

parentdir = os.path.abspath(os.path.join(backend.config.DIR_ROOT)) 
sys.path.insert(0,parentdir) 
import util
from backend.app.main import bp
from NHGridHelper import NHGridHelper as NH
from flask import Response, jsonify, render_template, request, send_file


######################################## API for NHGrid ########################################

@bp.route('/')
def index():

    return render_template('index.html')

@bp.route('/process', methods=[ 'POST' ])
def grid_info_json_process():

    # Calc the download path
    file_path = os.path.join(backend.config.DIR_ROOT, 'gridInfo.zip')

    # Reset DIR_OUTPUT
    if (os.path.exists(backend.config.DIR_OUTPUT)):
        util.delete_folder_contents(backend.config.DIR_OUTPUT)
    if (os.path.exists(file_path)):
        os.remove(file_path)
    
    # Process the grid info json by the serialized data
    print("start processing")
    start = time.time()
    serealized_data = request.get_json()
    helper = NH(serealized_data)
    helper.export(backend.config.DIR_OUTPUT, backend.config.DIR_DEM)
    util.create_zip_from_folder(backend.config.DIR_OUTPUT, file_path)
    end = time.time()
    print("time cost : ", end - start)
    
    return jsonify({
        'status': 200,
        'message': 'Ready for Download'
    })     

@bp.route('/download', methods=[ 'GET' ]) 
def download_processed_zip():

    # Calc the download path
    file_path = os.path.join(backend.config.DIR_ROOT, 'gridInfo.zip')
    
    # Case file not found
    if not os.path.exists(file_path):
        return jsonify({
            'status': 404,
            'message': 'File not found'
        }), 404
    
    range_header = request.headers.get('Range', None)

    # Case file transfer by whole
    if not range_header:
        return send_file(file_path, as_attachment=True, download_name='gridInfo.zip')

    # Case file transfer by range
    match = re.match(r'bytes=(\d+)-(\d+)?', range_header)
    file_size = os.path.getsize(file_path)

    if not match:
        return jsonify({
            'status': 416, # requested range not satisfiable
            'message': 'Invalid Range'
        }), 416

    # Calc the chunk range
    start, end = match.groups()
    start = int(start)
    end = int(end) if end else file_size - 1
    end = min(end, file_size - 1)
    content_length = end - start + 1

    if start >= file_size or end >= file_size or start > end:
        return jsonify({
            'status': 416,
            'message': 'Invalid Range'
        }), 416
    
    response = Response()
    response.status_code = 206 # partial content
    response.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
    response.headers['Content-Length'] = str(content_length)
    response.headers['Content-Type'] = 'application/zip'
    with open(file_path, 'rb') as f:
        f.seek(start)
        response.data = f.read(content_length)

    return response


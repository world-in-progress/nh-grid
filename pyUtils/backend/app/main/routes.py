import os
import backend.config
from backend.app.main import bp
from flask import jsonify, render_template, request, send_file

######################################## Utils ########################################

######################################## Error Handler ########################################

@bp.errorhandler(400)
def not_found(error):
    
    response = jsonify({
        'status': 400,
        'error': 'Bad Request',
        'message': error.description
    })
    return response, 400

@bp.errorhandler(404)
def not_found(error):
    
    response = jsonify({
        'status': 404,
        'error': 'Not Found',
        'message': error.description
    })
    return response, 404

######################################## API for NHGrid ########################################

@bp.route('/')
def index():

    return render_template('index.html')

@bp.route('/process', methods=[ 'POST' ])
def grid_info_json_process():

    #  TODO: Process the request

    download_url = f"{request.scheme}://{request.host}/download"
    
    return jsonify({
        'status': 200,
        'message': 'Ready for Download',
        'download_url': download_url
    })     

@bp.route('/download', methods=[ 'GET' ]) 
def download_processed_zip():

    file_path = os.path.join(backend.config.APP_ROOT, 'output', 'result.zip')
    if not os.path.exists(file_path):
        return jsonify({
            'status': 404,
            'message': 'File not found'
        }), 404
    
    return send_file(file_path, as_attachment=True, download_name='result.zip')

# @bp.route(config.API_VERSION, methods=[ 'GET' ])
# def get_model_case_status():
    
#     case_id = request.args.get('id', type=str)
    
#     status, response = api_handlers[config.API_MC_STATUS](case_id)
#     if status == 200:
#         return response
#     if status == 404:
#         abort(404, description=response)

if __name__ == '__main__':

    print("--------------------------------------")
    bp.run(host='0.0.0.0', port=config.APP_PORT, debug=config.APP_DEBUG)

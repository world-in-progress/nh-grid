import backend.config
from backend.app.main import bp
from flask import jsonify, render_template

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

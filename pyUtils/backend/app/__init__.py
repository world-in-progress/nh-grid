from backend.config import DIR_STATIC, DIR_TEMPLATE
from flask import Flask
from flask_cors import CORS

    
def create_app():
    
    app = Flask(
        'LiquorDynamic-GridMan', 
        template_folder = DIR_TEMPLATE, 
        static_folder = DIR_STATIC,
        static_url_path = '/'
        )
    
    from backend.app.main import bp as main_bp
    app.register_blueprint(main_bp)

    CORS(app)

    return app

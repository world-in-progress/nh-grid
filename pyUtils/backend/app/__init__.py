from backend.config import DIR_STATIC, DIR_TEMPLATE
from flask import Flask
    
def create_app():
    
    app = Flask(
        'LiquorDynamic-GridMan', 
        template_folder = DIR_TEMPLATE, 
        static_folder = DIR_STATIC,
        static_url_path = '/'
        )
    
    from backend.app.main import bp as main_bp
    app.register_blueprint(main_bp)

    return app

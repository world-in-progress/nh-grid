from backend import create_app, APP_PORT, APP_DEBUG
    
if __name__ == '__main__':

    app = create_app()
    
    app.run(host = "0.0.0.0", port = APP_PORT, debug = APP_DEBUG)

import os
import pyUtils.sbms as sbms

DIR_ROOT                        =       os.path.abspath(os.path.join(os.path.dirname(__file__), 'pyUtils'))
DIR_STATIC                      =       os.path.abspath(os.path.join(DIR_ROOT, 'dist'))    
DIR_TEMPLATE                    =       os.path.abspath(os.path.join(DIR_ROOT, 'dist'))    
DIR_MODEL_TRIGGER_RESOURCE      =       os.path.abspath(os.path.join(DIR_ROOT, 'extension'))

if __name__ == '__main__':
    
    # Import grid blueprint
    from pyUtils.extension.gridBP import bp as grid_bp
    
    # Set model trigger
    sbms.registry.update_registry({
        '/v0/nh/grid-process': os.path.join(DIR_MODEL_TRIGGER_RESOURCE, 'gridProcess.trigger.py')
    })
    
    # Set debug mode off
    sbms.config.APP_DEBUG = False
    
    # Run SBMS
    sbms.run(
        'LiquorDynamic-GridMan',
        bps = [ grid_bp ],
        static_url_path = '/',
        static_folder = DIR_STATIC,
        template_folder = DIR_TEMPLATE,
        open_browser = True
    )

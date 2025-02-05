import os
import pyUtils.sbms as sbms
from pyUtils.extension.gridBP import grid_bp

DIR_ROOT                        =       os.path.abspath(os.path.join(os.path.dirname(__file__), 'pyUtils'))
DIR_STATIC                      =       os.path.abspath(os.path.join(DIR_ROOT, 'dist'))    
DIR_TEMPLATE                    =       os.path.abspath(os.path.join(DIR_ROOT, 'dist'))    
DIR_MODEL_TRIGGER_RESOURCE      =       os.path.abspath(os.path.join(DIR_ROOT, 'extension'))

if __name__ == '__main__':
    
    # Set application name
    name = 'LiquorDynamic-GridMan'
    
    # Set extention blueprints
    ex_bps = [ grid_bp ]
    
    # Set model trigger
    sbms.registry.update_registry({
        '/v0/nh/grid-process': os.path.join(DIR_MODEL_TRIGGER_RESOURCE, 'gridProcess.trigger.py')
    })
    
    # Set debug mode off
    sbms.config.APP_DEBUG = False
    
    # Run SBMS
    sbms.run(
        name,
        ex_bps,
        open_browser = True,
        static_url_path = '/',
        static_folder = DIR_STATIC,
        template_folder = DIR_TEMPLATE
    )

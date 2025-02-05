import os
import sbms

DIR_ROOT                        =       os.path.dirname(__file__)
DIR_STATIC                      =       os.path.abspath(os.path.join(DIR_ROOT, 'dist'))    
DIR_TEMPLATE                    =       os.path.abspath(os.path.join(DIR_ROOT, 'dist'))    
DIR_MODEL_TRIGGER_RESOURCE      =       os.path.abspath(os.path.join(DIR_ROOT, 'extension'))

if __name__ == '__main__':
    
    # Import grid blueprint
    from extension.gridBP import bp as grid_bp
    
    # Set model trigger
    sbms.registry.update_registry({
        '/v0/fe/hello': os.path.join(DIR_MODEL_TRIGGER_RESOURCE, 'hello.trigger.py'),
        '/v0/nh/grid-process': os.path.join(DIR_MODEL_TRIGGER_RESOURCE, 'gridProcess.trigger.py')
    })
    
    # Run SBMS
    sbms.run(
        'LiquorDynamic-GridMan',
        bps = [ grid_bp ],
        static_url_path = '/',
        static_folder = DIR_STATIC,
        template_folder = DIR_TEMPLATE,
    )

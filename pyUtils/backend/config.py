import os

APP_PORT                                                =       8000
APP_DEBUG                                               =       True

# API Version           
API_VERSION                                             =       '/v0'

# API for Reverbed Evolution            
API_POST_HYDRODYNAMIC_RESOURCE_GENERATION               =       API_VERSION + '/hydrodynamic/resource/generation'

# Directory Setting         
DIR_ROOT                                                =       os.path.dirname(os.path.abspath(__file__))
DIR_STATIC                                              =       os.path.abspath(os.path.join(DIR_ROOT, '..', 'dist'))    
DIR_TEMPLATE                                            =       os.path.abspath(os.path.join(DIR_ROOT, '..', 'dist'))    
DIR_HTML                                                =       os.path.abspath(os.path.join(DIR_ROOT, '..', 'dist', 'index.html'))

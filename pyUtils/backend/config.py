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
DIR_OUTPUT                                              =       os.path.abspath(os.path.join(DIR_ROOT, '..', 'NHGridHelper', 'output'))
DIR_DEM                                                 =       os.path.abspath(os.path.join(DIR_ROOT, '..', 'NHGridHelper', 'testRes', 'Dem', 'Digital Terrain Model.tif'))
DIR_RESOURCE                                            =       DIR_DEM
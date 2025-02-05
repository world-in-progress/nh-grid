# Development Helpers #########################################################################################
# Import sbms related modules here for develepment purpose

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from sbms import model
    
# Execution Members #########################################################################################

import os
# from ..extension.gridProcess import process_grid_info
from extension.gridProcess import process_grid_info

# MCR Runner #########################################################################################

@model.model_status_controller_sync
def run_(mcr: model.ModelCaseReference):
    serealized_data = mcr.request_json['serialization']
    output_path = os.path.join(mcr.directory, 'result')
    result_file = process_grid_info(serealized_data, output_path)
    return {
        'case-id': mcr.id,
        'result': result_file
    }

# Basic Members #########################################################################################

NAME = 'Grid Process'

CATEGORY = 'NextHydro'

CATEGORY_ALIAS = 'nh'
 
def PARSING(self: model.launcher, request_json: dict, other_dependent_ids: list[str]=[]):
    
    mcr = self.build_model_case(request_json, other_dependent_ids)
    
    return [mcr]

def RESPONSING(self: model.launcher, core_mcr: model.ModelCaseReference, default_pre_mcrs: list[model.ModelCaseReference], other_pre_mcrs: list[model.ModelCaseReference]):
    
    return core_mcr.make_response({
        'case-id': 'TEMPLATE',
        'result': 'NONE'
    })

def RUNNING(self: model.launcher, args: list[str]):
    
    v1 = args[-1]    # model case id
    
    mcr = self.connect_model_case(v1)
    
    run_(mcr)
    
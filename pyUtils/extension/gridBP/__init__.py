from flask import Blueprint, render_template

grid_bp = Blueprint('grid', __name__)

@grid_bp.route('/')
def index():

    return render_template('index.html')

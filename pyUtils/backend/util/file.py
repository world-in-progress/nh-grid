import os
import config
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
    
def get_filenames(path, ignore=[]):
    
    if path is None:
        return []

    if not os.path.exists(path):
        raise FileNotFoundError(f"The file {path} does not exist")
    
    files = os.listdir(path)
    
    return [f for f in files if os.path.isfile(os.path.join(path, f)) and (f not in ignore)]

def get_directories(path, ignore=[]):
    
    if path is None:
        return []
    
    if not os.path.exists(path):
        raise FileNotFoundError(f"The directory {path} does not exist")
    
    directories = os.listdir(path)
    
    return [ d for d in directories if os.path.isdir(os.path.join(path, d)) and (d not in ignore) ]

def rename_file(old_name, new_name, message=None):
    
    if os.path.exists(new_name):
        return

    if not os.path.exists(old_name):
        raise FileNotFoundError(f"The file {old_name} does not exist")
    if os.path.exists(new_name):
        raise FileNotFoundError(f"The file {new_name} has existed")

    os.rename(old_name, new_name)
    
    if not message == None:
        print(message, flush=True)

def delete_folder_contents(folder_path):
    
    if folder_path is None:
        return
    
    if not os.path.exists(folder_path):
        raise FileNotFoundError(f"The file {folder_path} does not exist")
    
    for filename in os.listdir(folder_path):
        file_path = os.path.join(folder_path, filename)
        try:
            if os.path.isfile(file_path) or os.path.islink(file_path):
                os.unlink(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
        except Exception as e:
            print(f"Failed to delete {file_path}. Reason: {e}", flush=True)
    
    os.rmdir(folder_path)

def create_zip_from_folder(source_folder: str, output_zip_file: str):
    
    if os.path.exists(output_zip_file):
        return
    
    filePath = output_zip_file.split('.')[0]
    shutil.make_archive(filePath, 'zip', source_folder)

def generate_large_file(file_path):
    
    with open(file_path, 'rb') as f:
        while chunk := f.read(8192):
            yield chunk
            
def get_dir_size(path):
    
    total_size = 0
    with os.scandir(path) as it:
        for entry in it:
            if entry.is_file():
                total_size += entry.stat().st_size
            elif entry.is_dir():
                total_size += get_dir_size(entry.path)
    return total_size

def get_folders_size_parallel(paths):
    
    sizes = {}
    total_size = 0
    with ThreadPoolExecutor() as executor:
        future_to_path = {executor.submit(get_dir_size, path): path for path in paths}
        for future in as_completed(future_to_path):
            path = future_to_path[future]
            try:
                size = future.result()
                sizes[path] = size / (1024 ** 3)
                total_size += size
            except Exception as e:
                sizes[path] = None
                print(f"An error occurred while processing {path}: {e}", flush=True)
    total_size_gb = total_size / (1024 ** 3)
    return sizes, total_size_gb

def get_folder_size_in_gb(folder_path):
    
    total_size = 0

    for dirpath, dirnames, filenames in os.walk(folder_path):
        
        for filename in filenames:
            total_size += os.path.getsize(os.path.join(dirpath, filename))
    
    total_size_gb = total_size / (1024 ** 3)
    return total_size_gb

def contains_extension(directory_path: str, extension: str = '.txt'):
    
    try:
        for file in os.listdir(directory_path):
            
            if file.endswith(extension):
                return True
        return False
    
    except FileNotFoundError:
        print(f"Error: The directory '{directory_path}' was not found.", flush=True)
        return False
    
    except Exception as e:
        print(f"An error occurred: {e}", flush=True)
        return False
    
def remove_ignore_files_and_directories(directory: str = config.DIR_RESOURCE):
    
    for dirpath, dirnames, filenames in os.walk(directory):
        
        for filename in filenames:
            if filename in config.APP_IGNORE_THINGS:
                os.remove(os.path.join(dirpath, filename))
        
        for dirname in dirnames:
            if dirname in config.APP_IGNORE_THINGS:
                shutil.rmtree(os.path.join(dirpath, dirname))

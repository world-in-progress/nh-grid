import sbms

if __name__ == '__main__':
    # sbms.config.MODEL_REGISTRY['/v0/fe/hello'] = 'example/hello.py'
    sbms.registry.update_registry({'/v0/fe/hello': 'example/hello.py'})
    sbms.run()

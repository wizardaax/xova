import sys, json
sys.path.insert(0, r'D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src')
try:
    from snell_vern_matrix.drive_matrix import DriveMatrix
    dm = DriveMatrix()
    result = {}
    for method in ['get_matrix', 'to_dict', 'summary', 'status', 'get_state', 'get_status']:
        if hasattr(dm, method):
            try:
                result[method] = getattr(dm, method)()
            except Exception as me:
                result[method] = {"error": str(me)}
    if not result:
        result = {'fields': dm.__dict__ if hasattr(dm, '__dict__') else {}}
    print(json.dumps({'ok': True, 'data': result}, default=str))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}))

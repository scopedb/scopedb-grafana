"""Read-only connector checks against any real ScopeDB workspace via Grafana."""
import base64
import datetime as dt
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
env = {}
path = ROOT / os.environ.get('ENV_FILE', '.local/env')
if path.exists():
    for line in path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k] = v.strip("'\"")
env.update(os.environ)
base = env.get('GRAFANA_URL', 'http://127.0.0.1:13000').rstrip('/')
uid = env.get('SCOPEDB_DATASOURCE_UID', 'scopedb')
auth = base64.b64encode((env.get('GRAFANA_USER', 'admin') + ':' + env.get('GRAFANA_PASSWORD', 'admin')).encode()).decode()
local = urllib.parse.urlparse(base).hostname in ('localhost', '127.0.0.1', '::1')
opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if local else urllib.request.build_opener()

def request(method, path, body=None):
    req = urllib.request.Request(base + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json'})
    try:
        with opener.open(req, timeout=75) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())

end = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
start = end - dt.timedelta(hours=1)
iso = lambda t: t.isoformat().replace('+00:00', 'Z')

def query(sql, format='table'):
    return request('POST', '/api/ds/query', {'from': iso(start), 'to': iso(end), 'queries': [{
        'refId': 'A', 'datasource': {'uid': uid, 'type': 'scopedb-scopedb-datasource'},
        'modelVersion': 2, 'format': format, 'queryText': sql, 'intervalMs': 1000, 'maxDataPoints': 100}]})

def frames(sql, format='table'):
    status, body = query(sql, format)
    result = body.get('results', {}).get('A', {})
    assert status == 200 and not result.get('error'), result.get('error', body)
    return result['frames']

def catalog(path, **params):
    status, body = request('GET', f'/api/datasources/uid/{uid}/resources/{path}?' + urllib.parse.urlencode(params))
    assert status == 200, body
    return body

status, health = request('GET', f'/api/datasources/uid/{uid}/health')
assert status == 200 and health.get('status') == 'OK', health
status, ds = request('GET', f'/api/datasources/uid/{uid}')
assert status == 200 and ds['secureJsonFields']['apiKey'] and not ds.get('secureJsonData')
print('PASS connection and secure key storage')
assert frames('SELECT 1 AS connected')[0]['data']['values'] == [[1]]
frame = frames('SELECT $__timeFrom() AS range_start, $__timeTo() AS range_end, $__interval_ms AS bucket_ms')[0]
assert frame['data']['values'] == [[int(start.timestamp()*1000)], [int(end.timestamp()*1000)], [60000]]
print('PASS portable scalar query, UTC range and adaptive interval')
frame = frames("SELECT 'O\\'Reilly\\\\path\\x0a' AS value, contains(['en', 'ja'], 'en'::any) AS selected")[0]
assert frame['data']['values'] == [["O'Reilly\\path\n"], [True]]
print('PASS ScopeQL escaping and array membership for multi-select variables')
series = frames("SELECT $__timeTo() AS time, 'api' AS service, 2.0 AS value UNION ALL SELECT $__timeFrom() AS time, 'worker' AS service, 3.0 AS value UNION ALL SELECT $__timeFrom() AS time, 'api' AS service, 1.0 AS value", 'time_series')
assert len(series) == 2
assert {f['schema']['fields'][1]['labels']['service'] for f in series} == {'api', 'worker'}
for f in series:
    assert f['data']['values'][0] == sorted(f['data']['values'][0])
    assert f['schema']['meta']['type'] == 'timeseries-multi'
    assert f['schema']['meta']['custom']['queryId']
print('PASS labeled time series, sorting and query diagnostics')
frame = frames("SELECT '1969-12-31T23:59:59.500Z'::timestamp AS t SELECT $__timeGroup(t, '1s') AS bucket")[0]
assert frame['data']['values'][0] == [-1000]
print('PASS pre-epoch time bucket boundaries')
for sql, fmt in [('SELECT (', 'table'), ('SELECT 1 AS value', 'time_series'), ('SELECT $missing AS value', 'table')]:
    status, result = query(sql, fmt)
    assert result.get('results', {}).get('A', {}).get('error'), result
print('PASS syntax, format and unresolved variable errors')
databases = catalog('databases')['items']
assert isinstance(databases, list)
inspected = False
for database in databases:
    for schema in catalog('schemas', database=database['name'])['items']:
        tables = catalog('tables', database=database['name'], schema=schema['name'])['items']
        if tables:
            columns = catalog('columns', database=database['name'], schema=schema['name'], table=tables[0]['name'])['columns']
            assert columns and all('name' in c and 'data_type' in c for c in columns)
            inspected = True
            break
    if inspected:
        break
print('PASS catalog discovery' + (' including table columns' if inspected else ' (empty workspace)'))
print('Generic connector smoke passed:', base)

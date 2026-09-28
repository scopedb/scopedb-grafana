"""Real ScopeDB checks through an isolated Grafana OSS instance (never mocks)."""
import base64
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request
import urllib.parse
import uuid

root = pathlib.Path(__file__).resolve().parents[1]
env = {}
env_file = root / os.environ.get("ENV_FILE", ".local/env")
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key] = value.strip("'\"")
env.update(os.environ)
for key in ("SCOPEDB_ENDPOINT", "SCOPEDB_API_KEY"):
    if not env.get(key) or env[key] == "replace-me":
        sys.exit(f"Missing real {key}: set environment or .local/env; no mock fallback")
base = env.get("GRAFANA_URL", "http://127.0.0.1:13000").rstrip("/")
auth = base64.b64encode(("admin:" + env.get("GRAFANA_PASSWORD", "admin")).encode()).decode()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if urllib.parse.urlparse(base).hostname in ("localhost", "127.0.0.1", "::1") else urllib.request.build_opener()

def request(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
          headers={"Authorization": "Basic " + auth, "Content-Type": "application/json"})
    try:
        with opener.open(req, timeout=40) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())

def query(text, start="2026-09-28T00:00:00Z", end="2026-09-28T00:20:00Z"):
    return request("POST", "/api/ds/query", {"from":start,"to":end,"queries":[{
        "refId":"A","datasource":{"uid":"scopedb-poc","type":"scopedb-scopedb-datasource"},
        "modelVersion":1,"queryText":text,"intervalMs":1000,"maxDataPoints":1000}]})

def check(condition, label):
    if not condition:
        sys.exit("FAIL: " + label)
    print("PASS: " + label)

status, health = request("GET", "/api/health")
check(status == 200 and health["version"] == "13.1.0", "Grafana OSS 13.1.0")
status, result = request("GET", "/api/datasources/uid/scopedb-poc/health")
check(status == 200 and result.get("status") == "OK", "Save & Test executes SELECT 1")
status, ds = request("GET", "/api/datasources/uid/scopedb-poc")
check(ds["secureJsonFields"].get("apiKey") and not ds.get("secureJsonData") and env["SCOPEDB_API_KEY"] not in json.dumps(ds), "saved API key is not returned")
check(ds["jsonData"]["endpoint"] == env["SCOPEDB_ENDPOINT"], "uses the requested real ScopeDB endpoint")
text = (root/"provisioning/dashboards/scopedb.json").read_text()
dashboard = json.loads(text)
scopeql = dashboard["panels"][0]["targets"][0]["queryText"]
status, result = query(scopeql)
check(status == 200 and not result["results"]["A"].get("error"), "real ScopeQL Table query succeeds")
frame = result["results"]["A"]["frames"][0]
check([f["name"] for f in frame["schema"]["fields"]] == ["event_time","service","latency_ms","success","detail"], "schema preserved")
values = frame["data"]["values"]
check(values[1] == ["api","worker"] and values[2] == [12,None] and values[3] == [True,False] and values[4] == ["lower boundary",None], "expected values and NULL preserved")
check(values[0] == [1790553600000,1790554200000], "UTC timestamps and inclusive lower/exclusive upper boundary")
status, result = query(scopeql, "2026-09-28T00:10:00Z", "2026-09-28T00:21:00Z")
check(status == 200 and result["results"]["A"]["frames"][0]["data"]["values"][1] == ["worker","api"], "changing time range changes returned rows")
status, result = query(scopeql, "2026-09-29T00:00:00Z", "2026-09-29T00:20:00Z")
check(status == 200 and result["results"]["A"]["frames"][0]["data"]["values"][0] == [], "empty results keep schema")
for label, invalid in [("syntax error", "SELECT ("), ("execution error", "SELECT 'invalid'::int AS value")]:
    status, result = query(invalid)
    check(bool(result.get("results",{}).get("A",{}).get("error")), label + " is reported, not empty success")
uid = "scopedb-invalid-" + uuid.uuid4().hex[:8]
try:
    status, _ = request("POST", "/api/datasources", {"uid":uid,"name":uid,"type":"scopedb-scopedb-datasource","access":"proxy",
            "jsonData":ds["jsonData"],"secureJsonData":{"apiKey":"invalid-poc-key"}})
    check(status == 200, "created isolated invalid-credential test datasource")
    status, result = request("GET", "/api/datasources/uid/" + uid + "/health")
    check(status >= 400 and result.get("status") == "ERROR", "invalid credential fails Save & Test")
finally:
    request("DELETE", "/api/datasources/uid/" + uid)
print("Real integration smoke passed:", base)

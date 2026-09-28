"""Validate every Bluesky dashboard query through the real Grafana backend."""
import base64, concurrent.futures, datetime as dt, json, os, pathlib, time, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
env={}
for line in (ROOT/".local/env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k,v=line.split("=",1);env[k]=v
env.update(os.environ)
base=env.get("GRAFANA_URL","http://127.0.0.1:13000")
auth=base64.b64encode(("admin:"+env.get("GRAFANA_PASSWORD","admin")).encode()).decode()
end=dt.datetime.now(dt.timezone.utc).replace(second=0,microsecond=0)
start=end-dt.timedelta(hours=1)
iso=lambda d:d.isoformat().replace("+00:00","Z")
def request(method,path,body=None):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,method=method,
        headers={"Authorization":"Basic "+auth,"Content-Type":"application/json"})
    try:
        with opener.open(req,timeout=75) as response: return response.status,json.load(response)
    except urllib.error.HTTPError as err: return err.code,json.loads(err.read())
status,health=request("GET","/api/datasources/uid/scopedb-bluesky/health")
assert status==200 and health.get("status")=="OK", "Bluesky health check failed"
status,ds=request("GET","/api/datasources/uid/scopedb-bluesky")
assert status==200 and ds["secureJsonFields"]["apiKey"] and not ds.get("secureJsonData")
assert ds["jsonData"]["endpoint"]==env["BLUESKY_ENDPOINT"]
print("PASS new workspace connection and secure key storage",flush=True)
results={}
def validate(path):
    begin=time.monotonic()
    status,payload=request("POST","/api/ds/query",{"from":iso(start),"to":iso(end),"queries":[{
      "refId":"A","datasource":{"uid":"scopedb-bluesky","type":"scopedb-scopedb-datasource"},
      "queryText":path.read_text(),"modelVersion":1,"intervalMs":300000,"maxDataPoints":10000}]})
    result=payload.get("results",{}).get("A",{})
    assert status==200 and not result.get("error"), path.stem+": "+str(result.get("error",payload))[:1200]
    frame=result["frames"][0]
    columns={f["name"]:v for f,v in zip(frame["schema"]["fields"],frame["data"]["values"])}
    rows=len(next(iter(columns.values())))
    assert rows>0, path.stem+" is empty"
    print(f"PASS {path.stem}: {rows} rows in {time.monotonic()-begin:.2f}s",flush=True)
    return path.stem,columns
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for name,columns in pool.map(validate,sorted((ROOT/"dashboards/bluesky/queries").glob("*.scopeql"))):
        results[name]=columns
kpi=results["overview_kpis"]
assert sum(results["collections"]["events"])==kpi["events"][0]
assert sum(results["operations"]["events"])==kpi["events"][0]
assert sum(results["activity"]["posts"])==kpi["posts"][0]==results["content_kpis"]["posts"][0]
assert sum(results["languages"]["posts"])<=kpi["posts"][0]
assert all(a<=b<=c for a,b,c in zip(results["lag"]["p50_ms"],results["lag"]["p95_ms"],results["lag"]["p99_ms"]))
assert results["activity"]["time"]==sorted(set(results["activity"]["time"]))
for key in ("recent_posts","popular_subjects"):
    assert all(u.startswith("https://bsky.app/profile/did:") and "/post/" in u for u in results[key]["post_url"])
print("PASS totals, time ordering, percentile ordering and post links reconcile",flush=True)
summary={"from":iso(start),"to":iso(end),"endpoint":ds["jsonData"]["endpoint"],"queries":len(results),
 "metrics":{k:v[0] for k,v in kpi.items()},"rows":{k:len(next(iter(v.values()))) for k,v in results.items()}}
(ROOT/"artifacts").mkdir(exist_ok=True)
(ROOT/"artifacts/bluesky-validation.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary,indent=2),flush=True)

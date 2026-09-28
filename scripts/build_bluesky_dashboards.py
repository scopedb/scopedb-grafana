"""Generate native Grafana dashboards for the real bluesky_events table."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
QD=ROOT/"dashboards/bluesky/queries"
QD.mkdir(parents=True,exist_ok=True)
BASE="FROM bluesky_events\nWHERE $__timeFilter(time)"
POSTS=BASE+"\nAND collection = 'app.bsky.feed.post' AND operation = 'create'"
LAG="(received_at - time)::int::float / 1000000.0"
BUCKET="(time::int - time::int % 300000000000)::timestamp"
def total(condition):
    return f"sum(CASE ({condition}) WHEN true THEN 1 ELSE 0 END)"
post="collection = 'app.bsky.feed.post' AND operation = 'create'"
queries={
"overview_kpis":BASE+f"""
AGGREGATE count() AS events, {total(post)} AS posts,
 approx_count_distinct(actor_did) AS active_dids,
 approx_quantile({LAG}, quantile => 0.95) AS p95_lag_ms""",
"activity":BASE+f"""
SELECT {BUCKET} AS bucket, collection, operation
GROUP BY bucket AGGREGATE
 {total("collection = 'app.bsky.feed.post' AND operation = 'create'")} AS posts,
 {total("collection = 'app.bsky.feed.like' AND operation = 'create'")} AS likes,
 {total("collection = 'app.bsky.feed.repost' AND operation = 'create'")} AS reposts,
 {total("collection = 'app.bsky.graph.follow' AND operation = 'create'")} AS follows
SELECT bucket AS time, posts, likes, reposts, follows
ORDER BY time
LIMIT 10000""",
"collections":BASE+"""
SELECT CASE collection
 WHEN 'app.bsky.feed.post' THEN 'Posts'
 WHEN 'app.bsky.feed.like' THEN 'Likes'
 WHEN 'app.bsky.feed.repost' THEN 'Reposts'
 WHEN 'app.bsky.graph.follow' THEN 'Follows'
 ELSE collection END AS event_type
GROUP BY event_type AGGREGATE count() AS events
ORDER BY events DESC
LIMIT 10""",
"languages":POSTS+"""
SELECT CASE (language IS NULL OR language = '') WHEN true THEN 'Unspecified' ELSE language END AS language
GROUP BY language AGGREGATE count() AS posts
ORDER BY posts DESC
LIMIT 10""",
"lag":BASE+f"""
SELECT {BUCKET} AS bucket, {LAG} AS lag_ms
GROUP BY bucket AGGREGATE
 approx_quantile(lag_ms, quantile => 0.5) AS p50_ms,
 approx_quantile(lag_ms, quantile => 0.95) AS p95_ms,
 approx_quantile(lag_ms, quantile => 0.99) AS p99_ms
SELECT bucket AS time, p50_ms, p95_ms, p99_ms
ORDER BY time
LIMIT 10000""",
"operations":BASE+"""
GROUP BY operation AGGREGATE count() AS events
ORDER BY events DESC
LIMIT 10""",
"freshness":BASE+"""
AGGREGATE max(time) AS latest_event, max(received_at) AS latest_received
SELECT latest_event, latest_received""",
"content_kpis":POSTS+f"""
AGGREGATE count() AS posts, approx_count_distinct(actor_did) AS authors,
 {total("external_domain IS NOT NULL AND external_domain != ''")} AS posts_with_links,
 {total("language IS NOT NULL AND language != ''")} AS language_tagged""",
"recent_posts":POSTS+"""
SELECT time, language, text[:160] AS text,
 replace(replace(record_uri, 'at://', 'https://bsky.app/profile/'), '/app.bsky.feed.post/', '/post/') AS post_url,
 actor_did, external_domain
ORDER BY time DESC
LIMIT 50""",
"authors":POSTS+"""
GROUP BY actor_did AGGREGATE count() AS posts, max(time) AS latest_post
ORDER BY posts DESC
LIMIT 12""",
"domains":POSTS+"""
AND external_domain IS NOT NULL AND external_domain != ''
GROUP BY external_domain AGGREGATE count() AS posts
ORDER BY posts DESC
LIMIT 10""",
"popular_subjects":BASE+"""
AND operation = 'create'
AND (collection = 'app.bsky.feed.like' OR collection = 'app.bsky.feed.repost')
AND subject_uri IS NOT NULL AND subject_uri != ''
GROUP BY subject_uri AGGREGATE count() AS observed_interactions,
 sum(CASE collection WHEN 'app.bsky.feed.like' THEN 1 ELSE 0 END) AS likes,
 sum(CASE collection WHEN 'app.bsky.feed.repost' THEN 1 ELSE 0 END) AS reposts
ORDER BY observed_interactions DESC
LIMIT 15
SELECT replace(replace(subject_uri, 'at://', 'https://bsky.app/profile/'), '/app.bsky.feed.post/', '/post/') AS post_url,
 observed_interactions, likes, reposts"""
}
for name,sql in queries.items(): (QD/f"{name}.scopeql").write_text(sql.strip()+"\n")
DS={"type":"scopedb-scopedb-datasource","uid":"scopedb-bluesky"}
COLORS=["#59C2FF","#A78BFA","#6AD7A8","#FFB86B"]
def override(name,**props):
    return {"matcher":{"id":"byName","options":name},"properties":[{"id":k,"value":v} for k,v in props.items()]}
def panel(pid,title,kind,key,x,y,w,h,description="",overrides=None,options=None,defaults=None):
    d={"color":{"mode":"palette-classic"},"unit":"short","decimals":0,"mappings":[],
       "thresholds":{"mode":"absolute","steps":[{"color":"blue","value":None}]}}
    d.update(defaults or {})
    p={"id":pid,"title":title,"description":description,"type":kind,"pluginVersion":"13.1.0",
       "gridPos":{"x":x,"y":y,"w":w,"h":h},"fieldConfig":{"defaults":d,"overrides":overrides or []},"options":options or {}}
    if key:
        p["datasource"]=DS
        p["targets"]=[{"refId":"A","datasource":DS,"modelVersion":1,"queryText":queries[key].strip()}]
    return p
def stat(pid,title,key,y,fields):
    ovs=[override(name,displayName=label,unit=unit,color={"mode":"fixed","fixedColor":COLORS[i%4]}) for i,(name,label,unit) in enumerate(fields)]
    return panel(pid,title,"stat",key,0,y,24,5,overrides=ovs,defaults={"decimals":1},options={
        "reduceOptions":{"calcs":["lastNotNull"],"fields":"","values":False},"orientation":"auto",
        "textMode":"value_and_name","colorMode":"value","graphMode":"none","justifyMode":"center","wideLayout":False,
        "text":{"titleSize":16,"valueSize":40}})
def trend(pid,title,key,x,y,w,h,fields,unit="short",stack=False):
    ovs=[override(name,displayName=label,color={"mode":"fixed","fixedColor":COLORS[i%4]}) for i,(name,label) in enumerate(fields)]
    return panel(pid,title,"timeseries",key,x,y,w,h,
      description="5-minute buckets; boundary buckets may be partial. Missing buckets remain gaps.",
      overrides=ovs,defaults={"unit":unit,"decimals":1 if unit=="ms" else 0,"custom":{
        "drawStyle":"line","lineInterpolation":"linear","lineWidth":2,"fillOpacity":25 if stack else 8,
        "showPoints":"auto","pointSize":4,"spanNulls":False,"axisCenteredZero":False,
        "stacking":{"mode":"normal" if stack else "none","group":"A"},
        "hideFrom":{"tooltip":False,"viz":False,"legend":False}}},
      options={"legend":{"displayMode":"list","placement":"bottom","showLegend":True},"tooltip":{"mode":"multi","sort":"desc"}})
def bars(pid,title,key,x,y,w,h,label):
    return panel(pid,title,"barchart",key,x,y,w,h,options={"orientation":"horizontal","xField":label,
      "showValue":"always","groupWidth":0.75,"barWidth":0.75,"barRadius":0.1,"stacking":"none",
      "legend":{"showLegend":False},"tooltip":{"mode":"single","sort":"none"}},
      defaults={"color":{"mode":"fixed","fixedColor":"#59C2FF"},"custom":{"fillOpacity":85,"lineWidth":0}})
def table(pid,title,key,x,y,w,h,widths=None,labels=None,links=None):
    ovs=[override(name,**{"custom.width":width}) for name,width in (widths or {}).items()]
    ovs.extend(override(name,displayName=label) for name,label in (labels or {}).items())
    ovs.extend(override(name,unit="dateTimeAsIso") for name in ["time","latest_post","latest_event","latest_received"])
    ovs.extend(override(name,links=[{"title":"Open in Bluesky","url":url,"targetBlank":True}]) for name,url in (links or {}).items())
    return panel(pid,title,"table",key,x,y,w,h,overrides=ovs,
      defaults={"unit":"none","custom":{"align":"auto","cellOptions":{"type":"auto"},"filterable":True,"inspect":False}},
      options={"showHeader":True,"cellHeight":"sm","footer":{"show":False},"enablePagination":True})
def header(content):
    return panel(1,"","text",None,0,0,24,2,options={"mode":"markdown","content":content})
value_token="$"+"{__value.raw}"
overview=[
header("**BLUESKY / LIVE OVERVIEW** · Collected events, not a full-network census · UTC · Select or drag a time range to explore"),
stat(2,"Selected time range","overview_kpis",2,[("events","Collected events","short"),("posts","Posts created","short"),("active_dids","Active DIDs ≈","short"),("p95_lag_ms","P95 receive delay ≈","ms")]),
trend(3,"Creation activity · events / 5 min","activity",0,7,16,9,[("posts","Posts"),("likes","Likes"),("reposts","Reposts"),("follows","Follows")],stack=True),
panel(4,"Event mix · all operations","piechart","collections",16,7,8,9,options={
 "pieType":"donut","displayLabels":["percent"],
 "legend":{"displayMode":"table","placement":"bottom","showLegend":True,"values":["value","percent"]},
 "reduceOptions":{"calcs":["lastNotNull"],"fields":"/^events$/","values":True},"tooltip":{"mode":"single","sort":"desc"}}),
bars(5,"Post languages · top 10","languages",0,16,12,9,"language"),
trend(6,"Receive delay · p50 / p95 / p99","lag",12,16,12,9,[("p50_ms","P50"),("p95_ms","P95"),("p99_ms","P99")],unit="ms"),
bars(7,"Operations · create / delete / update","operations",0,25,8,8,"operation"),
table(8,"Latest observed timestamps","freshness",8,25,16,4,labels={"latest_event":"Latest event (UTC)","latest_received":"Latest received (UTC)"}),
panel(9,"How to read this dashboard","text",None,8,29,16,5,options={"mode":"markdown","content":"**Scope:** records in bluesky_events inside the selected UTC window.\n\n**Counts:** collected events, including create / update / delete. Creation activity and language counts use **create** events only.\n\n**Delay:** received_at − time, in milliseconds; percentiles and active DIDs are estimates. This is receive delay, not confirmed database ingest latency."})
]
content=[
header("**BLUESKY / CONTENT EXPLORER** · Observed post creations and interactions · Click post / DID links to open Bluesky"),
stat(2,"Post creation in selected time range","content_kpis",2,[("posts","Posts created","short"),("authors","Authors ≈","short"),("posts_with_links","Posts with external links","short"),("language_tagged","Posts with a language tag","short")]),
table(3,"Latest posts · 50 most recent","recent_posts",0,7,24,12,
 widths={"time":175,"language":85,"text":480,"post_url":100,"actor_did":235,"external_domain":170},
 labels={"time":"Time (UTC)","language":"Language","text":"Post preview","actor_did":"Author DID","external_domain":"External domain","post_url":"Open post"},
 links={"post_url":value_token,"actor_did":"https://bsky.app/profile/"+value_token}),
table(4,"Most active authors · post creation events","authors",0,19,12,9,
 widths={"actor_did":300,"posts":100,"latest_post":180},labels={"actor_did":"Author DID","posts":"Posts","latest_post":"Latest post (UTC)"},
 links={"actor_did":"https://bsky.app/profile/"+value_token}),
bars(5,"External domains · top 10 by post count","domains",12,19,12,9,"external_domain"),
table(6,"Most referenced posts · likes + reposts in this window","popular_subjects",0,28,24,9,
 widths={"post_url":650},labels={"post_url":"Open post","observed_interactions":"Observed interactions","likes":"Like events","reposts":"Repost events"},
 links={"post_url":value_token}),
panel(7,"Reading notes","text",None,0,37,24,3,options={"mode":"markdown","content":"**Interaction ranking** counts observed like/repost creations in this window; it is not lifetime likes or net engagement. Latest-post text is the recorded creation payload and may differ from the post's current state. Use table column filters to narrow the displayed rows."})
]
overview[4]["description"]="Top 10 primary languages on post creation events. Unspecified means missing/empty primary language; multi-language posts use their primary language."
overview[7]["options"]["enablePagination"]=False
content[2]["options"]["maxRowHeight"]=300
content[2]["description"]="Latest 50 observed post creation events; text previews show the first 160 characters. Column filters apply to fetched rows, not the entire dataset. Open the post or author via the cell link."
content[2]["fieldConfig"]["overrides"].extend([
    override("text", **{"custom.wrapText":True}),
    override("post_url", mappings=[{"type":"regex","options":{"pattern":"^https://.*","result":{"text":"Open post"}}}]),
])
for uid,title,panels in [("bluesky-overview","Bluesky · Overview",overview),("bluesky-content","Bluesky · Content explorer",content)]:
    dash={"uid":uid,"title":title,"description":"Live analysis of collected Bluesky events in ScopeDB.",
      "tags":["scopedb","bluesky"],"timezone":"utc","schemaVersion":41,"version":1,"editable":True,
      "refresh":"1m","time":{"from":"now-1h","to":"now"},"timepicker":{"refresh_intervals":["1m","5m","15m"],"time_options":["5m","15m","1h","6h","12h","24h","7d"]},
      "links":[{"title":"Overview","type":"link","url":"/d/bluesky-overview","keepTime":True,"includeVars":False,"targetBlank":False},
               {"title":"Content explorer","type":"link","url":"/d/bluesky-content","keepTime":True,"includeVars":False,"targetBlank":False}],"panels":panels}
    path=ROOT/"provisioning/dashboards"/f"{uid}.json"
    path.write_text(json.dumps(dash,ensure_ascii=False,indent=2)+"\n")
    print(path.relative_to(ROOT))

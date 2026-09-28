# Bluesky dashboards

基于当前 Scope CLI 账号工作区中的真实 `bluesky_events` 表，已配置到本机 Grafana OSS 13.1.0。

- [Overview](http://127.0.0.1:13000/d/bluesky-overview)：事件量、帖子创建量、活跃 DID 估计、接收延迟、5 分钟活动趋势、事件类型、语言和操作分布。
- [Content explorer](http://127.0.0.1:13000/d/bluesky-content)：帖子与作者指标、最新 50 条帖文、活跃作者、外链域名、窗口内获赞/转发最多的帖子。

本机演示账号为 `admin / admin`。两页默认查看最近 1 小时、每分钟刷新，使用 UTC。顶部链接切页时保留时间范围；拖动趋势图可缩小时间范围；帖子和 DID 链接在新标签页打开 Bluesky。

## 数据口径

- 查询的是此工作区**采集到的事件记录**，不代表 Bluesky 全网数据。没有按 `event_id` 去重；重复采集会计入数量。
- 事件总数和类型/操作分布包含 create、update、delete；帖子、作者、语言、域名指标只计算 `app.bsky.feed.post` 的 create 事件。
- 活跃 DID / 作者数量使用 `approx_count_distinct`，是身份标识的估计数，不等于自然人数。
- 接收延迟为 `received_at - time`，不是已确认的数据库写入耗时。分位数为近似值。
- 5 分钟桶按 UTC 对齐，范围两端可能只有部分桶；没有数据的桶保留间隙，不补零。最多 10,000 桶，建议时间跨度不超过 30 天。
- 语言使用主语言字段 `language`；缺失/空字符串显示 `Unspecified`。语言和域名榜各显示前 10。
- 最新帖文只拉取 50 条，每条预览前 160 个字符，点击 Open post 阅读当前原帖；表格筛选只影响已拉取的数据。文本来自创建事件，可能与当前帖子状态不同。DID 链接不依赖 handle 解析。
- 互动榜按窗口内观察到的 like/repost **创建事件**计数；不是帖子历史累计或扣除撤销后的净互动数。最多 15 条；作者榜最多 12 条。

## 配置与复现

数据源 UID 为 `scopedb-bluesky`，名称为 `ScopeDB · Bluesky`。`provisioning/datasources/bluesky.yml` 从环境变量注入 endpoint 与 `secureJsonData.apiKey`。专用测试 key 由本机 Scope CLI 创建，名称 `grafana-bluesky-20260928`，有效期 72 小时；密钥仅位于被忽略的 `.local/`，未包含在 dashboard JSON 中。

1. 在权限为 `0600` 的 `.local/env` 中填写 `BLUESKY_ENDPOINT` 和 `BLUESKY_API_KEY`。
2. `docker compose --env-file .local/env up -d`，由 Compose 传入变量并 provision 两页 dashboard。
3. key 到期后创建新 key、更新 `.local/env` 并再次执行上一步，使容器重建。原 PoC 使用独立的 `SCOPEDB_*` 配置。

迁移到已有 OSS 部署时，先安装 ScopeDB 插件，复制数据源 provisioning 并提供上述变量；复制两份 dashboard JSON 到其 dashboard provider 路径。也可通过 Grafana UI 导入 JSON，但须使用同一数据源 UID，或将 JSON 中的 `scopedb-bluesky` 替换为目标 UID。若只使用原 PoC，可不部署 Bluesky 数据源及这两份 JSON。

源文件与生成/验收入口：

```sh
# 修改生成器后重新生成两份 JSON 和 12 个 ScopeQL 文件
python3 scripts/build_bluesky_dashboards.py

# 经实际 Grafana 后端查询 ScopeDB，检查 12 个查询和汇总一致性
python3 scripts/validate_bluesky.py

# 官方 plugin-e2e 检查图表、表格、帖文链接，并生成截图
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  npx playwright test tests/bluesky.spec.ts --reporter=list
```

生成器：`scripts/build_bluesky_dashboards.py`；查询：本目录 `queries/`；Dashboard：`provisioning/dashboards/bluesky-{overview,content}.json`。验证摘要写入 `artifacts/bluesky-validation.json`，截图保留在 `artifacts/bluesky-*.png`。

2026-09-28 08:25–09:25 UTC 的真实验证窗口包含 1,034,868 条事件和 397,880 条帖子创建事件。12 个查询全部成功，耗时约 0.5–1.2 秒；事件分类/操作总数与总指标一致，趋势帖数与内容页总数一致。该耗时是一次本机验证结果，不是性能承诺；数据仍在持续增长。

两页的浏览器验收另覆盖原生图表渲染、表格有数据、无面板错误和帖子跳转 URL；测试结果见 `artifacts/bluesky-e2e.txt`。

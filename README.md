# ScopeDB → Grafana OSS PoC

ScopeDB 数据源插件：React/TypeScript 编辑器 → Grafana Go backend → `goscopedb` → ScopeDB。无需独立代理服务，浏览器不直接连接 ScopeDB。

本阶段仅供可信管理员在隔离环境验证。支持原始 ScopeQL、带类型的 DataFrame、UTC 时间过滤、超时和主动取消。已用真实 Bluesky 数据验证 Table、Stat、Time series、Bar chart 和 Pie chart 原生面板。原始查询可以写数据，本插件不提供强制只读检查。尚未签名，不支持 Grafana Cloud 安装。

Bluesky 实时总览与内容分析两页 Dashboard 的入口、数据口径和复现步骤见 [dashboards/bluesky/README.md](dashboards/bluesky/README.md)。

## 固定环境

- Grafana OSS **13.1.0**，Linux **amd64**；其他版本和架构未验证。
- 插件 ID：`scopedb-scopedb-datasource`；版本：`0.1.0`。
- Go 1.26.5（go.mod / Go 自动工具链）、Grafana Go SDK v0.296.5、goscopedb v0.6.3。
- Node.js 24、npm 11；前端 Grafana 包 13.1.0；具体依赖锁定在 package-lock.json。
- Docker Engine / Compose v2；Python 3 用于打包和冒烟脚本。

## 启动演示

先准备可从 Grafana 服务器访问的 ScopeDB 工作区与 API key。复制配置，只在本地填写密钥：

```sh
mkdir -p .local
cp .env.example .local/env
chmod 600 .local/env
# 编辑 .local/env 中 SCOPEDB_ENDPOINT 和 SCOPEDB_API_KEY
make build
make test
make dev
```

`make dev` 读取 `.local/env`（可通过 `ENV_FILE=/path/to/file` 替换）；Compose 自动创建独立数据卷，在 **127.0.0.1:13000** 启动 Grafana。默认演示账号 `admin / admin`，仅绑定本机；可在首次启动前修改 GRAFANA_PASSWORD。已有数据卷的密码不会随该变量重置。

数据源由 provisioning 注入，API key 进入 `secureJsonData`。打开 Connections → Data sources → ScopeDB → Save & test；后端实际执行 `SELECT 1 AS ok`。

示例 Dashboard 位于 ScopeDB 文件夹。其固定时间范围为 **2026-09-28 00:00–00:20 UTC**，查询下述专用测试表。首次验收仅运行一次：

```sh
scope query --file fixtures/create.scopeql
scope query --file fixtures/insert.scopeql
make smoke
```

创建脚本不使用 IF NOT EXISTS；表已存在时不要重复插入。此任务已创建并插入该三行测试数据，当前工作区可直接运行 smoke。换工作区时重新执行建表和插入脚本。

## 查询

新建 Table 面板，选择 ScopeDB 数据源，输入：

```sql
FROM grafana_oss_poc_20260928
WHERE $__timeFilter(event_time)
SELECT event_time, service, latency_ms, success, detail
ORDER BY event_time
LIMIT 1000
```

按 Grafana Run queries 或 Ctrl/Cmd+Enter 执行。宏只接受未加引号的列名或 `table.column`；展开为 UTC 的 `column >= from AND column < to`，跳过字符串和注释。此版不支持 Dashboard 变量、其他宏、日志专用视图或告警。返回按时间升序排列的时间列与数值列时，可直接使用 Grafana 原生 Time series 面板；插件尚无独立的时序查询编辑模式。

数值、布尔和时间映射到对应 DataFrame 类型，NULL 保持为空。超过 JavaScript 精确整数范围的整列数值、非有限浮点数整列、复杂类型、binary 和 interval 显示原始字符串。结果上限 10,000 行、单个 HTTP 响应 16 MiB，超限返回错误；查询应显式带 LIMIT。

默认 timeout 30 秒，可配 1–300 秒，覆盖提交、轮询和结果下载，同时传给 ScopeDB 执行超时。取消或异常中断后，用独立 2 秒 context 尝试服务端 Cancel；取消结果无法确认时显示错误。已经终止的任务不再发送 Cancel。不自动重试提交，避免原始查询被重复执行。

## 安装到另一个 OSS 测试实例

```sh
make package
# 输出 dist/scopedb-scopedb-datasource-0.1.0.zip
mkdir -p .local/installed
unzip dist/scopedb-scopedb-datasource-0.1.0.zip -d .local/installed
chmod +x .local/installed/scopedb-scopedb-datasource/gpx_scope_db_linux_amd64

GRAFANA_PORT=13001 PLUGIN_DIR=./.local/installed/scopedb-scopedb-datasource \
  docker compose --env-file .local/env -p scopedb-grafana-install-test up -d

GRAFANA_URL=http://127.0.0.1:13001 make smoke
```

这使用 ZIP 解压目录、独立容器和全新 Grafana 数据卷。停止该测试实例：

```sh
docker compose --env-file .local/env -p scopedb-grafana-install-test down
```

对于用户已有的 **隔离 OSS 测试部署**，将 ZIP 解压后的插件目录复制到该 Grafana 的 plugins 目录，确保后端文件可执行；仅允许此 ID 加载未签名插件：

```ini
[plugins]
allow_loading_unsigned_plugins = scopedb-scopedb-datasource
```

Docker 环境对应 `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=scopedb-scopedb-datasource`。重启 Grafana 后添加 ScopeDB 数据源，填写 Endpoint、API key、timeout。更新插件文件（尤其 plugin.json）后也需重启。可选复制 provisioning 模板并通过环境变量提供凭据；不要把真实密钥写进版本库。Grafana Cloud 和官方目录认证留待后续阶段。

## 验证与开发入口

| 命令 | 行为 |
| --- | --- |
| `make build` | npm ci、类型检查、官方 webpack 构建、官方 mage Linux amd64 构建 |
| `make test` | 类型检查、前端测试入口、Go 竞态检测和后端行为测试 |
| `make dev` | 启动固定 Grafana OSS 与 provisioning |
| `make smoke` | 在实际 Grafana 上验证真实 ScopeDB 连接、字段、NULL、时间边界和错误 |
| `make package` | 将已构建 dist 打包为按插件 ID 分目录的 ZIP |
| `make e2e` | 官方 @grafana/plugin-e2e 浏览器验收 |
| `make stop` | 停止主测试实例，保留数据卷 |

浏览器测试首次执行前运行 `npx playwright install chromium`；需要 Linux 浏览器系统依赖。设置 `GRAFANA_URL` 可切换实例。若本机设置了全局代理，E2E 命令设置 `NO_PROXY=127.0.0.1,localhost`。

smoke 缺少真实 Endpoint/API key 时失败，不回退为模拟数据；期间会创建并删除一个仅存在于本机 Grafana 的错误凭据数据源。当前 smoke 的 fixture 表名和数据固定在示例 Dashboard 与 fixtures 中。

生命周期单元测试通过实际 SDK 连接受控 HTTP 测试服务器，覆盖成功/失败/取消、提交响应丢失、超时、取消失败和结果类型校验。真实查询验证与受控故障测试的记录见 VALIDATION.md。

## 本次测试资源

- 使用本地 Scope CLI 创建的专用 key：`grafana-oss-poc-20260928`，72 小时有效；仅保存于被忽略的 `.local/`，从未写入源码/ZIP。
- ScopeDB 表：`grafana_oss_poc_20260928`，三行合成数据；保留用于复现。
- 现有 3000 端口 Grafana 不参与测试。
- key 到期后，在本机创建新 key，更新 `.local/env` 并 `make dev` 使容器重建；勿将 key 发到聊天中。

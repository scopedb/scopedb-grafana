# ScopeDB Grafana connector

将任意 ScopeDB 工作区接入 Grafana OSS。React 查询编辑器通过 Grafana Go backend 调用官方 `goscopedb` SDK，无需额外代理服务；API key 保存在 Grafana `secureJsonData`，浏览器不直接访问 ScopeDB。

当前版本 **0.1.0**，已验证 **Grafana OSS 13.1.0 / Linux amd64**。首个版本的插件 ID 为 `scopedb-scopedb-datasource`。其他 Grafana 版本、平台及 Grafana Cloud 安装尚未验证；本包未签名。

## 安装到已有 Grafana OSS

1. 将 `dist/scopedb-scopedb-datasource-0.1.0.zip` 解压到 Grafana 的 plugins 目录，目录内应有 `module.js`、`plugin.json` 和 `gpx_scope_db_linux_amd64`。
2. 确保后端文件可执行：`chmod +x <plugins>/scopedb-scopedb-datasource/gpx_scope_db_linux_amd64`。
3. 设置 `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=scopedb-scopedb-datasource`，或在 `grafana.ini` 的 `[plugins]` 下设置对应 `allow_loading_unsigned_plugins`。
4. **重启 Grafana**，打开 Connections → Data sources → Add data source → ScopeDB。
5. 填写 Grafana 服务器可访问的 workspace Endpoint、API key 和 timeout，点击 Save & test。成功会执行 `SELECT 1 AS ok`。

升级时替换整个插件目录并重启；数据源配置仍保存在 Grafana 中。API key 的 ScopeDB 权限决定查询权限，所有使用该数据源的用户共享该凭据。插件执行原始 ScopeQL，不提供强制只读授权边界；请按部署环境配置适当的服务凭据和 Grafana 访问权限。

## 从源码启动

依赖 Node.js 24 / npm 11、Go 1.26.5、Docker Compose v2 和 Python 3。Go / npm 依赖已锁定。

```sh
mkdir -p .local
cp .env.example .local/env
chmod 600 .local/env
# 在本机填写 SCOPEDB_ENDPOINT / SCOPEDB_API_KEY，也可以启动后通过 UI 配置
make build
make dev
```

访问 [本机 Grafana](http://127.0.0.1:13000)，演示账号 `admin / admin`。首次启动前可设置 `GRAFANA_PASSWORD`；已有数据卷不会因此重设密码。本机端口由 `GRAFANA_PORT` 控制。默认安装只 provision 通用数据源和 Getting started Dashboard，不依赖任何业务表，不创建 ScopeDB 数据。

也可将 `provisioning/datasources/datasources.yml` 用在已有部署中，通过环境变量传入凭据。数据源 UID 可自行修改，Dashboard 必须引用对应 UID。

## 查询编辑器

选择 ScopeDB 数据源后：

1. 点击 **Browse tables**，选择 database → schema → table。目录通过 SDK 分页读取，字段和类型会显示在编辑器旁。
2. 选择时间列，点击 **Insert table query** 或 **Insert time series query** 生成起始查询。只有显式点击插入按钮才会替换查询。
3. 使用代码编辑器、字段／函数／宏补全修改 ScopeQL，按 **Ctrl/Cmd+Enter** 或 Run query 执行。
4. 选择 Grafana 原生 Table、Stat、Time series、Bar chart 或 Pie chart 可视化。

目录不可用时仍可直接输入 ScopeQL。生成的表路径按 database/schema/table 分别引用；不依赖工作区默认 schema。完整说明见 [docs/queries.md](docs/queries.md)。

```sql
FROM events
WHERE $__timeFilter(event_time)
SELECT $__timeGroup(event_time) AS time, service
GROUP BY time, service AGGREGATE count() AS events
ORDER BY time
LIMIT 10000
```

将 Format 设为 **Time series**：一个 timestamp 列作为时间轴，数值列作为指标，string / boolean 列作为维度标签。连接器按时间排序，为不同标签组合返回独立曲线；重复时间点需在查询中聚合。Table 模式保留所有原始列，未指定 Format 的查询默认使用 Table。

## Dashboard 变量

支持 Custom、Constant 和 Query 变量；Query 变量填写 ScopeQL，默认使用第一列，或返回 `__text` / `__value` 分离显示名与实际值。

```sql
FROM events
GROUP BY service AGGREGATE count() AS events
SELECT service AS __text, service AS __value
ORDER BY __text
LIMIT 1000
```

在面板中使用：`service = ${service}`；多选与 All 使用 `contains([${service}], service::any)`。变量自动作为 ScopeQL 字面量转义，**不要再手动加引号**。启用 All 时，Custom all value 留空。数字用 `${limit:number}`；单个标识符用 `${table:identifier}`；不支持 `:raw` 插值。详见 [变量和宏](docs/queries.md)。

## 示例与验证

安装包内置 **ScopeDB · Getting started**，可从数据源的 Dashboards 页面导入；无需指定业务表。Bluesky 和旧三行 fixture 已移到 `examples/`，只在显式启用时加载：

```sh
# 将 examples/env.example 中所需变量追加到 .local/env，并填写真实凭据
make dev-examples
```

此 overlay 同时加载 Bluesky 与旧 fixture 示例；只需要其中一套时，可单独复制对应 provisioning 文件。示例需要已有的相应表，连接器安装本身不需要它们。Bluesky 查询口径见 [dashboards/bluesky/README.md](dashboards/bluesky/README.md)。

| 命令 | 作用 |
| --- | --- |
| `make build` | npm ci、类型检查、官方 webpack + mage 构建 |
| `make test` | TypeScript 检查、变量单元测试、Go 竞态及后端行为测试 |
| `make dev` / `make stop` | 启停本机通用实例，保留数据卷 |
| `make smoke` | 对任意真实工作区验证连接、宏、转义、时序和目录；不写业务数据 |
| `make e2e` | 官方 plugin-e2e 验证配置、编辑器、目录、变量和通用 Dashboard |
| `make dev-examples` | 加载可选业务示例 |
| `make smoke-fixture` / `make e2e-examples` | 回归原 fixture 和 Bluesky 示例 |
| `make package` | 打包已构建的 Linux amd64 插件 ZIP |

浏览器首次执行前安装 `npx playwright install chromium` 及其 Linux 系统依赖。全局代理环境下设置 `NO_PROXY=127.0.0.1,localhost`。`GRAFANA_URL` 可切换测试实例；smoke 支持 `SCOPEDB_DATASOURCE_UID`、`GRAFANA_USER`、`GRAFANA_PASSWORD` 和 `ENV_FILE`。

## 执行约束

- timeout 1–300 秒，覆盖排队、提交、轮询和下载；取消时尝试终止 ScopeDB 服务端任务，不自动重试提交。
- 每个数据源实例默认最多 4 个并发请求，可配 1–32；不同查询的错误保留各自 RefID。
- 最多 10,000 行，单次 HTTP 响应上限 16 MiB；超限报错，不静默截断。查询应显式 LIMIT；返回行数限制不等于扫描量限制。
- 时序最多 500 个标签组合；数值 NULL 保留，缺失桶不补零。时间／维度 NULL 或重复点返回可操作的错误。
- Table 保留大整数、非有限数值和复杂类型的原始字符串；Time series 拒绝不安全数值和复杂列，避免误画图。
- Query inspector 提供展开后的查询、query ID、耗时、行数和自动分桶间隔。
- 告警、日志专用模式、Ad hoc filters、签名和官方目录认证尚未包含。

# 通用连接器 0.1.0 验收记录

验收日期：2026-09-28。使用真实 ScopeDB 工作区完成集成检查；浏览器使用官方 `@grafana/plugin-e2e`。首发前的内部 PoC 验收记录保留在本文后半部。

## 环境与兼容性

- Grafana OSS 13.1.0 / Linux amd64；ScopeDB Go SDK v0.6.3；依赖锁定。
- 插件 ID 沿用 `scopedb-scopedb-datasource`，旧数据源、Table 查询和 Bluesky Dashboard 无需迁移查询模型。
- 默认 provisioning 仅包含通用 ScopeDB 数据源与 Getting started Dashboard；fixture / Bluesky 移至可选 examples overlay。
- 主实例保留在 `127.0.0.1:13000`，Compose project 为原 `scopedb-grafana-poc`。未操作其他 Grafana 部署。
- ZIP 安装使用独立 project `scopedb-grafana-connector-install-test`、端口 13001 和独立数据卷，只挂载从 ZIP 解压的插件目录。

## 验证结果

- TypeScript、ESLint、官方 webpack 和 mage 构建通过；Jest 4 个变量转义与插值用例通过；Go `-race` 后端测试通过。
- 后端测试覆盖宏扫描、自适应间隔、时序排序／NULL／重复点／空结果／标签上限、目录分页参数、排队超时和实例并发限制，保留原有执行生命周期与取消测试。
- 主实例通用 smoke 全部通过：真实连接与密钥存储、标量查询、时间范围、自动间隔、ScopeQL 字面量转义、带标签时序、负时间桶、错误传播、目录及字段发现。
- 原 fixture smoke 14 项通过：真实数据、NULL、上下时间边界、空结果、语法／执行／无效凭据错误等。
- 主实例浏览器 **13 passed**（含登录准备）：配置、表格编辑、Ctrl+Enter、语法错误、目录生成查询、编辑后保留 Time series 格式与标签、Query 变量 All／单选／数字格式、入门 Dashboard，以及原 fixture 和两个 Bluesky Dashboard。
- 独立 ZIP 实例通用 smoke 全部通过；浏览器 **8 passed**（含登录准备）。验证默认只有一个通用数据源和一个入门 Dashboard；验收后已清理专用容器、网络及数据卷。日志：`artifacts/connector-install-smoke.txt`、`artifacts/connector-install-e2e.txt`。
- 源码与最终 ZIP 扫描未发现本地测试 API key；凭据、运行数据、构建输出及截图由 `.gitignore` 排除。

上述完整 E2E 对应相同功能代码。统一首发版本号后，重新执行 webpack／mage 构建、ZIP 版本与密钥扫描、主实例真实 smoke，并确认 Grafana 加载版本为 0.1.0；日志见 `artifacts/version-0.1.0-smoke.txt`。

本地日志在 `artifacts/connector-e2e.txt`、`artifacts/connector-smoke.txt`、`artifacts/connector-fixture-smoke.txt`；目录编辑器截图为 `artifacts/generic-query-editor.png`。

## 发布包

- `dist/scopedb-scopedb-datasource-0.1.0.zip`（9,687,777 bytes），顶层目录为插件 ID，包含前端、Linux amd64 后端及内置 Dashboard。
- SHA-256：`3944d1615611b9c6dda714dd5961d7d093c69a94453606c36e212865d62e377d`。

## 交付范围

这是可安装的通用 ScopeDB 数据源连接器，仍为未签名版本。仅验证 Grafana 13.1.0 / Linux amd64；其他版本／架构、告警、日志模式、Ad hoc filters 和 Grafana Cloud 尚未包含。故障／取消行为由受控 HTTP 服务验证，真实云端查询与目录由集成检查验证；本次没有向业务表写入测试数据。

---

# 首发前 OSS PoC 历史验收记录

以下为早期内部构建的历史记录，并非另一次发布；其 ZIP 大小与摘要不代表当前 0.1.0 安装包。当前包以本文上方「发布包」为准。

验收日期：2026-09-28。结论：PLAN.md 六项验收通过；仅覆盖内部 OSS PoC。

## 实际环境与产物

| 项目 | 实际值 |
| --- | --- |
| 插件 | scopedb-scopedb-datasource 0.1.0 |
| Grafana | grafana/grafana:13.1.0，Linux amd64 |
| Go / Grafana SDK | 1.26.5 / v0.296.5 |
| ScopeDB SDK | github.com/scopedb/goscopedb v0.6.3 |
| 前端 | Grafana 13.1.0 包；Node 24.13.0、npm 11.8.0；package-lock.json 锁定 |
| ScopeDB | 当前 Scope CLI 工作区 leiysky，真实云端 endpoint |
| 测试表 | grafana_oss_poc_20260928，3 行合成事件 |
| 主实例 | scopedb-grafana-poc；127.0.0.1:13000；保留运行 |
| ZIP 安装实例 | scopedb-grafana-install-test；127.0.0.1:13001；独立全新数据卷；验收后已停止 |
| ZIP | dist/scopedb-scopedb-datasource-0.1.0.zip；9,661,177 bytes |
| SHA-256 | 74198a36186961300337e3ddd4ac4061e8293ace14d703757c1f77323e34be1b |

ZIP 内为插件 ID 顶层目录，包含前端 module.js、plugin.json、说明、资源与静态链接的 x86-64 ELF 后端；已确认后端可执行位。解压后直接挂载到第二实例完成验证，未依赖源目录运行。

## 已执行的检查

- `make build`：成功；npm ci 从锁文件安装、TypeScript 类型检查、官方 webpack 前端构建、官方 mage 的 build:linux 后端构建。
- `make test`：成功；Go `-race` 通过。前端未另设 Jest 单元用例；前端交互由下述浏览器 E2E 覆盖。
- `npm run lint`：成功；依赖包的弃用提示不影响执行。
- `make package`：成功。
- `make smoke`：主实例 14 项检查全部通过；见 artifacts/smoke-primary.txt。
- `GRAFANA_URL=http://127.0.0.1:13001 make smoke`：ZIP 安装实例 14 项检查全部通过；见 artifacts/smoke-zip-install.txt。
- `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost make e2e`：**6 passed (49.1s)**，包括登录准备和 5 个浏览器场景。
- 扫描源码、provisioning 与 ZIP：专用测试 key 未写入交付文件；本地 key 和环境文件权限均为 0600。

## 六项验收对应证据

1. **构建和加载**：固定版本构建成功；两套 Grafana OSS 都加载了 Linux amd64 插件。unsigned allowlist 只包含本插件 ID。
2. **连接与密钥**：后端实际执行 SELECT 1 AS ok；错误 key 的 health check 失败；保存后的 datasource API 只返回 secureJsonFields.apiKey=true，不返回密钥；配置页 Save & Test 浏览器测试通过。
3. **真实 Table**：查询字段为 event_time、service、latency_ms、success、detail；API 与浏览器均验证预期值，worker 行的 latency_ms 和 detail 保持 NULL / 空单元格。
4. **时间范围**：00:00–00:20 UTC 返回 api/worker 两行，排除恰在 00:20 的上界；00:10–00:21 返回 worker/api 两行；第二次范围排除 00:00 行。API 与 Dashboard 时间选择器均验证通过。空范围返回带 schema 的空结果。
5. **错误与取消**：真实语法错误、类型转换执行错误均返回错误，不返回空成功。SDK 生命周期测试覆盖 running→finished、failed、cancelled、deadline、调用方取消、提交响应丢失、Cancel 失败；验证中断后使用新 context 向测试服务发送一次 Cancel。**故障与取消验证使用受控 HTTP 测试服务；未在真实 ScopeDB 上制造长时间运行任务。** 真实查询成功与受控故障测试分别记录，没有将模拟数据用于真实集成验收。
6. **另一实例安装**：按 README 解压 ZIP，在 13001 端口、新容器和新数据卷完成相同真实连接与查询检查。完成后停止该实例，保留主实例供查看。

后端行为测试另外覆盖字符串/注释中的宏不替换、非法宏参数、UTC 纳秒时间边界、NULL、超大整数字符串、复杂类型字符串、空结果、列数/行数不一致、结果行数上限和 refId 错误隔离。

## 可视证据与范围

![真实 Grafana Table](artifacts/dashboard.png)

该截图来自浏览器 E2E，显示真实 ScopeDB 的两行结果和 00:00–00:20 UTC 范围。截图中的空单元格是 NULL。

仍为未签名内部 PoC；不承诺生产就绪、强制只读、其他 Grafana 版本/架构、Time series、Dashboard 变量、告警或 Grafana Cloud 支持。现有 3000 端口 Grafana 未修改。

Grafana 的 metrics 元数据用于启用面板编辑器，因此本插件设置为 true；它并不表示本 PoC 已实现 Time series 输出。参见 [官方 plugin.json 说明](https://grafana.com/developers/plugin-tools/reference/plugin-json)。后端结构使用 [官方 backend 插件教程](https://grafana.com/developers/plugin-tools/tutorials/build-a-data-source-backend-plugin)，协议依据本地 ScopeDB 文档与 goscopedb v0.6.3 源码。

# 节点 IP 质量检测 · Surge

将 [MaYIHEI/paperclip 的混合模式插件](https://github.com/MaYIHEI/paperclip/tree/main/loon/ipquality-web-test)适配为独立 Surge 模块。保留 15 项按需检测、两项并发、IP 遮盖、深色模式和基础／风险／媒体快捷预设。

## 安装与使用

1. 在 Surge 中通过 URL 安装 [IPQuality.sgmodule](https://raw.githubusercontent.com/KatyaSilva/loon-surge-remove-ads/refs/heads/main/IPQuality.sgmodule)，启用模块与脚本功能。
2. 保持 Surge 接管浏览器流量，在 Safari 或其他浏览器打开 **http://paperclip.test/ipquality**。
3. 选择现有节点、策略组或 `DIRECT`。选择项目后点击“开始检测”。打开页面、刷新节点列表都不会自动发起外部检测。
4. 也可以运行 `IPQuality_Open`、`IPQuality_Basic`、`IPQuality_Risk` 或 `IPQuality_Media` 脚本，点按 Surge 通知打开网页。快捷入口会预选项目，进入网页后仍需点击“开始检测”。面板刷新按钮也可发送入口通知。

模块参数 `policy` 默认为 `DIRECT`（直连）；检测代理节点时，在网页中选择目标，或将该参数改为已有策略名称。网页会优先保留上次手动选择。新版 Surge 能列出外部策略组中的订阅节点，使用其内部 `identifier` 精确检测；不提供此接口的旧版本可选择策略组。手动打开网页不依赖通知权限。

`paperclip.test` 是本地拦截入口，映射至文档保留地址 `192.0.2.1`，由 Surge 脚本直接响应；它不是远程报告服务器，也不需要为它安装 MITM 证书。请使用上面的 **HTTP** 地址。

## 检测项目

基础信息、IP 类型属性、风险评分、风险因素、出口分流、BGP 信息、BGP 路径、节点 HTTPS 轻量测速、外部探针入站路径、三网探针延迟、外部探针 MTR、HTTPS 稳定性、流媒体与 AI、地区一致性、数据状态。

## 与 Loon 原版的对应关系

| 原版机制 | Surge 适配 |
|---|---|
| 从节点页读取 `$environment.params.node` | 网页读取 Surge 节点／策略组列表，由用户选择目标 |
| `$httpClient` 的 `node` 和毫秒超时 | 映射为 Surge 的 `policy` 和秒；保留二进制测速数据 |
| Rewrite v2 内联 HTML | `http-request` 脚本直接返回本地网页 |
| generic 的 `htmlMessage` 弹窗 | 统一在网页的沙箱 iframe 中展示报告 |
| 每个项目运行时下载并执行 r32 脚本 | 固定源版本随模块脚本打包，无运行时 JavaScript 下载与 `eval` |
| 通知 `openUrl` | 使用 Surge 支持的 `url` 字段 |

Surge 模块通过内部 `$httpAPI` **读取**策略列表，无需配置对外 HTTP API 密码。所有探测都采用请求级策略，不改变全局模式或策略组选择。

## 边界

- 出口发现、媒体与测速请求走所选策略；部分按指定 IP 查询的公开数据库、RIPEstat 与 Globalping 请求优先使用 `DIRECT`。指定公开服务的 GET 请求遇到网络错误、408 或 5xx 时，会在原超时预算内通过所选策略重试一次；403、429 不换策略重试，POST 创建测量也不重试。
- 可选检测会访问上游定义的 IP 数据库、流媒体服务、Cloudflare 测速或 Globalping 等第三方服务。只有点击“开始检测”后才运行所选项目。
- 多项检测会复用同一轮、同一目标下 60 秒内的成功公开数据库查询，减少重复请求；出口发现、媒体、测速、稳定性和 Globalping 测量不会被缓存。缓存只接受指定来源的 JSON，不复用错误响应，并限制为 32 个槽位、每条最多 64 KiB。
- 报告 iframe 延迟加载；清空或重新检测时释放旧报告的 Blob URL 和尺寸监听器。
- 每个项目仍单独运行 r32，首次并发的重复请求以及未缓存来源仍可能受到第三方限流影响。
- HTTPS 测速是小样本估算。Globalping Ping／MTR 是外部探针到出口 IP 的测量，不能等同于手机到节点延迟、VPS 本机测速或节点真实回程。
- 外部探针等待最终状态，最长使用约 55 秒的检测预算；仍未结束、探针离线或来源缺失时标记为“部分结果”。已完成的 Ping 若为 100% 丢包，会显示“无 ICMP 响应”，不据此判断 HTTPS 或代理失效。
- [ipapi 的匿名接口](https://ipapi.is/developers.html)目前仅提供简版所有者／地理信息，每个 IP 每 UTC 日限 30 次查询，不提供风险字段。因此默认跳过该来源，避免多项目检测耗尽匿名额度。IPQS 上游配额用尽、DB-IP 站点拦截等会明确显示，缺失字段不会当作低风险。
- 会话有效期 30 分钟；新一轮检测替换旧会话。不同网页同时启动检测时，较早会话的后续请求会失效。
- 已在 Surge Mac 6.11.0 中实际加载模块，通过本地 HTTP 入口对同一个代理节点执行全部 15 项，并在真实 Chrome 中验证报告。iOS 尚未实机验证；第三方接口可用性仍会随网络、配额和站点策略变化。

## 来源与许可

- 插件、网页和独立测速参考：`MaYIHEI/paperclip@4ac782dfd392ce67f73c33128b72bf36ad50cd01`，`loon/ipquality-web-test`，版本 `poc12`。
- 检测引擎使用原插件明确引用的 `MaYIHEI/paperclip@eaa04fe0a9f37ccfafdd11930d28fd5ff3f04718`，`loon/ipquality/ipquality.js`，版本 `2026-07-22.r32`。没有改用该仓库当前归档目录中的另一版引擎。
- 作者 MaYIHEI；引擎原有参考署名 Roddy-D、xykt 均保留在源码中。上游 MIT 许可见 [LICENSE](./LICENSE)。
- `vendor` 文件保留原文；构建时通过 `src/engine-adapter.mjs` 应用可核对的补丁，处理可读节点名、探针轮询、匿名接口限制、配额识别和报告完成状态。Surge 网络接口、会话及页面适配放在 `src` 中。

## 本次实测记录

2026-11-13 至 2026-11-14，Surge Mac 6.11.0（12800），固定代理节点；公开记录不包含节点地址、出口 IP、测量 ID 或本地网络信息。

- 基础信息、出口分流、BGP、BGP 路径、HTTPS 测速、外部入站路径、三网 Ping、MTR、HTTPS 稳定性、媒体／AI 和地区一致性均取得有效结果。BGP 曾出现临时超时，加入备用请求路径后复测成功。
- IP 类型、风险评分、风险因素、数据状态可生成报告；部分来源因匿名字段限制、配额用尽、演示端点不可用或站点校验而缺失，页面显示“部分结果”及原因。
- 外部 Ping 探针返回终态与 100% 丢包，同时 HTTPS 与媒体探测成功；已将这一情况与脚本执行失败区分。
- 模块导入已实测。`#!arguments=policy:` 会被 Surge 原生模块导入器拒绝，默认值已修正为 `DIRECT`；检测代理时仍需选中目标节点。

## 构建与验证

在仓库根目录执行：

```sh
node IPQuality/build.mjs
node --test IPQuality/tests/runtime.test.mjs
```

生成的 `IPQuality/ipquality.js` 是实际部署文件；其中含静态网页、r32 引擎与独立测速代码。构建同时计算网页内联脚本的 CSP 哈希。

浏览器检查需要 Playwright 和 Chrome：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node IPQuality/tests/browser.mjs
```

自动化回归测试使用 `203.0.113.24` 和虚构策略名，第三方请求均由本地 fixture 响应，不会探测真实节点或写入 Surge 的真实持久化存储。覆盖 15 个检测入口、超时单位、节点绑定、会话、IP 遮盖、缓存过期与目标隔离、备用路径、限流处理、探针完成状态，以及移动布局、深色模式、设置保留和部分结果展示。

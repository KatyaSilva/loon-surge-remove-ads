# 节点 IP 质量检测 · Surge

将 [MaYIHEI/paperclip 的混合模式插件](https://github.com/MaYIHEI/paperclip/tree/main/loon/ipquality-web-test)适配为独立 Surge 模块。保留 15 项按需检测、两项并发、IP 遮盖、深色模式和基础／风险／媒体快捷预设。

## 安装与使用

1. 在 Surge 中通过 URL 安装 [IPQuality.sgmodule](https://raw.githubusercontent.com/KatyaSilva/loon-surge-remove-ads/refs/heads/main/IPQuality.sgmodule)，启用模块与脚本功能。
2. 保持 Surge 接管浏览器流量，在 Safari 或其他浏览器打开 **http://paperclip.test/ipquality**。
3. 选择现有节点、策略组或 `DIRECT`。选择项目后点击“开始检测”。打开页面、刷新节点列表都不会自动发起外部检测。
4. 也可以运行 `IPQuality_Open`、`IPQuality_Basic`、`IPQuality_Risk` 或 `IPQuality_Media` 脚本，点按 Surge 通知打开网页。快捷入口会预选项目，进入网页后仍需点击“开始检测”。面板刷新按钮也可发送入口通知。

模块参数 `policy` 可留空；填写已有策略名称可设置网页默认项。网页会优先保留上次手动选择。新版 Surge 能列出外部策略组中的订阅节点，使用其内部 `identifier` 精确检测；不提供此接口的旧版本可选择策略组。手动打开网页不依赖通知权限。

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

- 保留上游的请求分流：出口发现、媒体与测速请求走所选策略；部分按指定 IP 查询的公开数据库、RIPEstat 与 Globalping 请求使用 `DIRECT`。
- 可选检测会访问上游定义的 IP 数据库、流媒体服务、Cloudflare 测速或 Globalping 等第三方服务。只有点击“开始检测”后才运行所选项目。
- 多项检测会复用同一轮、同一目标下 60 秒内的成功公开数据库查询，减少重复请求；出口发现、媒体、测速、稳定性和 Globalping 测量不会被缓存。缓存只接受指定来源的 JSON，不复用错误响应，并限制为 32 个槽位、每条最多 64 KiB。
- 报告 iframe 延迟加载；清空或重新检测时释放旧报告的 Blob URL 和尺寸监听器。
- 每个项目仍单独运行 r32，首次并发的重复请求以及未缓存来源仍可能受到第三方限流影响。
- HTTPS 测速是小样本估算。Globalping Ping／MTR 是外部探针到出口 IP 的测量，不能等同于手机到节点延迟、VPS 本机测速或节点真实回程。
- 会话有效期 30 分钟；新一轮检测替换旧会话。不同网页同时启动检测时，较早会话的后续请求会失效。
- 当前验证包含离线模拟与浏览器检查；第三方服务可用性和不同 iOS／Surge 版本仍需实际使用确认。

## 来源与许可

- 插件、网页和独立测速参考：`MaYIHEI/paperclip@4ac782dfd392ce67f73c33128b72bf36ad50cd01`，`loon/ipquality-web-test`，版本 `poc12`。
- 检测引擎使用原插件明确引用的 `MaYIHEI/paperclip@eaa04fe0a9f37ccfafdd11930d28fd5ff3f04718`，`loon/ipquality/ipquality.js`，版本 `2026-07-22.r32`。没有改用该仓库当前归档目录中的另一版引擎。
- 作者 MaYIHEI；引擎原有参考署名 Roddy-D、xykt 均保留在源码中。上游 MIT 许可见 [LICENSE](./LICENSE)。
- `vendor` 文件保留原文；构建时仅将引擎报告标题中的策略标识替换为可读节点名称。Surge 网络接口、会话及页面适配放在 `src` 中。

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

测试使用 `203.0.113.24` 和虚构策略名，所有第三方请求均由本地 fixture 响应，不会探测真实节点或写入 Surge 的真实持久化存储。覆盖 15 个检测入口、超时单位、节点绑定、会话、IP 遮盖、缓存过期与目标隔离，以及移动布局、深色模式、设置保留和部分失败展示。

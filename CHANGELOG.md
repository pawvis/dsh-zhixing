# 更新日志

## 1.1.1

修复 1.1.0 的功能 bug 与安全问题，不改变已有功能与界面文案。

### 功能修复

- **xlsx 共享字符串全部丢失**：单元格 `t="s"` 时改为从 `<v>索引</v>` 取共享字符串（原正则永远匹配不到 Excel/WPS 的写法）；同时支持 `inlineStr`、富文本共享字符串（多个 `<r><t>` 拼接）并跳过拼音注音 `<rPh>`。导入的计划表不再只剩数字。
- **顺延记录没写进去**：`postponeTodos` 每次顺延时把顺延前的日期 push 进 `postponedFrom`；老数据没有该字段或字段不是数组时自动补齐。
- **残留锁导致一直「写入繁忙」**：`withLock` 发现锁文件 mtime 超过 30 秒即视为崩溃残留，删除后重试；锁文件内写入 `pid` / 获取时间 / 唯一 token，释放时只删除自己持有的锁，避免误删其他进程新建的锁。
- **AI 进度建议约束落到代码**：单次进度增幅超过 30 时截断到「旧值 + 30」；`quote` 必须在当天日报原文里逐字出现，否则丢弃该建议；已完成（进度 100 或状态完成）和已过截止日期的目标不再发给模型。
- **长文档拆目标跨段丢父子关系**：拆第 N 段时把前几段已拆出的目标（全局序号 + 标题 + 周期）放进 prompt，`parentIndex` 使用全局序号；引用不存在的序号时保持为顶层目标，目标不会丢。

### 安全修复

- **日期参数路径穿越**：新增统一 `assertDateKey(date)`（必须是 `YYYY-MM-DD` 且是真实存在的日期），`/collect`、`/collect/sessions`、`/generate`、`/save-report`、`/report`、`/report/delete`、`/report/html`、`/reports/summary*`、`/state` 等所有用日期拼路径的地方统一校验，非法日期返回 400；附件与汇总文件名统一做 basename / 去 `..` 处理。
- **`/debug/*` 生产环境默认关闭**：13 个调试接口只有设置 `ZHIXING_DEBUG=1` 时才注册，关闭时返回 404；前端设置页的「调试」卡片与前端错误上报也按同一开关隐藏。
- **写接口只收 JSON**：所有 POST 在 `readBody` 与路由入口校验 `Content-Type: application/json`（含 `+json`），否则返回 415，挡住 `text/plain` 简单请求的跨站调用。
- **模板预览 iframe 加 sandbox**：日报 HTML 预览与模板预览使用 `sandbox=""`（不允许脚本）；导出 PDF / PNG 用的离屏 iframe 只给 `allow-same-origin`（截图需要读 DOM），同样不执行模板里的脚本。
- **URL 抓取 SSRF 防护**：`/assistant/analyze` 抓取链接前校验协议与解析出的每个 IP，拒绝 loopback、私网（10/8、172.16/12、192.168/16）、链路本地（169.254/16、fe80::/10）、唯一本地地址（fc00::/7）、`::1`、IPv4-mapped 等；重定向逐跳校验，最多 5 跳；响应限制 2MB、超时 10 秒。UA 改为 `dsh-zhixing/<版本号>`。

### 文档

- README、`docs/DETAIL.md`、`docs/lang/README_ZH.md` 与代码对齐：状态文件为 `state.json`（不是 `状态.json`）、周报月报存在 `汇总/`、AI 调用失败重试 2 次、设置里没有「AI 开关」；补充调试接口需要 `ZHIXING_DEBUG=1` 的说明。

### 测试

- 新增 `node:test` 用例：xlsx（共享字符串 / inlineStr / 富文本）、`assertDateKey`、残留锁、顺延记录、AI 进度建议约束、跨段拆目标、SSRF、写接口 Content-Type、`/debug/*` 开关与日期参数 400。
- `npm run check` 与 `npm test` 通过。

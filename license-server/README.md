# 激活码服务

购买时记录邮箱，发码时将购买邮箱与激活码、订单号关联。插件激活页只要求输入激活码；邮箱不保存在插件中，也不会随每次验证发送。后台只保存激活码的 SHA-256 摘要，明文激活码只在发放或补发时返回一次，请自行安全交付给买家。

当前服务已部署在 `https://x-growth-license.xiaopei0206.workers.dev`，数据库 `x-growth-license` 已创建。管理密钥存于 Cloudflare Worker Secret 和本机 macOS 钥匙串，钥匙串服务名为 `x-growth-license-admin`。不要把它放进扩展安装包。

## 部署

仅在全新账号重建服务时需要创建数据库。在 `license-server` 目录执行：

```sh
wrangler login
wrangler d1 create x-growth-license
```

将返回的 `database_id` 填入 `wrangler.jsonc`，再执行：

```sh
wrangler d1 execute DB --remote --file=schema.sql
wrangler secret put ADMIN_TOKEN
wrangler deploy
```

`ADMIN_TOKEN` 用随机生成的长密钥，仅放在 Worker Secret 和卖家的管理环境中，绝不可写进扩展。部署后，将 Worker 的 HTTPS 地址填入 `extension/license-config.js` 的 `apiBaseUrl`，将 `required` 改为 `true`，并在 `extension/manifest.json` 的 `host_permissions` 中加入该地址的 `https://<hostname>/*`。完成测试后再制作收费发行包。当前开发配置 `required: false`，不会锁住现有安装。

已有数据库升级时，只执行一次 `wrangler d1 execute DB --remote --file=migrations/001_add_expiration.sql`。迁移前发出的旧码保留原有效期，不会因这次升级突然到期。

## 发码与售后

管理接口使用 `Authorization: Bearer <ADMIN_TOKEN>`，请求体为 JSON。购买邮箱是必填项；有订单号时一并保存。不要把管理密钥或购买邮箱放进发给买家的安装包。

| 操作 | 接口 | 请求字段 |
| --- | --- | --- |
| 发码 | `POST /v1/admin/issue` | `buyerEmail`, 可选 `orderRef` 和一种期限字段 |
| 按邮箱查询 | `POST /v1/admin/lookup` | `buyerEmail` |
| 换机解绑 | `POST /v1/admin/reset` | `licenseId`, `buyerEmail` |
| 遗失后补发新码 | `POST /v1/admin/reissue` | `licenseId`, `buyerEmail`, 可选一种期限字段；默认保留原到期日 |
| 续费或改期 | `POST /v1/admin/renew` | `licenseId`, `buyerEmail`, 必填一种期限字段；原码继续可用 |
| 停用 | `POST /v1/admin/revoke` | `licenseId`, `buyerEmail` |

每个授权在数据库里有独立的 `expires_at`。新码不指定期限时从发放时起默认有效 3 天；可改用 `validDays`（1–3650 天）、`validMonths`（1–120 个日历月）、`expiresAt`（未来的 Unix 毫秒时间）或 `permanent: true`（永久，无到期日），**四者只能选一种**。到期后不能激活或续验，离线宽限也不会越过到期时间。激活码文本本身不包含日期。三个月、六个月按发码时刻顺延对应的 UTC 日历月；月末没有对应日期时，落在目标月最后一天。若销售承诺的是具体当地日期和时刻，请用带时区的 `--expires-at` 明确指定。

补发只换码，默认保留原会员到期日；若要更改期限需明确传入期限字段。续费保持原码和设备绑定不变：按天／按月续费从“当前到期日与现在较晚者”起计算，明确指定 `expiresAt` 则设为该时间，`permanent` 可升级永久。无到期日的授权不能误用按天／按月续费降级。查询结果包含订单号、激活状态、到期时间和是否已绑定设备，不包含明文激活码。收到售后咨询时，先用购买邮箱查记录，再通过该邮箱的来信或付款平台订单核对买家身份；**知道邮箱或激活码本身不足以批准解绑、补发、续费**。换机优先解绑原码，补发会立即使旧码失效。不要在公开聊天中索要付款截图、完整卡号或管理密钥。

可在卖家的电脑上用 `admin.mjs` 操作。它默认连接当前部署的 Worker，并从 macOS 钥匙串读取管理密钥，无需输入密钥。例如（以下命令在 `license-server/` 目录运行；项目根目录下的套餐发码示例见 [项目 README](../README.md#生成指定有效期的激活码卖家操作)）：

```sh
# 不指定期限默认仅 3 天
node admin.mjs issue --email buyer@example.com --order ORDER-123
# 月卡与年卡
node admin.mjs issue --email buyer@example.com --months 1
node admin.mjs issue --email buyer@example.com --months 12
# 自定义天数
node admin.mjs issue --email buyer@example.com --days 10
node admin.mjs issue --email buyer@example.com --plan 3m --order ORDER-456
node admin.mjs issue --email buyer@example.com --plan 6m
node admin.mjs issue --email buyer@example.com --plan permanent
node admin.mjs issue --email buyer@example.com --expires-at 2027-12-31T23:59:59+08:00
node admin.mjs lookup --email buyer@example.com
node admin.mjs reset --email buyer@example.com --license 授权ID
node admin.mjs renew --email buyer@example.com --license 授权ID --plan 3m
```

`--plan trial` 为 3 天；也可用 `--days N` 或 `--months N`。补发和停用分别使用 `reissue`、`revoke`。管理工具只在终端运行，不随扩展打包；发码或补发时的明文激活码会显示在终端，交付后请妥善清理终端记录。价格由销售渠道决定，发码服务只管理授权期限，不处理付款。

每个码第一次激活时绑定一个浏览器安装 ID。以后同一安装 ID 可重新验证；别的安装 ID 会收到 `bound_elsewhere`。这是减少普通转发安装包的措施，不能防止有意修改本地扩展的人。离线情况下，已激活安装最多保留七天宽限；服务端停用在下一次在线验证时生效。

本地检查：运行 `wrangler d1 execute DB --local --file=schema.sql`，用 `wrangler dev --local --var ADMIN_TOKEN:<测试密钥>` 启动服务，再运行 `LICENSE_TEST_BASE_URL=http://127.0.0.1:8787 LICENSE_TEST_ADMIN_TOKEN=<测试密钥> node ../tests/license-server-local.cjs`。测试会发放临时激活码并写入**本地**数据库，不要对正式服务运行。


## 运营后台与统计（0.9.0）

### 页面与登录

后台已于 2026-10-16 随现有 Worker 部署，地址为 `https://x-growth-license.xiaopei0206.workers.dev/admin/`。新表迁移已完成，并已设置独立的 `ADMIN_PASSWORD` Secret（不在文档记录值）。页面包含运营概览、用户与使用、授权管理、人工订单和操作日志；发码与补发只显示一次明文码。

管理员密码优先使用 Worker Secret `ADMIN_PASSWORD`；未设置时使用已有 `ADMIN_TOKEN`。旧管理命令仍使用 `ADMIN_TOKEN`，不会受独立登录密码影响。建议部署时设置独立密码：

```sh
# 以下命令在 license-server/ 目录运行；交互输入密码，不要写进命令参数或仓库
wrangler secret put ADMIN_PASSWORD
```

登录会建立 8 小时有效的 HttpOnly、Secure、SameSite=Strict Cookie；退出时服务端撤销会话。同来源和自定义请求头校验保护浏览器管理接口，CLI Bearer 认证继续可用。每来源连续 5 次登录失败后限制 15 分钟。后台页面不包含 Secret，统计接口只能凭随机安装身份和安装密钥访问自己的记录。

### 已有数据库升级

以下为正式服务操作，请在确认本机备份存放位置和部署授权后执行：

```sh
# 备份包含购买邮箱和订单等信息，请留在被忽略的本机目录
mkdir -p .backups
wrangler d1 export DB --remote --output .backups/pre-operations.sql

# 仅添加运营表，并将现有绑定记录导入激活历史；可重复执行
wrangler d1 execute DB --remote --file=migrations/002_operations.sql
wrangler deploy
```

新建数据库使用完整的 `schema.sql`；旧数据库已完成 `001_add_expiration.sql` 后只需运行 `002_operations.sql`，不要重复执行第一份迁移。第二份迁移不会修改原激活码、到期时间或绑定。迁移完成前不要部署新 Worker，服务部署完成前不要发布开启 `serverTrial` 的 0.9.0 安装包。

### 数据与统计口径

- `installations` 保存匿名安装身份、密钥摘要、首次登记、版本、试用起止时间与统计开关。试用从服务端首次开始起为 72 小时，老客户端迁移不会延长已知期限；换浏览器或重装形成新身份仍可能重复试用。
- `daily_activity` 按北京时间对安装每天去重，`daily_usage` 按客户端本机日期保存最近上报的关注汇总。客户端上报当日和前两日，服务端用递增 revision 更新，不能重复累加或让旧上报覆盖新上报；补记也可以下调。
- 0.9.1 匿名统计改为自动上报，无勾选开关；注册携带 `reportingRequired: true`，服务端为此安装启用上报。旧版隐私接口保留兼容，升级后原关闭设置不再阻止新版上报。活跃和关注分布仅反映成功上传的安装；断网、旧版本或客户端未运行时无法保证采集完整。这些数字为客户端汇总，不是最终关注关系或涨粉数。
- 今日新增为首次向新后台登记的安装数，旧用户升级也可能计入。今日付费激活按当天首次绑定事件的安装 ID 去重；重复验证不计，解绑与补发不抹掉历史。
- 转化率使用近 30 天开始且已结束的同批试用安装，分母不包含还没结束的试用；不是按当天新增除以当天付款计算。
- `orders` 是手工录入的微信收款记录，与发码分开保存。录入订单不自动发码或续费，不接在线付款；录入时检查授权 ID 与邮箱一致，并阻止重复订单号。
- `admin_audit` 记录发码、续费、解绑、补发、停用和订单录入，不记录激活码明文。`paid_activations` 保留首次绑定历史。

### 本地验证

```sh
wrangler d1 execute DB --local --file=schema.sql
wrangler dev --local --port 8788 --ip 127.0.0.1 --var ADMIN_TOKEN:local-test-only
```

另开终端，在项目根目录运行：

```sh
LICENSE_TEST_BASE_URL=http://127.0.0.1:8788 LICENSE_TEST_ADMIN_TOKEN=local-test-only node tests/operations-local.cjs
LICENSE_TEST_BASE_URL=http://127.0.0.1:8788 node tests/operations-client-local.cjs
npm test
```

测试严格限制在 localhost，不应针对正式数据库执行。本地页面 `http://127.0.0.1:8788/admin/` 使用上面的测试密码；测试记录和明文码仅存在本地。

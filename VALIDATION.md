# Validation — 2026-10-14

## 0.7.4 旧标签页关注漏计 — 2026-10-15

- 在用户 X 标签的日志中确认：扩展更新后旧内容脚本发出 `Extension context invalidated`，关注请求成功，但无法把事件写入本地计数。刷新该 X 标签页后恢复连接；更新扩展后的旧页不能自动补记已经漏掉的关注。
- 侧栏点击“关注”前先检查本地计数器是否可用。若扩展连接失效或账号未识别，不发送关注请求，侧栏持续提示刷新页面。若关注成功后仍保存失败，持续提示核对计数，避免静默漏记。取消关注和 SideX 的请求/按钮逻辑不变。
- 25 项 Node 检查和本机 HTTPS 浏览器回归通过。浏览器回归还模拟了扩展重载、旧标签页未刷新：点击关注时不向模拟 X 发送请求，并显示刷新提示。没有在真实账号执行关注。

## 0.4.6 关注后资料卡状态保持

- 修复侧栏筛选状态与资料卡状态不一致：关注请求成功时记录该页面内最新确认的关系，重开资料卡时优先使用；重新请求用户资料或评论时，旧关系数据不能覆盖它。
- 对已经在侧栏中关注过的作者，不再借用主页时间线里可能尚未同步的 X 原生悬浮卡，而使用侧栏资料卡及其已确认状态。其他作者仍按原路径展示。
- 本地 HTTPS 浏览器模拟覆盖“关注成功 → 只看未关注中消失 → 关闭筛选 → 重新悬停”，并放入同作者的旧原生悬浮卡验证不会回退为“关注”。未对真实账号执行关注操作。

## 0.4.5 黑色限流提示补漏

- 在用户打开的 X 页面上，确认残留黑色提示的元素为 SideX 的 `#sidepeek-toast`，而非 X 的原生提示。此前仅在本扩展的 `showToast` 分支识别限流；现在同时观察 SideX 实际生成的提示元素，出现限流文本时立即移除黑色提示并展示蓝色通知。
- 本地 HTTPS 浏览器模拟验证普通 SideX 提示不受影响、其他路径生成的英文限流提示会被替换、原有关注及评论加载 429 的提示仍正常。真实账号的限流事件未主动重现。

## 0.4.4 关注按钮状态同步

- 资料卡按钮统一根据关注接口的确认结果更新。普通关注成功显示“正在关注”；需要批准的账号显示“已请求”并停用重复点击。失败时恢复原状态。
- 本地 HTTPS 浏览器模拟验证成功关注、再次打开资料卡后状态保留、待批准请求状态、未关注筛选同步以及限流失败回退。未在真实 X 账号上执行关注。

## 0.4.3 SideX 操作限流提示

- 修复关注、取消关注及其他 SideX 操作的限流错误仍走黑色通用提示的遗漏。明确的限流错误现在走与评论加载 429 相同的 X 风格蓝色通知；普通操作提示不变。
- 操作限流通知持续 6 秒，关闭侧栏立即移除；评论加载限流通知仍持续到手动重试或关闭。浏览器模拟覆盖成功关注、失败的取消关注请求返回 429、黑色提示不出现、蓝色提示出现及关闭后清理。

## 0.4.2 原生风格限流通知

- 根据用户提供的 X 原生通知截图，改为页面顶部居中的宽幅、单行、蓝底白字限流提示；狭窄视口允许换行。侧栏仍提供手动重试，关闭侧栏或重新加载时移除通知。
- 本地 429 浏览器测试检查通知的颜色、位置、单行宽度、重试入口与关闭后的清理；没有自动重试或额外请求。

## 0.4.1 限流提示样式

- `TweetDetail` 返回 429 或明确的 rate-limit 错误时，侧栏显示持续可见的 X 蓝色提示，沿用 X 当前中文限流说明，并提供手动重试按钮；普通错误保留原有提示，同时转义错误文本。
- 本地 Chromium 模拟 429 响应，确认提示、颜色、重试入口和关闭侧栏；原有筛选与手动关注回归保持通过。没有自动重试或追加资料请求。

## 0.4.0 SideX 同页侧栏与评论筛选

- 集成 SideX 1.1.10 的侧栏核心、同页交互与页面请求桥；保留其头像悬停资料卡及关注操作流程。SideX MIT 许可文本随扩展一起分发。
- 评论筛选使用 SideX 已加载的 TweetDetail 作者模型。明确 `following: false` 且没有待批准请求，才满足「只看未关注」；明确 `is_blue_verified: true` 才满足「只看蓝 V」。两个开关同时开启时取交集；关系或认证字段未知时不猜测。过滤父评论时，匹配的子评论仍保留。
- 移除旧版独立阅读窗口及批量原生卡片预加载文件。发帖计数模块与手动补记保留；扩展仍只有 `storage` 和 `alarms` 权限，没有修改响应头规则。
- Node 测试覆盖筛选组合、未知状态、子评论、SideX 脚本范围与发帖计数。Chromium 本地 HTTPS 模拟验证：侧栏位于 X 页面右侧、主页 URL 和滚动位置不变、两个开关及交集结果、无资料预加载、一个 TweetDetail 响应支持重复切换、头像悬停后才请求资料、用户手动点击 SideX 关注按钮后结果更新、关闭侧栏。独立发帖计数浏览器回归覆盖原创、回复、转发、去重、多账号、弹窗与 X Pro。
- 浏览器截图 `sidex-filter-preview.png` 是本地模拟页面。此版本尚未在用户登录的真实 X 页面测试；SideX 悬停与关注流程由用户在 SideX 原扩展中试用过，本项目集成后仍需实际试用。测试没有进行真实关注、发布或请求头修改，不能证明 X 平台认可该方式或保证账号安全。

以下为旧版迭代记录；旧版阅读窗口与预加载资料卡已从 0.4.0 删除。

## Passed

- Node built-in runner: 15 tests covering supported endpoints, classification, response wrappers, quote posts, malformed/error responses, identity, duplicate handling, account separation, local midnight, 3/7-day ranges and DST.
- Chromium loaded the unpacked Manifest V3 extension in a temporary profile. All web requests were intercepted locally; no X account or live post was used.
- Full integration: Fetch original, XMLHttpRequest reply, repost, duplicate across two tabs, second account, account selection, action badge, HTTP 403, GraphQL error, unsupported response warning, 20 queued simultaneous publications, storage readback, popup reload and period selection.
- Popup screenshot visually inspected: counts, labels, coverage warning and account selector are readable.
- JavaScript syntax and manifest file references checked.

## Still requires ordinary real-world use

The response fixtures model known X GraphQL structures, not a captured current signed-in session. Verify one naturally occurring original, reply and repost after installing and refreshing X; no extra test posts are required. X may change its unpublished response structure or operation names. No claim is made that this is a verified complete account total.

Midnight and DST are covered in date logic tests. A real overnight Chrome session, service-worker suspension/resumption, sleep/wake and Chrome restart have not been separately exercised. The worker uses persisted local storage and a one-minute alarm; the popup recalculates every second while open.

Long-form posts, edit flows, scheduled publishing, incognito mode, other browsers and older Chrome releases have not been verified. The package targets Chrome 111+ and has no backend, credentials or paid API dependency.

## 0.1.1 repost fix

Added compact CreateRetweet responses without author/date/nested source. Extract the account from the page's twid identifier at request dispatch, and derive publication time from the returned new retweet snowflake ID. Covers missing/malformed account identifiers, conflicting authors, future IDs and duplicates. Browser regression covers compact responses via both Fetch and XMLHttpRequest, including an account change while a request is in flight.

Shape reference: https://github.com/fa0311/twitter-openapi/blob/main/dist/docs/openapi-3.0.yaml (Retweet schema). This is a community-maintained implementation reference, not an official X contract or a capture of the user's failed response.

## 0.1.2 daily manual correction

Added per-account, per-local-date replacement corrections for originals, replies and reposts. Unit tests cover old state compatibility, defaults, repeat saves, clearing, account isolation, daily rollover, range history, stale date rejection and integer validation. Browser regression covers the form, source totals, toolbar badge, account switching, popup reload, editing saved values and preserving unsaved fields when an automatic publication arrives. No real publications were performed.

## 0.1.3 X Pro compatibility — 2026-10-12

Added explicit script matches, sender validation and endpoint host support for pro.x.com, pro.twitter.com and tweetdeck.twitter.com. Browser fixtures cover Pro Fetch originals, XHR replies, compact reposts, ordinary-X/Pro deduplication and both legacy hosts. Unit tests reject unrelated domains and non-HTTPS origins. No live X Pro publication or delegated-account verification was performed.

The full browser run also exposed a delayed details-toggle event resetting newly typed manual values. Loading saved values now happens synchronously when opening the correction panel; the draft-preservation regression passes.


## 0.2.0 Home reading sidebars — 2026-10-13

- Node runner: 18 passing tests, adding profile/permalink validation, native media/application route exclusion and tab-scoped, marked-subframe embedding rules with cleanup.
- Existing Chromium integration passes in full, including counters, manual adjustments, popup, badge and X Pro coverage.
- A separate Chromium integration uses a local HTTPS server and self-signed test certificate. X DNS is mapped to that server; all other network destinations are blocked. Real responses carry `X-Frame-Options: DENY` and CSP with `frame-ancestors 'none'`, so the browser exercises actual response-header modification and iframe protection rather than only mocked DOM.
- Verified: Home URL, history length, scroll position and primary-column width unchanged on sidebar open; native post detail and profile frames; profile opened from a comment; third-level frame; middle-panel closure preserving neighboring frames; close-all; frame CSS hiding duplicate navigation; native like/reply/media/external click handling; selection and modified clicks; Enter activation; publication counting inside a frame and deduplication against the top page; persistent popup switch; narrow viewport.
- Verified embedding scope: top-level protections remain intact, unmarked subframes remain blocked, the last close cleans rules, full top-level reload cleans old rules, and rapid open/close/open does not invalidate the newest frame.
- `sidebar-preview.png` is a local fixture screenshot, not a screenshot of the user's X account. Visually checked for readable timeline, separate comment/profile columns and close controls.

Not verified against a current signed-in X session. Actual X layout, parent CSP, redirects, embedded login challenges, native media and interaction flows may differ from these fixtures. Login and cross-origin redirects may require the provided new-tab fallback. Sidebar interception is intentionally limited to ordinary X Home; X Pro retains counting support only. No live posts, replies, follows or likes were performed.


## 0.2.1 Comment relationship badges — 2026-10-13

- Node runner: 24 passing tests. Added nested user extraction across legacy, relationship-perspective and REST shapes; strict boolean handling; partial/conflicting/missing fields; GraphQL errors; two-direction labels; self and pending requests; per-field timestamps rejecting stale reads after a follow; viewer/endpoint validation; identical core resources in the two execution worlds.
- Separate script URLs are used for the page-world and isolated-world copies of the pure helper. Reusing one URL across both declarations left the page-world helper unavailable in the tested Chromium; the integration exposed and now guards that load path.
- Extended the local HTTPS browser fixture with native relationship Fetch responses, XHR refreshes and a simulated native follow button. Verified self, mutual, following-only, follower-only, neither, unknown, partial and pending labels; no badges on Home or profile pages; the explicit shortcut opens the adjacent profile without following; a rejected native follow leaves the badge unchanged; a successful native response updates the original comment in another frame.
- Verified account switches clear old badges before new data, and recycled comment DOM updates the badge and shortcut's target author. Existing nested sidebars, frame protection, publication deduplication, popup switch and responsive checks still pass. The independent original counter/browser suite also passes.
- `relationships-preview.png` shows the comment panel before any simulated follow, with the follower-only author highlighted and a visible shortcut. This is a local fixture, not a real account screenshot.
- The extension adds no relationship-query requests and performs no follow calls. Test follow responses are served by the local HTTPS fixture; no real accounts were followed or unfollowed. The current signed-in X response shapes remain unverified; omitted fields stay unknown. Relationship updates are shared within the current tab, not across tabs.


## 0.2.2 Preserve embedding protections (trial) — 2026-10-13

- Removed all header modification code, the DNR permission and extra host-permission declarations. Deleted the embedding-rule module. Explicit permissions are storage and alarms; existing X content-script matches remain. No extension code creates request rules or changes response headers.
- Moved the background worker to a new resource path (`service-worker.js`) to retire the old cached worker when updating from 0.2.1. The migration test exposed an old-worker cache leaving the sidebar unavailable when reusing the original worker resource; the new path resolves the tested migration.
- Node runner: 24 passing tests, including a manifest/source guard against response-header modification capabilities.
- Browser suite now serves unmodified SAMEORIGIN + frame-ancestors self headers for the allowed path, and checks the original CSP and XFO on both the main page and sidebar responses. Existing nesting, independent close, Home state, relationship labels/updates, viewer changes, popup settings and frame-publication counting pass.
- Denied cases: DENY + frame-ancestors none, CSP-only denial, and XFO-only denial. Both marked and unmarked frames respect the policy. Failed embedding displays a neutral failure explanation; no fallback window opens automatically. Retry can recover when the test server permits embedding again.
- Explicit fallback opens a normal X popup window with no sidebar marker. Verified native page visibility, no navigation of Home, and handling of rejected off-screen bounds by letting Chrome place the window. This fallback does not implement nested sidebars or relationship annotations in normal windows.
- Upgrade test first loads packaged 0.2.1, confirms an active session override and stores a persistent sentinel, closes the browser fully, copies in 0.2.2 and relaunches the same profile. Verified new version, preserved storage, absence of the DNR API and denial of a previously bypassed page. Hot reload without a browser restart is not claimed as verified; update instructions require a full restart when coming from 0.2.0/0.2.1.
- `sidebar-blocked-preview.png` shows the failure state from the local fixture. The other previews show the allowed same-origin fixture. These are not live X account screenshots.

Real signed-in X embedding remains unverified. This trial removes security-header modification; it retains passive publication/relationship observation and does not claim official X approval or zero account-enforcement risk.


## 0.2.3 Direct, reusable reading windows — 2026-10-13

- Removed the iframe loading path and its failure screen. A Home post or avatar click immediately opens a normal top-level X popup window; no second fallback-button click is required. Main clicks reuse the first owned reader, reader clicks reuse the next one, and obsolete downstream branches are closed.
- Migrated reader ownership, nesting and independent/all-close controls to a window manager. Window/tab IDs are stored only in chrome.storage.session, with ownership checked before navigation or closing; ordinary user tabs and other Home groups are preserved. Relation records remain ephemeral and are relayed within the owning group, without querying any extra X endpoint or executing follow operations.
- The upgrade integration exposed Chromium retaining the old fallback handler under its old worker resource path. The new reader-service-worker.js resource retires that cached handler; the same-profile 0.2.2-to-0.2.3 restart test now preserves existing statistics and loads the new direct-reader behavior.
- Node runner: 24 passing tests, including URL validation, relationship extraction/merge rules and the unchanged storage/alarms-only permission and no-header-modification guard.
- Local HTTPS Chromium integration: DENY + frame-ancestors none stay unchanged on both Home and reader responses, while normal top-level reader documents load. Verified one-click opening, no iframe or failure screen, unchanged Home URL/history/scroll/primary-column width, window reuse, nested avatars and relationship shortcuts, middle-window close preserving neighbors, next-window reuse after a middle close, branch cleanup, close-all, separate Home groups, and ordinary user-tab preservation.
- Relationship integration covers self, mutual, following-only, follower-only, neither, missing/partial/pending fields; native failed/successful follow responses; and account switching clearing stale labels. No Home/profile annotations and no automatic follow requests.
- Verified native buttons/media/external links, modified and selected clicks, Enter activation, persistent off/on setting, root-tab closure cleanup, publication observation in readers and deduplication against Home. The existing counter/manual/popup/badge/X Pro browser suite also passes.
- reader-preview.png is a visually checked local fixture screenshot, not the user's signed-in X account.

Not verified against a live signed-in X session. Native X response structure, authentication, responsive layout and network delays may differ. Service-worker suspension/resumption and real multi-monitor, zoom or full-screen window placement remain unverified; limited screen space may cause reader windows to overlap. This version preserves website security headers but does not claim platform approval or guaranteed account safety.


## 0.2.4 Per-comment mini profiles — 2026-10-13

- Each comment avatar column becomes a 224px mini profile with the original avatar node, name, handle, available bio/counts, relationship status and action. Native comment name/time/text/media/interaction nodes stay in their original parent. The main post, Home and full profile pages are not given mini profiles. Post reader windows widen to 664px; narrow windows scroll horizontally rather than collapsing the cards.
- Mini profile content is rendered from X's already observed responses using text nodes, not HTML. Public profile fields merge with per-field timestamps and share the existing ephemeral viewer-scoped cache. Missing metadata stays explicitly unavailable; missing relationship flags stay unknown. No per-user background API fetch or scrolling prefetch is implemented.
- Native follow adapter: pointer intent is delayed 180ms and cancelled on a quick pass; explicit focus/click prepares immediately. One native control is active at a time. The adapter asks X to show its native HoverCard and visually positions the actual matching user-ID follow button over that card's placeholder. It does not move/clone React nodes, call button handlers, issue follow requests, or synthesize clicks. A direct user click/key is required. Unknown/mismatched/unavailable cards have a visible fallback to the ordinary avatar hover card.
- The adapter checks the live viewer cookie and current comment author at input time, rejects synthetic input, and withdraws controls when author DOM is recycled, the account changes, the control changes to unfollow, or its card disappears. A failed native follow preserves the relationship label; a successful response updates the original card. Pending requests are not offered another follow action.
- Node runner: 26 passing tests, including profile extraction/validation, field timestamp snapshots, permission/source guards, relationship logic and counter logic. JavaScript syntax, manifest references and identical page/isolated core helpers checked.
- Local HTTPS Chromium integration passes with unmodified DENY and frame-ancestors none headers. Verified old-version upgrade with stored statistics preserved and the wider native window; direct opening/reuse/nesting/close; mini profile width/count and native content parent identity; no cards on Home/main post/profile; no profile loading before intent or during a fast pointer pass; no follow during hover; real trusted clicks on the original native button; failed/successful follow state; keyboard follow; immediate viewer switch; recycled author invalidation; mismatched card fallback; synthetic-click rejection; and narrow-window scrolling. The original counter/manual/badge/X Pro browser suite passes as well.
- The browser fixture uses a floating native-card model with a transformed ancestor, so positioning is checked in that case. Global forced Playwright viewport resizing was disabled for new windows so the actual 664px reader width is verified. This fixture models native UI behavior; it is not a captured React HoverCard from live X.
- A read-only inspection of the current signed-in X DOM confirmed Tweet-User-Avatar and UserAvatar-Container selectors and a 40px flex-basis avatar column beside the native comment body. The modified extension was not installed into that live session, and no real follow/unfollow operation was performed.
- mini-profile-preview.png and mini-profile-follow-preview.png are visually inspected local fixture screenshots.

Still unverified: current live X HoverCard markup and hover-event behavior, real native follow/request/error dialogs, multi-monitor/full-screen placement, and service-worker suspension/wake. The native adapter is a trial; a changed/unavailable X card shows a fallback instead of silently sending an API request. Website headers and explicit permissions remain unchanged (storage and alarms only). No claim of platform approval or guaranteed account safety is made.


## 0.2.5 Entire native profile cards — 2026-10-13

- Replaced extension-rendered mini profiles and the one-button overlay with a whole-card adapter. Removed the relationship-response observer, custom relationship UI, profile metadata helpers and cross-window profile cache from current source. Existing publication observation remains.
- The adapter reserves a 300px slot in the comment avatar column and positions the existing native HoverCard portal there. It never clones, moves or removes native nodes, reads React private fields, copies X component code, calls user/profile APIs, or synthesizes follow clicks. Native content, controls and state remain owned by X.
- Read-only investigation of current publicly served X frontend resources identified per-anchor independent hover state, the hoverCardParent test ID, the native 300px card width, hover-out polling and scroll dismissal behavior. The adapter uses normal bubbling hover events and a scoped leave-event guard to retain the native card. Public X bundles were used only for investigation and are not included in the extension or test fixture.
- Lazy policy: one pending card, starts at least 900ms apart, at most three retained nearby cards, eviction outside a 120px viewport margin, an 8-second timeout, and explicit retry instead of automatic failure loops. Escape releases active cards. Viewer changes and author/card identity changes invalidate controls.
- Test-only fixture uses React 18.3.1 and React DOM portals with per-anchor hover state, timers, polling and scroll dismissal modeled from that investigation. It is independently written, not X's component. Native-model cards include their own relationship text, verified mark, mutual followers, footer and React follow handler. No React libraries or fixture code are shipped in the extension.
- Local HTTPS integration verifies old-version restart upgrade with statistics preserved, unchanged DENY/CSP headers, direct reusable/nested reader windows, unchanged Home state, native React node identity and parent retention, full-card geometry, three-card cap, sequential loads, pointer leave/scroll retention, failed/successful trusted manual follows, native-card links, viewer-switch input guard, Escape, viewport eviction, author DOM recycling, mismatch timeout without repeated loading, ordinary-tab preservation, switch persistence and publication counting/deduplication.
- Original counter/manual/popup/badge/X Pro browser regression passes. Node runner: 18 tests; obsolete custom relationship tests were removed with that implementation. Syntax and manifest references checked.
- native-profile-preview.png is a visually inspected local React fixture, not a screenshot of the user's live X account.

The modified extension has not been installed into the user's signed-in X session. Current live card loading, retention, native relationship updates and follow/request/unfollow/error flows still need real-world trial. No real account was followed/unfollowed and no live publication was sent. Native internals can change; this is a trial adapter, without a guarantee of platform approval or account safety. Multi-monitor/full-screen placement and service-worker suspension/wake remain unverified.


## 0.2.6 Persistent native cards — 2026-10-13

- Read-only inspection of the user's actual loaded X reader found `hoverCardParent` surrounding a nested `HoverCard`. The prior closest-card event guard resolved the inner element, while ownership was registered on the outer element. Native mouse-out therefore still reached X and closed the card. The controller now canonicalizes both selectors to the outer portal for discovery, hover-leave protection and click handling.
- Loaded cards are retained when leaving the viewport and when Escape is pressed. Offscreen cards are hidden without unmounting and reposition when they return. Lazy loading remains serial with a minimum 900ms start interval, without a three-card retention cap. X-initiated portal replacement gets at most two automatic reconnection attempts; repeated failures show manual retry.
- Local React portal fixture now reproduces the nested X selectors. The browser regression checks prolonged pointer exit, Escape, scrolling away/back, DOM node identity and no repeat load, along with native manual follow and counter/window regressions. The user-signed-in browser was inspected read-only; this version has not been loaded into that live session and no follow action was performed.


## 0.2.7 Card row spacing — 2026-10-13

- Reserve space from the lower edge of the larger of the native outer portal and inner HoverCard, then add 16px for its shadow and a visible boundary before the next comment. Initial empty slots reserve 376px.
- Browser regression now measures the actual gap between a loaded card and the next comment slot. The prior persistent-card, native follow, window, counting and upgrade checks remain in the same integration suite. The user's live reader changed route while inspecting, so the spacing adjustment is based on DOM structure and a local React fixture; verify appearance in the updated X reader.


## 0.2.8 Load all rendered comment cards — 2026-10-13

- Removed viewport-gated lazy loading and the 900ms spacing. When a post reader's comment articles render, the extension starts their native profile cards, including rows below the fold, with up to six pending simultaneously. Further articles inserted by X are picked up by the existing mutation scan. This uses X's own hover/preload behavior, not extension profile API calls.
- Existing persistent card behavior and 16px row spacing remain. The local React portal fixture verifies that all eight currently rendered comments load without scrolling, starts overlap in time, and manual follow does not occur during loading. Large threads can cause more X-native profile requests and memory use; the six-card bound controls the burst, not the total.

## 0.2.9 Flex-column spacing fix — 2026-10-13

- Read-only inspection of the user's X reader found that a card slot with `style.height: 422px` still measured 300px in the browser. The real X avatar column uses vertical flex layout, and the slot's `flex: 0 0 300px` overrode its height. The slot now uses `flex: 0 0 auto`, so its explicit measured height determines row height.
- Profile cards are measured even while outside the viewport, so rows reserve full height before scrolling into view. The local browser fixture now uses a vertical flex avatar column and checks the slot's rendered height against both its inline height and the full card height plus gap.

## 0.3.0 Unfollowed comment filter — 2026-10-13

- Post readers expose a local toggle to show comments whose native X profile card explicitly offers Follow or Follow back. This checks the viewer's outgoing follow state; the incoming “Follows you” marker is ignored. Following, requested, own, unresolved and failed cards are excluded while filtering. The main post and Home timeline remain visible.
- The filter observes the same retained native cards already loaded for comments, without extra profile API requests. Pending rows stay in the DOM but visually hidden until classified so X's existing hover preload can finish. New comments are classified on insertion, and a successful native Follow action removes the comment from filtered results; failed actions keep it visible. Toggling off restores all comments.
- The local browser regression covers incoming-only follows, following, requested and unknown statuses, dynamic comments while filtering, toggle restoration, failed and successful follow, and toolbar height when counts appear. It still covers reader windows, geometry, publication counting, and upgrade persistence. Only currently X-rendered comments can be filtered.

## 0.3.1 Filter before native profile loading — 2026-10-13

- A user-supplied real `TweetDetail` response contained 19 posts and 11 distinct authors. All author records included explicit `relationship_perspectives.following`, `followed_by`, `follow_request_sent`, name, handle, avatar, bio and counts. The local extractor recovered 11 distinct authors, including 7 not followed. The response was examined locally and is not bundled with the extension.
- The existing Fetch/XHR observer now reads only successful X `TweetDetail` responses in addition to publication results. It sends compact author relationship records to the reading window; it does not issue a new relationship query or change request/response headers. Missing flags remain unknown.
- Post readers start with “只看未关注” enabled. Known following, requested, self and unknown authors are excluded before any synthetic hover preload. Only visible eligible comment authors get persistent native X cards; switching the filter off loads the rest. X's own card button remains in its original React portal and receives the user's trusted click. Failed follow keeps the comment; successful follow hides it.
- Node tests: 20 passing. Local HTTPS Chromium regression passes for filtered-before-preload (three eligible fixture authors loaded initially versus eight when filter is off), original card identity/layout, trusted native follow and failure recovery, dynamic comments, account switching, window handling, publication counting and no security-header changes. The separate publication/browser regression also passes.
- `filtered-profile-preview.png` is a local test fixture preview, not the signed-in X page. The updated extension was not installed into the live account. X can change its internal response shape, and triggering native cards can still cause X requests and rate limits; this test does not establish platform approval or guaranteed account safety.

## 0.3.2 Blue V filter — 2026-10-14

- The same `TweetDetail` author records include `is_blue_verified`. The supplied sample has an explicit boolean for all 11 distinct authors; 9 are marked blue verified and 5 are both blue verified and not followed. Missing blue status remains unknown rather than being inferred from legacy verification.
- Added a separate “只看蓝 V” toggle. With both toggles on, only comments whose authors are explicitly not followed and blue verified remain visible. Blue-only mode includes followed blue verified authors; both off restores all comments. The chosen blue toggle is saved locally and applied before native card preloading in the next reading window. No additional verification request or follow mutation was added.
- Node tests: 20 passing. The local HTTPS Chromium regression covers combined, blue-only and unfiltered states, verifies that a fresh reader loads only the intersection, and retains native follow interactions and account/window behavior. The independent publication-counting browser regression passes. `blue-filter-preview.png` is a simulated page, not a live signed-in X screenshot.

## 0.3.3 Skip native cards for already-followed authors — 2026-10-14

- A `TweetDetail` relationship of `following: true` prevents a new native profile-card preload regardless of the filter toggles. Preload also waits while the initial relationship state is still loading, avoiding a race when filters are turned off immediately. When filters are off, followed comments remain visible with X's original compact avatar column. A card that was already mounted before the author became followed stays mounted until navigation or refresh.
- No relationship query or follow action was added. The same X response supplies follow state, and following still uses the user's click on X's original button.
- Node tests: 20 passing. Local HTTPS Chromium regression checks that blue-only and unfiltered views still show followed comments while never preloading their cards, restores 40px avatars, and retains the prior native-follow, portal, spacing, window and counter coverage. The separate publication-counting browser regression passes. These checks use a local fixture; live X behavior still needs trial.


## 0.5.0 SideX 1.1.10 原版基底 — 2026-10-14

- 用本机 Chrome 已安装的 SideX 1.1.10 原版替换先前大幅改动的侧栏核心、页面桥接、样式与翻译后台；保留 MIT 许可。删除自定义关注状态表、按钮处理和关注成功后整体重绘资料卡的逻辑。
- 评论筛选只读取 TweetDetail 的 `following`、`follow_request_sent`、`is_blue_verified`；点击资料卡关注仍使用 SideX 原版 `TOGGLE_FOLLOW` 实现。成功后只同步该作者在已加载评论中的筛选显示，不重新创建资料卡或增加关注请求。
- 保留独立计数器、组合弹窗和 X 风格蓝色限流提示。SideX 原有语言、回复模式、翻译、子回复预览及宽度重置可在组合弹窗中设置。
- Node 测试 22 项通过。本机 HTTPS Chromium 模拟测试通过：过滤前后评论、懒加载资料卡、原版关注请求、成功后的隐藏与再次悬停、失败回滚和限流提示。计数器另有独立浏览器回归。模拟结果不能保证 X 在线接口长期稳定；未在真实账号上执行关注。


## 0.5.1 关注限制提示 — 2026-10-14

- X 在关注请求中返回 `You are unable to follow more people at this time` 时，SideX 原版会将错误中的 HTML 链接当普通文字放进黑色提示。扩展现在识别这条明确的 X 关注限制错误，显示与其他限流提示一致的蓝色通知；不渲染服务端 HTML。关注请求和失败回滚仍保持 SideX 原版逻辑。
- 本机 HTTPS Chromium 模拟了带 `<a href=...>` 的 X 错误响应，验证中文提示、无原始 HTML、原关注按钮回滚。


## 0.6.0 今日关注记录 — 2026-10-15

- 在原有只观察请求结果的计数链路中识别 X `friendships/create.json` 成功响应；拒绝、网络失败、取消关注和缺少明确成功字段的响应不计数。每个成功请求生成唯一事件 ID，由后台串行保存并按账号及电脑本地日期汇总。待批准的请求标为 pending；同一人取消后再关注按两次操作计，以保守估计频率。历史关注事件保留 32 天。
- SideX 关注逻辑和按钮未改。侧栏新增今日关注记录，弹窗显示自动+手动补记、待批准数及 400 参考值；350、390、400 三个阈值跨越时在当前页面提示。400 是 X 的每日技术上限，不保证低于此数时不会被限制。
- 本机单元测试覆盖请求识别、失败不计、待批准、去重、跨账号、跨日、手动替换和提醒阈值。HTTPS Chromium 模拟测试覆盖 SideX 原版关注成功后的侧栏/弹窗实时更新、失败不计、模拟官方页面关注请求、补记和 350 阈值提示。发帖计数回归测试通过。所有关注请求都在本机模拟服务器处理，未在真实账号上执行。

## 0.6.1 修复 SideX 关注计数 — 2026-10-15

- 已安装扩展目录实际是 0.6.0，但用户此前打开的 X 标签还运行旧内容脚本；刷新后侧栏出现“今日关注记录 0/400”。这解释了计数入口未出现，不能证明此前成功关注已被补录。
- SideX 原有关注请求与按钮状态逻辑保持不变。收到 SideX 成功回调后由计数链路记录操作；原有网络观察继续覆盖 X 页面原生关注。后台对同一账号和目标在短时间内收到的两路通知去重；目标身份仅暂存内存，不写入本地历史。
- Node 单元测试 24 项通过。本机 HTTPS Chromium 模拟测试分别覆盖 SideX 成功响应未带 `following` 字段时照样记数、正常成功响应的双路通知只记一次、失败不计与原有筛选行为。未在真实账号上执行关注。

## 0.6.2 X 原生关注者列表回关 — 2026-10-15

- 核对 X 当前公开网页脚本后确认列表按钮仍使用 `friendships/create`。放宽成功响应的识别：若 HTTP 状态成功、无错误、返回的目标用户 ID 与请求一致，且没有明确的未关注状态，即使缺少顶层 `following` 也记录。已明确失败、目标不匹配、缺少目标身份的响应继续拒绝。
- Node 单元测试 24 项通过；本机 HTTPS Chromium 测试覆盖模拟关注者列表页的原生请求、仅返回目标 ID 的成功响应、SideX 原生资料卡成功与双路去重。未在真实账号上执行关注。

## 0.6.3 回关响应含 `following: false` — 2026-10-15

- 用户提供的原生回关请求为 `POST /i/api/1.1/friendships/create.json`；返回目标用户资料与请求目标一致，但 `following` 和 `follow_request_sent` 均为 `false`，之前因此漏计。`followed_by: true` 只代表对方关注当前账号，不能用它证明已回关。
- 现在以成功的 HTTP 状态、无错误以及一致的目标用户 ID 记录原生回关操作，不把响应中的 `following: false` 当作请求失败。计数含义是成功返回的关注操作，不保证最终关注关系。X 拒绝、目标不匹配或响应缺少可确认的目标身份仍不计。SideX 原有按钮与请求实现未改。
- 24 项单元测试通过，本地 HTTPS Chromium 测试用同形态回关响应覆盖计数，并验证失败请求不计；未对真实 X 账号执行关注。
- 在用户 Chrome 的扩展详情页核对到仍运行 0.6.1；随后重新加载安装目录，界面显示 0.6.3，并刷新当前 X 标签。历史漏计不会由重新加载自动补齐，下一次回关需现场验证。

## 0.7.0 X涨粉工作台 — 2026-10-15

- 扩展名称、工具栏提示、弹窗和评论侧栏标题统一为「X涨粉工作台」；发布包改名为 `X涨粉工作台-0.7.0.zip`。上游 SideX 的 MIT 许可文件继续随包分发，并在 README 署名。
- 删除弹窗的侧栏开关和阅读设置。启用扩展即可使用同页侧栏；旧版保存的关闭状态、语言、回复模式、翻译来源与二级回复数量不再覆盖默认行为。蓝 V 筛选和计数数据保留。
- 弹窗改为并列的发布与今日关注计数卡，发布分类单独一行；补记入口折叠。达到 350/400 次时仍显示提醒。工具栏角标继续显示发布数。
- 24 项单元测试与两项本机 HTTPS Chromium 浏览器测试通过；浏览器测试还覆盖旧版关闭/英文/原生回复偏好不影响新版默认侧栏。未在真实 X 账号上执行关注。

## 0.7.1 侧栏关注计数同步 — 2026-10-15

- 侧栏资料卡成功关注后，由侧栏内容脚本直接通知扩展后台保存计数，不再依赖页面消息桥转发。SideX 的关注请求、按钮和失败回滚逻辑保持原样；X 原生页面关注仍由网络观察记录。
- 关注成功但本地记录失败时只输出诊断信息，不把已经完成的关注误判为失败并回滚按钮。弹窗每两秒从本地存储重读一次最新计数，即使错过一次变更通知也能恢复同步。浏览器模拟测试阻断页面关注消息转发，确认侧栏计数和图标弹窗仍实时更新；没有执行真实关注。

## 0.7.2 工具栏图标 — 2026-10-15

- 新增独立的评论气泡与增长柱形图标，提供 SVG 源文件和 Chrome 使用的 16、32、48、128 像素 PNG；工具栏、扩展管理页和弹窗统一使用。
- 图标只改变视觉识别，不改变计数、筛选或关注操作。
- 24 项 Node 测试通过；浏览器回归脚本因当前环境缺少 Playwright 未能运行。已在用户已安装扩展中重载并确认 Chrome 显示 0.7.2、新图标出现在弹窗头部，原有发布与关注计数仍可见。

## 0.7.3 只看未关注排除本人 — 2026-10-15

- TweetDetail 可能把当前账号标成 `following: false`。筛选现在从登录 cookie 读取当前账号 ID，并用页面账号名作补充，只在「只看未关注」开启时排除本人评论；单独看蓝 V 或查看全部评论时仍保留。
- 25 项 Node 测试通过。本机 HTTPS Chromium 模拟了当前账号的蓝 V 回复，验证组合筛选排除本人、关闭未关注筛选后恢复显示，并覆盖 SideX 原有资料卡悬停、关注与侧栏行为。未操作真实 X 账号。

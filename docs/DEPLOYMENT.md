# 云服务器部署 / Server deployment

[中文](#zh-cn) · [English](#english)

<a id="zh-cn"></a>

## 中文

面向一台 Linux 云服务器上的个人工作区：Node.js 24 运行应用，systemd 管理进程，Caddy 2.11+ 提供 HTTPS，无需 Docker。手机和电脑共用服务器上的故事和模型连接；语言、外观和未发送草稿仍按浏览器保存。设备配对允许访问整个工作区，不是多用户账号隔离。

### 安装

需要支持 systemd 的 Linux、[Node.js 24（含 npm）](https://nodejs.org/en/download)及 [Caddy](https://caddyserver.com/docs/install)。已有 Nginx/Caddy 时复用现有代理，保留其他站点。小内存服务器使用构建好的发布包，在开发机完成构建，不在服务器编译前端。

从 Releases 选择要部署的 `.tar.gz`，或在开发机按现有发布流程生成当前版本的包，再通过 SCP 上传。不要使用过期构建，不上传 Windows `node_modules`、开发机 `.env` 或私人数据。以下命令在服务器执行，归档名称按实际版本替换：

```sh
sudo useradd --system --user-group --home-dir /var/lib/ai-roleplay-agent --shell /sbin/nologin ai-roleplay-agent
sudo install -d -o ai-roleplay-agent -g ai-roleplay-agent -m 0755 /opt/ai-roleplay-agent
sudo tar -xzf '/tmp/AI-Roleplay-Agent-v<VERSION>.tar.gz' -C /opt/ai-roleplay-agent --strip-components=1
sudo chown -R ai-roleplay-agent:ai-roleplay-agent /opt/ai-roleplay-agent
cd /opt/ai-roleplay-agent
sudo -u ai-roleplay-agent npm exec --yes --package=pnpm@11.19.0 -- pnpm install --prod --frozen-lockfile
sudo chown -R root:root /opt/ai-roleplay-agent
```

已有服务用户或安装目录时，先检查现有部署，不重复创建或覆盖。SQLite 依赖在服务器本地安装；缺少预编译组件时，需按安装错误提示准备 C++ 编译工具。

将本仓库的 `deploy/` 模板同时上传；旧发布包不含这些模板时从当前源码单独复制。首次安装配置：

```sh
sudo install -m 0600 deploy/server.env.example /etc/ai-roleplay-agent.env
sudo install -m 0644 deploy/ai-roleplay-agent.service /etc/systemd/system/ai-roleplay-agent.service
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
sudoedit /etc/ai-roleplay-agent.env
```

将生成的随机字符串填入 `PAIRING_TOKEN`，妥善保存，不贴到日志、Git 或聊天里。模板的 `REPLACE-ME` 故意不满足长度要求，未修改时应用会拒绝启动。环境文件仅允许管理员读取。数据放在 `/var/lib/ai-roleplay-agent/`，与程序分开。

运行 `node --version`、`command -v node` 检查 Node.js。service 的 `ExecStart` 默认 `/usr/bin/node`，应改为实际的系统级 Node.js 路径；不能使用个人主目录里的 Node.js，因为启用了 `ProtectHome`。`StateDirectory` 创建并授权数据目录，`ProtectSystem` 让程序目录保持只读，参见 [systemd 文档](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)。

```sh
sudo systemd-analyze verify /etc/systemd/system/ai-roleplay-agent.service
sudo systemctl daemon-reload
sudo systemctl start ai-roleplay-agent
curl --fail http://127.0.0.1:14310/api/session
```

应返回 `requiresPairing: true`、`fakeModel: false`。应用启动时自动建库和迁移，不需另外运行数据库命令。确认验收后再用 `sudo systemctl enable ai-roleplay-agent` 设置开机启动。

### HTTPS 与验收

可以直接使用固定公网 IP，也可以使用指向服务器的域名。安全组和系统防火墙只为网站放行 TCP 80/443；SSH 按自己的管理方式限制来源。应用端口 14310 只监听本机，不对公网开放。使用域名时 A/AAAA 记录须与实际服务器地址一致，并按云平台要求办理备案。

将 [deploy/Caddyfile](../deploy/Caddyfile) 两处示例地址都改成自己的公网 IP 或域名，合并到 `/etc/caddy/Caddyfile`，保留已有站点和全局配置。已有全局块时，将 `default_sni` 合并进去，不再创建第二个全局块。IP 客户端不发送 SNI，云服务器公网 IP 又可能经过 NAT，因此需要 [default_sni](https://caddyserver.com/docs/caddyfile/options#default-sni) 选中正确证书。

模板显式使用 Let's Encrypt 的 `shortlived` 证书配置，支持[公网 IP 证书](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/)；证书有效期约六天，由 Caddy 自动续期，必须保留 Caddy 的证书存储目录并保持服务及验证端口可用。Caddy 默认给 IP 使用本地证书，不能省略这里的 ACME 配置。

Caddy 默认支持 SSE 流式回复；模板在 HTTPS 出口给配对 Cookie 添加 `Secure`。不改写 Host，也不需要开启 Fastify 的代理信任。参见 [TLS 配置](https://caddyserver.com/docs/caddyfile/directives/tls)、[Caddy HTTPS](https://caddyserver.com/docs/automatic-https) 和[反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

首次安装 Caddy 时按其安装方式启动；reload 用于已运行的服务。已有 Nginx 时配置等价的 HTTPS 反向代理，保留原始 Host，关闭 SSE 缓冲，并给配对 Cookie 添加 `Secure`，不要额外占用同一端口。

通过公网 HTTPS 验收首页、`/sw.js` 和 `/api/session`。未配对访问 `/api/settings/general` 应为 401。在手机和电脑分别输入配对码，确认读取同一工作区。更换配对码并重启会撤销所有设备的配对。模型验证先检查配置，不自动发起付费生成。

公网验证端口尚未放行时，可以先在自己的电脑建立 SSH 隧道，再打开 `http://127.0.0.1:14311` 临时验收；用户名、端口和地址按实际设置填写：

```sh
ssh -N -L 14311:127.0.0.1:14310 -p 22 user@server
```

结束后关闭隧道和临时验收服务，正式运行另行确认；不要直接把无配对的 HTTP 服务开放到公网。

### 数据迁移、备份和更新

只迁移独立资料时，从只读源库建立全新数据库，保留角色、主角、群组、世界书与条目、模型连接，以及全局设置和提示词预设；导入去重映射只保留这些资料的映射。仅复制这些资料引用的图片，验证新库完整性和聊天相关表为空后再上传。这样数据库文件中也不会残留已删除聊天的内容。模型密钥随连接迁移，源库保持不变。

先用空库验收。迁移现有工作区时，安排停止原服务并备份**实际配置的整个数据目录**；默认是 `apps/server/data/`，自定义 `DATABASE_PATH` 或 `ASSET_DIR` 时按实际位置处理。不要在运行中只复制 `.db`，SQLite 可能还有 WAL 文件。数据库含模型密钥，须通过 SSH/SCP 传输并保留本地备份。

停止云端应用，将数据库和图片分别放到 `/var/lib/ai-roleplay-agent/new-ai-chat.db` 和 `/var/lib/ai-roleplay-agent/assets/`，把数据目录所有者设为 `ai-roleplay-agent:ai-roleplay-agent`。保留数据布局，不导入或重写故事，不复制旧 `node_modules` 或整份旧 `.env`。启动后检查资料、图片和历史；保留原电脑备份，避免两边继续写入形成两份故事。

备份和更新前运行 `sudo systemctl stop ai-roleplay-agent`，备份整个 `/var/lib/ai-roleplay-agent/` 和 `/etc/ai-roleplay-agent.env`。更新时替换程序和服务器依赖，保留数据与配置，重启后验证首页、Service Worker 和认证。数据库可能在启动时迁移，回退代码时须恢复匹配的数据库备份。

用 `sudo systemctl status ai-roleplay-agent` 和 `sudo journalctl -u ai-roleplay-agent -n 50 --no-pager` 排查启动问题，不公开含密钥或私人故事的输出。

<a id="english"></a>

## English

The [deployment templates](../deploy/) run a personal workspace on Linux with Node.js 24, systemd, and Caddy 2.11+. Docker is not required. Use a prebuilt release on small servers and install its production dependencies on Linux; do not upload Windows `node_modules`.

- Install the app at `/opt/ai-roleplay-agent` and create the dedicated `ai-roleplay-agent` system user. The service writes to `/var/lib/ai-roleplay-agent`; application files remain read-only.
- Install [server.env.example](../deploy/server.env.example) as `/etc/ai-roleplay-agent.env` with mode `0600`. Replace the deliberately invalid pairing token with 32 cryptographically random bytes encoded as base64url. Keep it private.
- Install [ai-roleplay-agent.service](../deploy/ai-roleplay-agent.service), check its Node.js executable path, and validate the unit. Start it for acceptance testing before enabling it at boot. The app creates and migrates SQLite on startup.
- Keep port 14310 bound to loopback. Publish HTTPS through your existing proxy or the example [Caddyfile](../deploy/Caddyfile). Replace both example addresses. Merge `default_sni` into any existing global block: IP clients omit SNI, and cloud NAT may give the listener a different address. Preserve Host and SSE streaming, and mark the pairing cookie `Secure` at the HTTPS proxy. Keep existing sites.
- Use a fixed public IP or point your domain to the server, and allow TCP 80/443 through the firewall and cloud security group. The template explicitly selects Let's Encrypt's `shortlived` profile, which supports publicly trusted IP certificates. Caddy renews these automatically; retain its certificate storage and keep validation ports reachable. Follow your hosting provider's domain registration requirements. An SSH tunnel can be used for testing before public ports are available.
- Verify the homepage, Service Worker, and session endpoint over HTTPS. Private APIs must return 401 before pairing. Pair each device with the same token. Paired devices share the entire workspace; there is no account isolation. Browser preferences and unsent drafts stay on each device.
- Test with an empty database first. Stop the original server before backing up and transferring its full data directory, including assets and any SQLite WAL files. Use SSH, assign the destination data to the service user, and keep the original backup. Do not rewrite stories or copy old environment settings wholesale.
- For a resource-only migration, build a fresh database from a read-only source, retaining only standalone resources, global settings, prompt presets, model connections, and their import mappings. Copy only referenced images and verify that all chat tables are empty before uploading. This keeps deleted chat content out of the database file as well. Model credentials move with their connections; the source stays unchanged.
- Stop the service before backups and updates. Preserve the state directory and private environment file. Rollbacks require a matching database backup. Close temporary acceptance services and SSH tunnels afterward. Do not make paid model requests automatically.

See the Chinese section for installation commands and the official [Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and [systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) documentation for proxy and service options.

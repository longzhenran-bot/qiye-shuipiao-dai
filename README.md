# 企业税票贷：申请 + 管理后台起始项目

此项目包含企业申请页、申请状态查询页、管理员工作台、Node.js API 与 PostgreSQL 数据表结构。它是需要配置、测试和部署的代码起点，不表示系统已部署或已通过生产安全审计。

## 目录
- `public/index.html`：客户申请与进度查询页面
- `public/admin.html`：管理员登录、申请筛选与审核工作台
- `src/server.js`：API、验证、登录和审核接口
- `src/schema.sql`：数据库表结构与审核事件日志
- `scripts/create-admin.js`：首次创建管理员账号

## 部署前提
1. 一个支持 Node.js 20+ 的 HTTPS 后端托管服务。
2. PostgreSQL 数据库；生产环境启用 TLS，并限制数据库网络访问。
3. 将前端发布到现有 GitHub Pages，后端部署到独立服务。
4. 在两份 HTML 的脚本顶部将 `API_BASE` 改成后端 HTTPS 域名；在后端环境变量 `CORS_ORIGIN` 配置确切前端来源。GitHub Pages 项目站点的 origin 是 `https://longzhenran-bot.github.io`，不是完整路径。

## 初始化
1. 创建数据库并执行 `src/schema.sql`。
2. 复制 `.env.example` 为 `.env`，填写 `DATABASE_URL`、至少 32 字符的随机 `JWT_SECRET`、`CORS_ORIGIN`，以及仅用于首次创建管理员的强密码。
3. 安装依赖：`npm install`
4. 创建首个管理员：`npm run create-admin`
5. 删除或清空 `INITIAL_ADMIN_PASSWORD` 等初始化变量，再启动服务：`npm start`
6. 检查 `GET /api/health` 返回 `{"ok":true}`，然后在浏览器端测试申请、查询、管理员登录与审核。

## API
- `GET /api/health`
- `POST /api/applications`
- `POST /api/applications/status`
- `POST /api/admin/login`
- `GET /api/admin/applications?page=1&status=pending&q=`（Bearer token）
- `PATCH /api/admin/applications/:id`（Bearer token）

## 重要安全与上线事项
- 不要把 `.env`、数据库密码、JWT secret 或数据库连接串提交到 GitHub；`service_role`/管理员密钥绝不能进入浏览器。
- 当前页面仅收集最低限度的申请信息，不提供身份证、银行流水或税票原件上传。确需收集敏感资料时，应另行设计受控私有文件存储、短时签名访问、恶意文件扫描、保留期限和访问审计。
- 当前客户查询码为 6 位数字并以哈希存储；生产环境建议改为更高熵的随机查询令牌，加入查询接口独立限流、告警和异常访问监测。申请编号与查询码必须同时保管。
- 当前管理员 token 存在页面内存中，刷新页面会退出；正式生产应补充更完善的会话管理、MFA、CSRF 防护（如采用 Cookie）、管理员角色权限、密码重置、登录审计与强制退出机制。
- 需要为管理员审核动作加入明确的状态迁移规则、复核/双人审批（按业务风险）、完整不可篡改审计和数据导出权限控制。
- 上线前核验贷款业务资质适用范围、利率/费用展示、用户授权、隐私政策、个人信息保护、数据跨境与本地化要求、电子签约、投诉与争议处理、数据留存和删除机制。由法律与安全专业人员审查。
- 申请提交不是贷款批准、授信、合同签署或放款承诺；不得向客户宣传未经确认的额度、利率或审批时效。

## 当前尚未完成
未自动连接用户的 GitHub 仓库、未创建托管数据库、未部署 API，也未将代码推送到线上网站。需要用户配置托管服务和环境变量后才能进行联调。

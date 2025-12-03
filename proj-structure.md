# Project Structure for FluxiBot

```
arxsbot/
├─ package.json                     # 根项目（后端 + 工具）
├─ tsconfig.json
├─ pnpm-workspace.yaml             # 如果用 monorepo，可选
├─ .eslintrc.cjs
├─ .prettierrc
├─ .gitignore
├─ README.md
├─ LICENSE
│
├─ config/                          # 配置文件（可用 yaml/json5）
│  ├─ default.yaml                  # 默认配置
│  ├─ development.yaml
│  ├─ production.yaml
│  ├─ models.yaml                   # LLM / 各模型配置
│  ├─ risk-policy.yaml              # 频控 / 账号风控策略
│  ├─ personas.yaml                 # 多人格定义
│  ├─ workflows.yaml                # IFTTT-style workflow 定义
│  └─ platforms/
│     ├─ qq.napcat.yaml             # NapCat / QQ 平台配置
│     ├─ discord.yaml
│     └─ telegram.yaml
│
├─ scripts/                         # 开发 / 运维脚本
│  ├─ dev.ts
│  ├─ migrate.ts
│  ├─ seed-demo-data.ts
│  └─ sync-config-schema.ts
│
├─ src/
│  ├─ index.ts                      # 程序入口（调用 bootstrap/main）
│  ├─ bootstrap/
│  │  ├─ main.ts                    # 装配所有层、启动服务
│  │  └─ container.ts               # 简单 DI / 单例管理
│  │
│  ├─ adapter/                      # Layer 0: 多平台/协议适配 + 虚拟设备层
│  │  ├─ index.ts
│  │  ├─ qq/
│  │  │  ├─ napcatClient.ts         # 与 NapCat 建立连接，收发事件
│  │  │  ├─ qqEventMapper.ts        # QQ 原始事件 → core.model.Event
│  │  │  └─ qqActionAdapter.ts      # core.model.Action → QQ 平台操作
│  │  ├─ discord/
│  │  │  ├─ discordClient.ts
│  │  │  ├─ discordEventMapper.ts
│  │  │  └─ discordActionAdapter.ts
│  │  ├─ telegram/
│  │  │  ├─ telegramClient.ts
│  │  │  ├─ telegramEventMapper.ts
│  │  │  └─ telegramActionAdapter.ts
│  │  └─ virtualDevice/             # Virtual Device Layer（不写黑科技，做行为建模 & 会话抽象）
│  │     ├─ deviceProfile.ts        # 设备画像（PC / Mobile / Web）
│  │     ├─ sessionManager.ts       # 多 Session 管理（一个账号多端）
│  │     ├─ behaviorProfile.ts      # 不同设备/账号的行为风格参数
│  │     └─ metrics.ts              # 设备层相关统计
│  │
│  ├─ infra/                        # Layer 1: 基础设施（config/logger/db/http 等）
│  │  ├─ config/
│  │  │  ├─ config.ts               # 统一读取 config/*，暴露 typed config
│  │  │  └─ schema.ts               # 配置 schema & 校验
│  │  ├─ logger/
│  │  │  ├─ logger.ts               # 日志入口
│  │  │  └─ transports/
│  │  │     ├─ consoleTransport.ts
│  │  │     ├─ fileTransport.ts
│  │  │     └─ webSocketTransport.ts# 推送日志到 WebUI
│  │  ├─ http/
│  │  │  ├─ httpServer.ts           # 管理 API / Webhook / WebUI 后端
│  │  │  ├─ routes/
│  │  │  │  ├─ healthRoutes.ts
│  │  │  │  ├─ metricsRoutes.ts
│  │  │  │  ├─ adminRoutes.ts       # 管理端：账号、Persona、workflow 配置
│  │  │  │  └─ webhookRoutes.ts     # 外部回调 / 触发器
│  │  │  └─ middleware/
│  │  │     ├─ authMiddleware.ts
│  │  │     ├─ errorMiddleware.ts
│  │  │     └─ requestLoggingMiddleware.ts
│  │  ├─ db/
│  │  │  ├─ index.ts                # 数据库初始化
│  │  │  ├─ migrations/             # 迁移脚本（knex / prisma 等）
│  │  │  └─ orm/
│  │  │     ├─ MessageEntity.ts
│  │  │     ├─ UserEntity.ts
│  │  │     ├─ GroupEntity.ts
│  │  │     ├─ MemoryEntity.ts
│  │  │     ├─ WorkflowEntity.ts
│  │  │     └─ PersonaEntity.ts
│  │  ├─ messageBus/                # 出入站消息总线封装
│  │  │  ├─ outgoingMessageBus.ts   # 对 adapter 发送消息/动作
│  │  │  ├─ incomingEventBus.ts     # 适配器推来的事件总线上流
│  │  │  └─ eventEmitter.ts
│  │  ├─ telemetry/
│  │  │  ├─ metrics.ts              # Prometheus / OpenTelemetry 指标
│  │  │  ├─ heartbeat.ts            # 心跳任务
│  │  │  └─ tracing.ts
│  │  └─ scheduler/
│  │     ├─ scheduler.ts            # 定时任务调度（node-cron / bullmq 等）
│  │     └─ jobs/
│  │        ├─ cleanupJob.ts        # 数据清理
│  │        ├─ statsJob.ts          # 行为统计
│  │        └─ heartbeatJob.ts
│  │
│  ├─ core/                         # Layer 2: Bot 内核（Intent / Persona / Workflow / Plugin）
│  │  ├─ model/
│  │  │  ├─ Event.ts                # 平台无关事件模型
│  │  │  ├─ Message.ts              # 抽象消息模型
│  │  │  ├─ User.ts
│  │  │  ├─ Group.ts
│  │  │  ├─ Context.ts              # 会话上下文（用户 + 群 + 历史）
│  │  │  ├─ Intent.ts               # 意图模型
│  │  │  ├─ Action.ts               # 抽象平台动作（发送/撤回/改公告等）
│  │  │  ├─ Persona.ts              # 人格定义 / 状态
│  │  │  └─ Workflow.ts             # workflow 元数据结构
│  │  ├─ router/
│  │  │  ├─ eventRouter.ts          # Event → 对应 pipeline（私聊/群聊/系统事件）
│  │  │  └─ routeDefinitions.ts     # 路由规则
│  │  ├─ dispatcher/
│  │  │  ├─ dispatcher.ts           # Intent / Handler 分发中枢（带中间件）
│  │  │  ├─ middleware/
│  │  │  │  ├─ securityMiddleware.ts# 挂接 security 层中间件
│  │  │  │  ├─ loggingMiddleware.ts
│  │  │  │  └─ contextMiddleware.ts
│  │  │  └─ handlerRegistry.ts      # 注册各 Apps handler / 插件 handler
│  │  ├─ intent/
│  │  │  ├─ intentRecognizer.ts     # 事件 → Intent（规则 + 模型结合）
│  │  │  ├─ intentRules.ts          # 规则引擎 / pattern 匹配
│  │  │  └─ intentMLModel.ts        # 可选：ML/LLM 意图分类
│  │  ├─ persona/
│  │  │  ├─ personaManager.ts       # 加载 personas.yaml、持久化状态
│  │  │  ├─ personaRouter.ts        # 根据 Intent / Context 选哪些 Persona 参与
│  │  │  └─ personas/               # 内置 persona 原型
│  │  │     ├─ supportPersona.ts
│  │  │     ├─ knowledgePersona.ts
│  │  │     ├─ gamePersona.ts
│  │  │     └─ moderatorPersona.ts
│  │  ├─ memory/
│  │  │  ├─ shortTermMemory.ts      # 会话级缓存（最近 N 条）
│  │  │  ├─ longTermMemory.ts       # 长期记忆聚合
│  │  │  └─ summarizer.ts           # 历史摘要 / 记忆压缩
│  │  ├─ workflow/
│  │  │  ├─ workflowEngine.ts       # IFTTT-style 引擎（trigger → condition → actions）
│  │  │  ├─ workflowDsl.ts          # Workflow DSL 与解析/验证
│  │  │  └─ workflowRegistry.ts     # 注册和管理工作流
│  │  ├─ plugin/
│  │  │  ├─ pluginManager.ts        # 加载 / 启停插件
│  │  │  ├─ pluginBase.ts           # BasePlugin / BaseCommand / BaseTool 等
│  │  │  ├─ pluginManifest.ts       # 插件 manifest 结构 & 解析
│  │  │  └─ pluginEvents.ts         # 向插件广播 ON_START / ON_MESSAGE 等事件
│  │  └─ context/
│  │     ├─ conversationContext.ts  # 封装上下文读取/更新
│  │     └─ globalContext.ts        # 跨平台全局状态
│  │
│  ├─ security/                     # Layer 3: 安全 / 风控 / 隐私
│  │  ├─ rateLimit/
│  │  │  ├─ rateLimiter.ts          # 通用限流器
│  │  │  ├─ tokenBucket.ts
│  │  │  └─ quotaPolicy.ts          # per-user / per-group / per-account 策略
│  │  ├─ behavior/
│  │  │  ├─ behaviorModel.ts        # 人类行为模型（阅读时间、回复节奏等）
│  │  │  ├─ typingSimulator.ts      # 打字/停顿模拟
│  │  │  ├─ delayStrategy.ts        # 不同场景的延迟策略
│  │  │  └─ anomalyPatterns.ts      # 异常行为模式（刷屏等）
│  │  ├─ content/
│  │  │  ├─ contentFilter.ts        # 文本过滤（敏感词 / 长度 / 风险）
│  │  │  ├─ sensitiveLexicon.ts
│  │  │  ├─ llmGuardrail.ts         # LLM 输出二次审查
│  │  │  └─ ocrClassifier.ts        # 图像文本分类/检查 hook（调用 OCR 工具）
│  │  ├─ risk/
│  │  │  ├─ riskDetector.ts         # 检测被限流/静默/被踢等信号
│  │  │  ├─ riskSignals.ts
│  │  │  └─ mitigationStrategies.ts # 风险应对策略（降级、切号、冷却）
│  │  ├─ accounts/
│  │  │  ├─ multiAccountPolicy.ts   # 多账号使用策略
│  │  │  └─ accountStateTracker.ts  # 账号状态跟踪（正常 / 风控中 / 封禁疑似）
│  │  └─ privacy/
│  │     ├─ piiScrubber.ts          # PII 脱敏
│  │     ├─ retentionPolicy.ts      # 数据保留与清理策略
│  │     └─ auditLog.ts             # 审计日志
│  │
│  ├─ apps/                         # Layer 4: 具体业务能力（真正的“bot 功能”）
│  │  ├─ chatAi/
│  │  │  ├─ chatAiHandler.ts        # 对话 AI 主 handler（Intent→LLM→Action）
│  │  │  ├─ llmClient.ts            # OpenAI / Gemini / 自建模型封装
│  │  │  ├─ promptTemplates.ts
│  │  │  └─ responsePostProcessor.ts# 改写/降级/拆分回复
│  │  ├─ groupAdmin/
│  │  │  ├─ groupAdminHandler.ts    # 踢人/禁言/群公告等
│  │  │  ├─ moderationRules.ts
│  │  │  └─ auditLogIntegration.ts
│  │  ├─ fun/
│  │  │  ├─ memeHandler.ts
│  │  │  ├─ miniGamesHandler.ts
│  │  │  └─ randomReplyHandler.ts
│  │  ├─ tools/
│  │  │  ├─ translateTool.ts
│  │  │  ├─ searchTool.ts
│  │  │  ├─ ocrTool.ts              # 调 OCR 服务
│  │  │  └─ ttsTool.ts
│  │  ├─ automation/                # IFTTT / Zapier 风格自动化
│  │  │  ├─ workflowLibrary.ts      # 内置常用 workflow 模板
│  │  │  ├─ triggers/
│  │  │  │  ├─ messageTriggers.ts
│  │  │  │  ├─ scheduleTriggers.ts
│  │  │  │  └─ platformEventTriggers.ts
│  │  │  └─ actions/
│  │  │     ├─ messagingActions.ts
│  │  │     ├─ fileActions.ts
│  │  │     └─ externalApiActions.ts
│  │  ├─ socialAgent/               # Social Goal AI：活跃度、冲突缓解等
│  │  │  ├─ socialGoalEngine.ts
│  │  │  ├─ socialStrategies.ts
│  │  │  └─ newcomerOnboarding.ts   # 新人欢迎/引导
│  │  └─ identity/                  # 跨平台人格一致性
│  │     ├─ crossPlatformIdentityService.ts # GlobalIdentity 维护
│  │     └─ identityLinker.ts       # 账号绑定逻辑（需用户同意）
│  │
│  ├─ webui-backend/                # WebUI 后端（配置管理 / 日志查看）
│  │  ├─ webuiServer.ts
│  │  ├─ routes/
│  │  │  ├─ configRoutes.ts
│  │  │  ├─ personaRoutes.ts
│  │  │  ├─ workflowRoutes.ts
│  │  │  └─ logsRoutes.ts
│  │  └─ ws/
│  │     └─ logStream.ts            # WebSocket 日志流
│  │
│  └─ types/
│     ├─ index.d.ts
│     └─ external.ts                # 外部 SDK 类型声明（如果需要）
│
├─ plugins/                         # 独立插件（可单独编译发布）
│  ├─ README.md
│  ├─ example-plugin/
│  │  ├─ plugin.manifest.json
│  │  └─ index.ts
│  └─ ...
│
├─ webui-frontend/                  # 可选：独立前端（React / Next.js）
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ components/
│  │  ├─ pages/
│  │  │  ├─ Dashboard.tsx
│  │  │  ├─ Personas.tsx
│  │  │  ├─ Workflows.tsx
│  │  │  └─ Logs.tsx
│  │  └─ api/
│  └─ public/
│
├─ tests/
│  ├─ unit/
│  │  ├─ core/
│  │  ├─ security/
│  │  └─ apps/
│  ├─ integration/
│  │  ├─ adapter/
│  │  └─ workflows/
│  └─ e2e/
│     └─ basicFlows.test.ts
│
└─ examples/                        # 示例：最小 bot / Persona demo / Workflow demo
   ├─ simpleEchoBot/
   ├─ personaDemo/
   └─ workflowDemo/
```

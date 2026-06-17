import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export const PainCategorySchema = z.enum([
  'produtividade',
  'aprendizado',
  'financas',
  'saude',
  'relacionamentos',
  'negocios',
  'outros',
])
export type PainCategory = z.infer<typeof PainCategorySchema>

export const TrendDirectionSchema = z.enum(['crescendo', 'estavel', 'caindo'])
export type TrendDirection = z.infer<typeof TrendDirectionSchema>

export const TechnicalComplexitySchema = z.enum(['baixa', 'media', 'alta'])
export type TechnicalComplexity = z.infer<typeof TechnicalComplexitySchema>

export const CeoDecisionSchema = z.enum(['pendente', 'aprovado', 'rejeitado', 'mais-pesquisa'])
export type CeoDecision = z.infer<typeof CeoDecisionSchema>

export const KnowledgeStatusSchema = z.enum(['new', 'validated', 'discarded'])
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>

export const ConnectorStatusSchema = z.enum(['ready', 'partial', 'missing-config', 'planned'])
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>

export const ConnectorNameSchema = z.enum([
  'micro-offer',
  'openai',
  'serpapi-trends',
  'supabase-postgres',
  'youtube-research',
  'browser-playwright',
  'firecrawl-reference',
  'meta-ads',
  'checkout',
  'email-crm',
])
export type ConnectorName = z.infer<typeof ConnectorNameSchema>

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE DATA TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const RawCommentSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  videoTitle: z.string(),
  channelId: z.string(),
  text: z.string(),
  likeCount: z.number().int().nonnegative(),
  publishedAt: z.string(), // ISO 8601
  replyCount: z.number().int().nonnegative(),
})
export type RawComment = z.infer<typeof RawCommentSchema>

export const RawCommentsFileSchema = z.object({
  metadata: z.object({
    agentVersion: z.string(),
    processedAt: z.string(),
    durationMs: z.number(),
    videoId: z.string(),
    videoTitle: z.string(),
    totalFetched: z.number(),
    totalAfterFilter: z.number(),
  }),
  comments: z.array(RawCommentSchema),
})
export type RawCommentsFile = z.infer<typeof RawCommentsFileSchema>

export const PainPointSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  frequency: z.number().int().positive(),
  examples: z.array(z.string()).min(1).max(10),
  category: PainCategorySchema,
  sourceVideoIds: z.array(z.string()),
  extractedAt: z.string(), // ISO 8601
})
export type PainPoint = z.infer<typeof PainPointSchema>

export const PainPointsFileSchema = z.object({
  metadata: z.object({
    agentVersion: z.string(),
    processedAt: z.string(),
    durationMs: z.number(),
    sessionId: z.string(),
    totalPainPoints: z.number(),
    sourceFiles: z.array(z.string()),
  }),
  painPoints: z.array(PainPointSchema),
})
export type PainPointsFile = z.infer<typeof PainPointsFileSchema>

export const VolumeReportSchema = z.object({
  painPointId: z.string(),
  googleTrendsScore: z.number().min(0).max(100),
  monthlySearchVolume: z.number().nonnegative(),
  trendDirection: TrendDirectionSchema,
  topRelatedQueries: z.array(z.string()),
  competitorCount: z.number().nonnegative(),
  marketScore: z.number().min(0).max(100),
})
export type VolumeReport = z.infer<typeof VolumeReportSchema>

export const VolumeReportFileSchema = z.object({
  metadata: z.object({
    agentVersion: z.string(),
    processedAt: z.string(),
    durationMs: z.number(),
  }),
  report: VolumeReportSchema,
})
export type VolumeReportFile = z.infer<typeof VolumeReportFileSchema>

export const ValidatedIdeaSchema = z.object({
  id: z.string().uuid(),
  painPointId: z.string(),
  name: z.string(),
  description: z.string(),
  targetAudience: z.string(),
  coreFeatures: z.array(z.string()).max(5),
  pricingModel: z.string(),
  estimatedMRR: z.string(),
  technicalComplexity: TechnicalComplexitySchema,
  timeToMVP: z.string(),
  marketScore: z.number().min(0).max(100),
  validatedAt: z.string(),
  ceoDecision: CeoDecisionSchema.default('pendente'),
  ceoNotes: z.string().default(''),
})
export type ValidatedIdea = z.infer<typeof ValidatedIdeaSchema>

export const ConnectorHealthSchema = z.object({
  name: ConnectorNameSchema,
  status: ConnectorStatusSchema,
  configured: z.boolean(),
  requiredEnv: z.array(z.string()),
  missingEnv: z.array(z.string()),
  capabilities: z.array(z.string()),
  notes: z.array(z.string()),
})
export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>

export const McpEventSchema = z.object({
  id: z.string().uuid(),
  connector: ConnectorNameSchema,
  agentName: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  status: z.enum(['started', 'success', 'failed', 'skipped']),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string(),
})
export type McpEvent = z.infer<typeof McpEventSchema>

export const MicroOfferRecordSchema = z.object({
  ideaId: z.string().uuid(),
  stage: z.string(),
  ownerAgent: z.string(),
  status: z.enum(['pendente', 'em-progresso', 'bloqueado', 'pronto']),
  artifactPaths: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  updatedAt: z.string(),
})
export type MicroOfferRecord = z.infer<typeof MicroOfferRecordSchema>

export const OfferAddonSchema = z.object({
  name: z.string(),
  promise: z.string(),
  price: z.string(),
})
export type OfferAddon = z.infer<typeof OfferAddonSchema>

export const OfferBriefSchema = z.object({
  ideaId: z.string().uuid(),
  productName: z.string(),
  targetAudience: z.string(),
  urgentProblem: z.string(),
  desire: z.string(),
  uniquePromise: z.string(),
  uniqueMechanism: z.string(),
  offerStack: z.array(z.string()).min(1),
  bonuses: z.array(z.string()),
  price: z.string(),
  orderBump: OfferAddonSchema,
  upsell: OfferAddonSchema,
  guarantee: z.string(),
  proofAssetsNeeded: z.array(z.string()),
  objections: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type OfferBrief = z.infer<typeof OfferBriefSchema>

export const FunnelTypeSchema = z.enum(['pagina-direta', 'vsl-curta', 'quiz', 'advertorial'])
export type FunnelType = z.infer<typeof FunnelTypeSchema>

export const TrafficTemperatureSchema = z.enum(['frio', 'morno', 'quente'])
export type TrafficTemperature = z.infer<typeof TrafficTemperatureSchema>

export const AwarenessLevelSchema = z.enum([
  'inconsciente',
  'problema',
  'solucao',
  'produto',
  'muito-consciente',
])
export type AwarenessLevel = z.infer<typeof AwarenessLevelSchema>

export const FunnelStrategySchema = z.object({
  ideaId: z.string().uuid(),
  recommendedFunnel: FunnelTypeSchema,
  why: z.string(),
  trafficTemperature: TrafficTemperatureSchema,
  awarenessLevel: AwarenessLevelSchema,
  pageSections: z.array(z.string()).min(1),
  leadMagnet: z.string(),
  checkoutFlow: z.string(),
  orderBumpPlacement: z.string(),
  upsellPlacement: z.string(),
  trackingEvents: z.array(z.string()).min(1),
  mainRisks: z.array(z.string()),
})
export type FunnelStrategy = z.infer<typeof FunnelStrategySchema>

// ─────────────────────────────────────────────────────────────────────────────
// GRAVITY CLAW — MEMORY TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const SoulMemorySchema = z.object({
  exploredNiches: z.array(z.string()),
  ceoPreferences: z.array(z.string()),
  systemVersion: z.string(),
  lastUpdatedAt: z.string(),
  nichosParaProximaSessao: z.array(z.string()).optional(),
})
export type SoulMemory = z.infer<typeof SoulMemorySchema>

export const PipelineSessionSchema = z.object({
  sessionId: z.string(),
  query: z.string(),
  ranAt: z.string(),
  videosProcessed: z.number(),
  painPointsFound: z.number(),
  ideasGenerated: z.number(),
  ideasApproved: z.number(),
  processedVideoIds: z.array(z.string()).optional(),
})
export type PipelineSession = z.infer<typeof PipelineSessionSchema>

export const SessionBufferSchema = z.object({
  sessions: z.array(PipelineSessionSchema),
})
export type SessionBuffer = z.infer<typeof SessionBufferSchema>

export const KnowledgeRecordSchema = z.object({
  id: z.string(),
  description: z.string(),
  descriptionHash: z.string(),
  category: PainCategorySchema,
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  frequency: z.number().int().positive(),
  status: KnowledgeStatusSchema,
})
export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>

// ─────────────────────────────────────────────────────────────────────────────
// GRAVITY CLAW — SKILL TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  filePath: z.string(),
  createdAt: z.string(),
  usageCount: z.number().int().nonnegative(),
  createdByAgent: z.enum([
    'pain-extractor',
    'volume-filter',
    'offer-architect',
    'funnel-director',
    'sales-page-copywriter',
    'ad-copywriter',
    'video-scriptwriter',
    'design-brief-agent',
    'tracking-agent',
    'media-buyer',
    'organic-content-planner',
    'metrics-analyst',
    'finance-agent',
    'cro-agent',
    'checkout-ops',
    'funnel-builder',
    'reference-miner',
    'visual-funnel-architect',
    'infra-manager',
    'product-quality-reviewer',
    'creative-analyst',
  ]),
})
export type Skill = z.infer<typeof SkillSchema>

export const SkillReflectionSchema = z.object({
  shouldSave: z.boolean(),
  reasoning: z.string(),
  suggestedName: z.string(),
  suggestedDescription: z.string(),
  extractedLogic: z.string(),
})
export type SkillReflection = z.infer<typeof SkillReflectionSchema>

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const OrchestratorOptionsSchema = z.object({
  query: z.string().optional(),
  videoIds: z.array(z.string()).optional(),
  channelId: z.string().optional(),
  maxVideos: z.number().int().positive().default(5),
  agents: z.array(z.enum(['scraper', 'extractor', 'volume', 'validator', 'offer', 'funnel', 'copy', 'ads', 'videos', 'design', 'reference', 'visual', 'tracking', 'media', 'meta-sync', 'metrics', 'finance', 'cro', 'checkout', 'builder', 'quality', 'organic', 'creative-analysis', 'infra', 'mistica', 'all'])).default(['all']),
  debug: z.boolean().default(false),
  selectIdea: z.string().optional(),
})
export type OrchestratorOptions = z.infer<typeof OrchestratorOptionsSchema>

export const OfferArchitectInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type OfferArchitectInput = z.infer<typeof OfferArchitectInputSchema>

export const OfferArchitectOutputSchema = z.object({
  ideaId: z.string(),
  offerPath: z.string(),
  durationMs: z.number(),
})
export type OfferArchitectOutput = z.infer<typeof OfferArchitectOutputSchema>

export const FunnelDirectorInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type FunnelDirectorInput = z.infer<typeof FunnelDirectorInputSchema>

export const FunnelDirectorOutputSchema = z.object({
  ideaId: z.string(),
  funnelPath: z.string(),
  durationMs: z.number(),
})
export type FunnelDirectorOutput = z.infer<typeof FunnelDirectorOutputSchema>

export const SalesPageCopywriterInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type SalesPageCopywriterInput = z.infer<typeof SalesPageCopywriterInputSchema>

export const SalesPageCopywriterOutputSchema = z.object({
  ideaId: z.string(),
  copyPath: z.string(),
  durationMs: z.number(),
})
export type SalesPageCopywriterOutput = z.infer<typeof SalesPageCopywriterOutputSchema>

export const CreativeStateSchema = z.enum([
  'reconhecimento',
  'erro-invisivel',
  'alivio-imediato',
  'perda-evitavel',
  'prova-visual',
])
export type CreativeState = z.infer<typeof CreativeStateSchema>

export const CreativeAngleSchema = z.object({
  angle: z.string(),
  state: CreativeStateSchema,
  hook: z.string(),
  imageText: z.string(),
  primaryText: z.string(),
  headline: z.string(),
  visualBrief: z.string(),
  cta: z.string(),
  objectionHandled: z.string(),
  landingPageMatch: z.string(),
})
export type CreativeAngle = z.infer<typeof CreativeAngleSchema>

export const CreativePackSchema = z.object({
  ideaId: z.string().uuid(),
  creativeAngles: z.array(CreativeAngleSchema).min(8),
})
export type CreativePack = z.infer<typeof CreativePackSchema>

export const AdCopywriterInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type AdCopywriterInput = z.infer<typeof AdCopywriterInputSchema>

export const AdCopywriterOutputSchema = z.object({
  ideaId: z.string(),
  creativePath: z.string(),
  durationMs: z.number(),
})
export type AdCopywriterOutput = z.infer<typeof AdCopywriterOutputSchema>

export const VideoScriptFormatSchema = z.enum(['ugc', 'demonstracao', 'vsl-curta', 'organico'])
export type VideoScriptFormat = z.infer<typeof VideoScriptFormatSchema>

export const VideoScriptSchema = z.object({
  name: z.string(),
  sourceAngle: z.string(),
  format: VideoScriptFormatSchema,
  hook: z.string(),
  sceneByScene: z.array(z.string()).min(1),
  voiceover: z.string(),
  onScreenText: z.array(z.string()).min(1),
  cta: z.string(),
})
export type VideoScript = z.infer<typeof VideoScriptSchema>

export const VideoScriptPackSchema = z.object({
  ideaId: z.string().uuid(),
  scripts: z.array(VideoScriptSchema).min(4),
})
export type VideoScriptPack = z.infer<typeof VideoScriptPackSchema>

export const VideoScriptwriterInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type VideoScriptwriterInput = z.infer<typeof VideoScriptwriterInputSchema>

export const VideoScriptwriterOutputSchema = z.object({
  ideaId: z.string(),
  scriptsPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type VideoScriptwriterOutput = z.infer<typeof VideoScriptwriterOutputSchema>

export const BrandDirectionSchema = z.object({
  positioning: z.string(),
  visualMood: z.string(),
  colorPalette: z.array(z.string()).min(1),
  typography: z.string(),
  imageryStyle: z.string(),
  avoid: z.array(z.string()),
})
export type BrandDirection = z.infer<typeof BrandDirectionSchema>

export const LandingPageDesignBriefSchema = z.object({
  hero: z.string(),
  sections: z.array(z.string()).min(1),
  trustElements: z.array(z.string()),
  ctaStyle: z.string(),
  mobileNotes: z.array(z.string()),
})
export type LandingPageDesignBrief = z.infer<typeof LandingPageDesignBriefSchema>

export const DesignBriefSchema = z.object({
  ideaId: z.string().uuid(),
  brandDirection: BrandDirectionSchema,
  landingPageBrief: LandingPageDesignBriefSchema,
  productMockups: z.array(z.string()),
  staticCreativeBriefs: z.array(z.string()),
  videoAssetBriefs: z.array(z.string()),
  assetChecklist: z.array(z.string()),
  implementationNotes: z.array(z.string()),
  complianceNotes: z.array(z.string()),
})
export type DesignBrief = z.infer<typeof DesignBriefSchema>

export const DesignBriefAgentInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type DesignBriefAgentInput = z.infer<typeof DesignBriefAgentInputSchema>

export const DesignBriefAgentOutputSchema = z.object({
  ideaId: z.string(),
  designPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type DesignBriefAgentOutput = z.infer<typeof DesignBriefAgentOutputSchema>

// ─────────────────────────────────────────────────────────────────────────────
// CRIADOR MÍSTICA TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const TrackingChannelSchema = z.enum(['browser-pixel', 'server-capi', 'both'])
export type TrackingChannel = z.infer<typeof TrackingChannelSchema>

export const TrackingEventSchema = z.object({
  eventName: z.string(),
  trigger: z.string(),
  channel: TrackingChannelSchema,
  eventIdStrategy: z.string(),
  parameters: z.array(z.string()),
  validation: z.string(),
})
export type TrackingEvent = z.infer<typeof TrackingEventSchema>

export const MatchingFieldSchema = z.object({
  field: z.string(),
  source: z.string(),
  normalization: z.string(),
  hashing: z.string(),
  required: z.boolean(),
})
export type MatchingField = z.infer<typeof MatchingFieldSchema>

export const TrackingPlanSchema = z.object({
  ideaId: z.string().uuid(),
  architecture: z.string(),
  pixelSetup: z.array(z.string()).min(1),
  capiSetup: z.array(z.string()).min(1),
  n8nWorkflow: z.array(z.string()).min(1),
  eventMap: z.array(TrackingEventSchema).min(1),
  matchingFields: z.array(MatchingFieldSchema).min(1),
  utmPattern: z.array(z.string()).min(1),
  checkoutRequirements: z.array(z.string()).min(1),
  validationChecklist: z.array(z.string()).min(1),
  riskNotes: z.array(z.string()),
  readyForTraffic: z.boolean(),
})
export type TrackingPlan = z.infer<typeof TrackingPlanSchema>

export const TrackingAgentInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type TrackingAgentInput = z.infer<typeof TrackingAgentInputSchema>

export const TrackingAgentOutputSchema = z.object({
  ideaId: z.string(),
  trackingPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type TrackingAgentOutput = z.infer<typeof TrackingAgentOutputSchema>

export const LaunchStatusSchema = z.enum(['bloqueado', 'pre-lancamento', 'liberado'])
export type LaunchStatus = z.infer<typeof LaunchStatusSchema>

export const CampaignStructureSchema = z.object({
  campaignName: z.string(),
  objective: z.string(),
  optimizationEvent: z.string(),
  budgetType: z.string(),
  dailyBudget: z.string(),
  duration: z.string(),
})
export type CampaignStructure = z.infer<typeof CampaignStructureSchema>

export const AdSetPlanSchema = z.object({
  name: z.string(),
  audience: z.string(),
  budget: z.string(),
  placements: z.string(),
  creativesToUse: z.array(z.string()),
  hypothesis: z.string(),
})
export type AdSetPlan = z.infer<typeof AdSetPlanSchema>

export const CreativeTestPlanSchema = z.object({
  creativeName: z.string(),
  angle: z.string(),
  format: z.string(),
  successSignal: z.string(),
  failureSignal: z.string(),
})
export type CreativeTestPlan = z.infer<typeof CreativeTestPlanSchema>

export const MediaPlanSchema = z.object({
  ideaId: z.string().uuid(),
  launchStatus: LaunchStatusSchema,
  readinessNotes: z.array(z.string()),
  campaign: CampaignStructureSchema,
  adSets: z.array(AdSetPlanSchema).min(1),
  creativeTests: z.array(CreativeTestPlanSchema).min(1),
  utmPlan: z.array(z.string()).min(1),
  pauseRules: z.array(z.string()).min(1),
  scaleRules: z.array(z.string()).min(1),
  reportingCadence: z.array(z.string()).min(1),
  preLaunchChecklist: z.array(z.string()).min(1),
  creativeRequests: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type MediaPlan = z.infer<typeof MediaPlanSchema>

export const MediaBuyerInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type MediaBuyerInput = z.infer<typeof MediaBuyerInputSchema>

export const MediaBuyerOutputSchema = z.object({
  ideaId: z.string(),
  mediaPlanPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type MediaBuyerOutput = z.infer<typeof MediaBuyerOutputSchema>

export const MetricsDecisionSchema = z.enum([
  'aguardando-dados',
  'pausar',
  'ajustar',
  'escalar',
  'manter',
  'criar-novo-teste',
])
export type MetricsDecision = z.infer<typeof MetricsDecisionSchema>

export const DailyMetricsSchema = z.object({
  ideaId: z.string().uuid(),
  date: z.string(),
  spend: z.number().nonnegative(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  pageViews: z.number().int().nonnegative(),
  viewContent: z.number().int().nonnegative(),
  initiateCheckout: z.number().int().nonnegative(),
  purchases: z.number().int().nonnegative(),
  revenue: z.number().nonnegative(),
  refunds: z.number().int().nonnegative(),
  ctr: z.number().nonnegative().optional(),
  cpc: z.number().nonnegative().optional(),
  cpa: z.number().nonnegative().optional(),
  roas: z.number().nonnegative().optional(),
  notes: z.array(z.string()).optional(),
})
export type DailyMetrics = z.infer<typeof DailyMetricsSchema>

export const OptimizationDecisionSchema = z.object({
  ideaId: z.string().uuid(),
  metricsAvailable: z.boolean(),
  summary: z.string(),
  decision: MetricsDecisionSchema,
  reason: z.string(),
  actions: z.array(z.string()).min(1),
  budgetChange: z.string(),
  creativeRequests: z.array(z.string()),
  funnelRequests: z.array(z.string()),
  trackingRequests: z.array(z.string()),
  financeNotes: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type OptimizationDecision = z.infer<typeof OptimizationDecisionSchema>

export const MetricsAnalystInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type MetricsAnalystInput = z.infer<typeof MetricsAnalystInputSchema>

export const MetricsAnalystOutputSchema = z.object({
  ideaId: z.string(),
  decisionPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type MetricsAnalystOutput = z.infer<typeof MetricsAnalystOutputSchema>

export const MetaMetricsSyncInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
  datePreset: z.string().optional(),
})
export type MetaMetricsSyncInput = z.infer<typeof MetaMetricsSyncInputSchema>

export const MetaMetricsSyncOutputSchema = z.object({
  ideaId: z.string(),
  dailyMetricsPath: z.string(),
  creativeMetricsPath: z.string(),
  campaignsPath: z.string(),
  durationMs: z.number(),
})
export type MetaMetricsSyncOutput = z.infer<typeof MetaMetricsSyncOutputSchema>

export const CashStatusSchema = z.enum(['bloqueado', 'teste-controlado', 'escala-permitida'])
export type CashStatus = z.infer<typeof CashStatusSchema>

export const BudgetRulesSchema = z.object({
  ideaId: z.string().uuid(),
  cashStatus: CashStatusSchema,
  summary: z.string(),
  testBudgetLimit: z.string(),
  dailyBudgetCap: z.string(),
  maxLossAllowed: z.string(),
  breakEvenCpa: z.string(),
  targetCpa: z.string(),
  marginAssumptions: z.array(z.string()).min(1),
  releaseConditions: z.array(z.string()).min(1),
  stopLossRules: z.array(z.string()).min(1),
  scaleRules: z.array(z.string()).min(1),
  cashProtectionActions: z.array(z.string()).min(1),
  ceoApprovalRequired: z.boolean(),
  riskNotes: z.array(z.string()),
})
export type BudgetRules = z.infer<typeof BudgetRulesSchema>

export const FinanceAgentInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type FinanceAgentInput = z.infer<typeof FinanceAgentInputSchema>

export const FinanceAgentOutputSchema = z.object({
  ideaId: z.string(),
  budgetRulesPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type FinanceAgentOutput = z.infer<typeof FinanceAgentOutputSchema>

export const CroModeSchema = z.enum(['pre-lancamento', 'com-dados'])
export type CroMode = z.infer<typeof CroModeSchema>

export const CroPrioritySchema = z.enum(['alta', 'media', 'baixa'])
export type CroPriority = z.infer<typeof CroPrioritySchema>

export const CroAreaSchema = z.enum([
  'primeira-dobra',
  'oferta',
  'prova',
  'checkout',
  'preco',
  'order-bump',
  'upsell',
  'mobile',
  'tracking',
  'copy',
])
export type CroArea = z.infer<typeof CroAreaSchema>

export const CroTestSchema = z.object({
  name: z.string(),
  area: CroAreaSchema,
  priority: CroPrioritySchema,
  hypothesis: z.string(),
  change: z.string(),
  successMetric: z.string(),
  guardrailMetric: z.string(),
})
export type CroTest = z.infer<typeof CroTestSchema>

export const CroPlanSchema = z.object({
  ideaId: z.string().uuid(),
  mode: CroModeSchema,
  summary: z.string(),
  mainBottleneck: z.string(),
  tests: z.array(CroTestSchema).min(1),
  pageRequests: z.array(z.string()),
  checkoutRequests: z.array(z.string()),
  offerRequests: z.array(z.string()),
  trackingRequests: z.array(z.string()),
  creativeRequests: z.array(z.string()),
  doNotChangeYet: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type CroPlan = z.infer<typeof CroPlanSchema>

export const CroAgentInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type CroAgentInput = z.infer<typeof CroAgentInputSchema>

export const CroAgentOutputSchema = z.object({
  ideaId: z.string(),
  croPlanPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type CroAgentOutput = z.infer<typeof CroAgentOutputSchema>

export const CheckoutReadinessSchema = z.enum(['bloqueado', 'pronto-com-pendencias', 'pronto'])
export type CheckoutReadiness = z.infer<typeof CheckoutReadinessSchema>

export const CheckoutItemStatusSchema = z.enum(['pendente', 'validar', 'pronto', 'bloqueado'])
export type CheckoutItemStatus = z.infer<typeof CheckoutItemStatusSchema>

export const CheckoutChecklistItemSchema = z.object({
  area: z.enum([
    'checkout',
    'pagamento',
    'order-bump',
    'upsell',
    'entrega',
    'acesso',
    'suporte',
    'tracking',
    'legal',
    'qa',
  ]),
  item: z.string(),
  status: CheckoutItemStatusSchema,
  owner: z.string(),
  validation: z.string(),
})
export type CheckoutChecklistItem = z.infer<typeof CheckoutChecklistItemSchema>

export const CheckoutOpsPlanSchema = z.object({
  ideaId: z.string().uuid(),
  readiness: CheckoutReadinessSchema,
  summary: z.string(),
  checkoutPlatformAssumption: z.string(),
  productDeliveryFlow: z.array(z.string()).min(1),
  buyerAccessFlow: z.array(z.string()).min(1),
  orderBumpSetup: z.array(z.string()).min(1),
  upsellSetup: z.array(z.string()).min(1),
  paymentSetup: z.array(z.string()).min(1),
  supportSetup: z.array(z.string()).min(1),
  legalAndPolicySetup: z.array(z.string()).min(1),
  trackingHandoff: z.array(z.string()).min(1),
  testPurchaseScript: z.array(z.string()).min(1),
  goLiveBlockers: z.array(z.string()),
  checklist: z.array(CheckoutChecklistItemSchema).min(1),
  ceoApprovalRequired: z.boolean(),
  riskNotes: z.array(z.string()),
})
export type CheckoutOpsPlan = z.infer<typeof CheckoutOpsPlanSchema>

export const CheckoutOpsInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type CheckoutOpsInput = z.infer<typeof CheckoutOpsInputSchema>

export const CheckoutOpsOutputSchema = z.object({
  ideaId: z.string(),
  checkoutOpsPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type CheckoutOpsOutput = z.infer<typeof CheckoutOpsOutputSchema>

export const FunnelBuildStatusSchema = z.enum(['bloqueado', 'pronto-com-pendencias', 'pronto'])
export type FunnelBuildStatus = z.infer<typeof FunnelBuildStatusSchema>

export const FunnelPageSectionSchema = z.object({
  order: z.number().int().positive(),
  sectionId: z.string(),
  purpose: z.string(),
  sourceCopy: z.string(),
  designDirection: z.string(),
  requiredAssets: z.array(z.string()),
  cta: z.string(),
})
export type FunnelPageSection = z.infer<typeof FunnelPageSectionSchema>

export const FunnelLinkSchema = z.object({
  label: z.string(),
  source: z.string(),
  destination: z.string(),
  status: z.enum(['pendente', 'validar', 'pronto', 'bloqueado']),
  validation: z.string(),
})
export type FunnelLink = z.infer<typeof FunnelLinkSchema>

export const FunnelBuilderPlanSchema = z.object({
  ideaId: z.string().uuid(),
  buildStatus: FunnelBuildStatusSchema,
  summary: z.string(),
  recommendedImplementation: z.string(),
  pageStructure: z.array(FunnelPageSectionSchema).min(1),
  responsiveRules: z.array(z.string()).min(1),
  assetRequirements: z.array(z.string()).min(1),
  linkMap: z.array(FunnelLinkSchema).min(1),
  trackingEmbedRequirements: z.array(z.string()).min(1),
  seoAndPerformanceChecklist: z.array(z.string()).min(1),
  complianceChecklist: z.array(z.string()).min(1),
  publishChecklist: z.array(z.string()).min(1),
  goLiveBlockers: z.array(z.string()),
  handoffNotes: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type FunnelBuilderPlan = z.infer<typeof FunnelBuilderPlanSchema>

export const FunnelBuilderInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type FunnelBuilderInput = z.infer<typeof FunnelBuilderInputSchema>

export const FunnelBuilderOutputSchema = z.object({
  ideaId: z.string(),
  pageChecklistPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type FunnelBuilderOutput = z.infer<typeof FunnelBuilderOutputSchema>

export const FunnelReferenceSchema = z.object({
  url: z.string(),
  title: z.string(),
  source: z.string(),
  funnelType: z.string(),
  pageSections: z.array(z.string()),
  visualPatterns: z.array(z.string()),
  conversionElements: z.array(z.string()),
  copyPatterns: z.array(z.string()),
  interactionPatterns: z.array(z.string()),
  differentiationOpportunities: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type FunnelReference = z.infer<typeof FunnelReferenceSchema>

export const FunnelReferenceReportSchema = z.object({
  ideaId: z.string().uuid(),
  researchStatus: z.enum(['sem-firecrawl', 'referencias-coletadas', 'referencias-simuladas']),
  queryStrategy: z.array(z.string()).min(1),
  references: z.array(FunnelReferenceSchema),
  marketPatterns: z.array(z.string()).min(1),
  uiOpportunities: z.array(z.string()).min(1),
  doNotCopy: z.array(z.string()).min(1),
  recommendationsForDesign: z.array(z.string()).min(1),
  recommendationsForBuilder: z.array(z.string()).min(1),
  riskNotes: z.array(z.string()),
})
export type FunnelReferenceReport = z.infer<typeof FunnelReferenceReportSchema>

export const ReferenceMinerInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  urls: z.array(z.string()).optional(),
  outputDir: z.string().optional(),
})
export type ReferenceMinerInput = z.infer<typeof ReferenceMinerInputSchema>

export const ReferenceMinerOutputSchema = z.object({
  ideaId: z.string(),
  reportPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type ReferenceMinerOutput = z.infer<typeof ReferenceMinerOutputSchema>

export const VisualFunnelArchitectureSchema = z.object({
  ideaId: z.string().uuid(),
  recommendedExperience: z.enum([
    'pagina-direta',
    'vsl-dinamica',
    'quiz-gamificado',
    'advertorial',
    'diagnostico-interativo',
    'calculadora',
  ]),
  strategicRationale: z.string(),
  visualConcept: z.string(),
  screenFlow: z.array(z.object({
    order: z.number().int().positive(),
    screenId: z.string(),
    purpose: z.string(),
    layout: z.string(),
    interaction: z.string(),
    conversionTrigger: z.string(),
    requiredAssets: z.array(z.string()),
  })).min(1),
  componentSystem: z.array(z.string()).min(1),
  gamificationRules: z.array(z.string()),
  vslDynamicRules: z.array(z.string()),
  quizLogic: z.array(z.string()),
  mobileFirstRules: z.array(z.string()).min(1),
  accessibilityRules: z.array(z.string()).min(1),
  implementationNotes: z.array(z.string()).min(1),
  qaChecklist: z.array(z.string()).min(1),
  riskNotes: z.array(z.string()),
})
export type VisualFunnelArchitecture = z.infer<typeof VisualFunnelArchitectureSchema>

export const VisualFunnelArchitectInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type VisualFunnelArchitectInput = z.infer<typeof VisualFunnelArchitectInputSchema>

export const VisualFunnelArchitectOutputSchema = z.object({
  ideaId: z.string(),
  architecturePath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type VisualFunnelArchitectOutput = z.infer<typeof VisualFunnelArchitectOutputSchema>

export const ProductQualityStatusSchema = z.enum(['bloqueado', 'revisar', 'aprovado'])
export type ProductQualityStatus = z.infer<typeof ProductQualityStatusSchema>

export const ProductQualityGapSchema = z.object({
  area: z.enum(['promessa', 'conteudo', 'clareza', 'entrega', 'risco', 'suporte', 'compliance']),
  severity: z.enum(['alta', 'media', 'baixa']),
  finding: z.string(),
  recommendation: z.string(),
})
export type ProductQualityGap = z.infer<typeof ProductQualityGapSchema>

export const ProductQualityReviewSchema = z.object({
  ideaId: z.string().uuid(),
  qualityStatus: ProductQualityStatusSchema,
  summary: z.string(),
  promiseAlignmentScore: z.number().int().min(0).max(100),
  refundRisk: z.enum(['alto', 'medio', 'baixo']),
  deliveryClarity: z.enum(['alta', 'media', 'baixa']),
  strengths: z.array(z.string()),
  gaps: z.array(ProductQualityGapSchema),
  requiredFixesBeforeTraffic: z.array(z.string()),
  productBuilderRequests: z.array(z.string()),
  copyAlignmentRequests: z.array(z.string()),
  supportAndOnboardingRequests: z.array(z.string()),
  approvalConditions: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type ProductQualityReview = z.infer<typeof ProductQualityReviewSchema>

export const ProductQualityReviewerInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type ProductQualityReviewerInput = z.infer<typeof ProductQualityReviewerInputSchema>

export const ProductQualityReviewerOutputSchema = z.object({
  ideaId: z.string(),
  qualityReviewPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type ProductQualityReviewerOutput = z.infer<typeof ProductQualityReviewerOutputSchema>

export const OrganicContentFormatSchema = z.enum(['reels', 'carrossel', 'story', 'post', 'shorts'])
export type OrganicContentFormat = z.infer<typeof OrganicContentFormatSchema>

export const OrganicContentStageSchema = z.enum(['dor', 'erro', 'diagnostico', 'metodo', 'prova', 'oferta'])
export type OrganicContentStage = z.infer<typeof OrganicContentStageSchema>

export const OrganicContentPostSchema = z.object({
  day: z.string(),
  stage: OrganicContentStageSchema,
  theme: z.string(),
  format: OrganicContentFormatSchema,
  hook: z.string(),
  summary: z.string(),
  cta: z.string(),
  creativeBrief: z.string(),
  landingPageBridge: z.string(),
})
export type OrganicContentPost = z.infer<typeof OrganicContentPostSchema>

export const OrganicContentPlanSchema = z.object({
  ideaId: z.string().uuid(),
  contentPath: z.string(),
  strategySummary: z.string(),
  primaryAudience: z.string(),
  contentPillars: z.array(z.string()).min(1),
  weeklyCalendar: z.array(OrganicContentPostSchema).min(7),
  repurposeRules: z.array(z.string()).min(1),
  creativeRequests: z.array(z.string()),
  pageFeedbackSignals: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type OrganicContentPlan = z.infer<typeof OrganicContentPlanSchema>

export const OrganicContentPlannerInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type OrganicContentPlannerInput = z.infer<typeof OrganicContentPlannerInputSchema>

export const OrganicContentPlannerOutputSchema = z.object({
  ideaId: z.string(),
  calendarPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type OrganicContentPlannerOutput = z.infer<typeof OrganicContentPlannerOutputSchema>

export const CreativePerformanceSchema = z.object({
  creativeName: z.string(),
  spend: z.number().nonnegative(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  viewContent: z.number().int().nonnegative(),
  initiateCheckout: z.number().int().nonnegative(),
  purchases: z.number().int().nonnegative(),
  revenue: z.number().nonnegative(),
  ctr: z.number().nonnegative().optional(),
  cpc: z.number().nonnegative().optional(),
  cpa: z.number().nonnegative().optional(),
  roas: z.number().nonnegative().optional(),
  notes: z.array(z.string()).optional(),
})
export type CreativePerformance = z.infer<typeof CreativePerformanceSchema>

export const CreativeAnalysisDecisionSchema = z.enum([
  'aguardando-dados',
  'criar-variacoes',
  'pausar-criativos',
  'manter-teste',
  'escalar-vencedores',
])
export type CreativeAnalysisDecision = z.infer<typeof CreativeAnalysisDecisionSchema>

export const CreativeIterationRequestSchema = z.object({
  source: z.string(),
  angle: z.string(),
  format: z.enum(['estatico', 'video', 'organico', 'ugc', 'carrossel']),
  reason: z.string(),
  brief: z.string(),
})
export type CreativeIterationRequest = z.infer<typeof CreativeIterationRequestSchema>

export const CreativeAnalysisSchema = z.object({
  ideaId: z.string().uuid(),
  metricsAvailable: z.boolean(),
  decision: CreativeAnalysisDecisionSchema,
  summary: z.string(),
  winners: z.array(z.string()),
  losers: z.array(z.string()),
  inconclusive: z.array(z.string()),
  insights: z.array(z.string()).min(1),
  iterationRequests: z.array(CreativeIterationRequestSchema).min(1),
  trackingRequests: z.array(z.string()),
  pageRequests: z.array(z.string()),
  mediaBuyerNotes: z.array(z.string()),
  doNotScaleYet: z.array(z.string()),
  riskNotes: z.array(z.string()),
})
export type CreativeAnalysis = z.infer<typeof CreativeAnalysisSchema>

export const CreativeAnalystInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string().optional(),
  outputDir: z.string().optional(),
})
export type CreativeAnalystInput = z.infer<typeof CreativeAnalystInputSchema>

export const CreativeAnalystOutputSchema = z.object({
  ideaId: z.string(),
  analysisPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type CreativeAnalystOutput = z.infer<typeof CreativeAnalystOutputSchema>

export const MisticaCreatorInputSchema = z.object({
  sessionId: z.string(),
  ideaId: z.string(),
  outputDir: z.string().optional(),
})
export type MisticaCreatorInput = z.infer<typeof MisticaCreatorInputSchema>

export const MisticaCreatorOutputSchema = z.object({
  ideaId: z.string(),
  specialistRole: z.string(),
  contentPath: z.string(),
  durationMs: z.number(),
})
export type MisticaCreatorOutput = z.infer<typeof MisticaCreatorOutputSchema>

export const InfraCheckStatusSchema = z.enum(['ok', 'warn', 'fail'])
export type InfraCheckStatus = z.infer<typeof InfraCheckStatusSchema>

export const InfraCheckSchema = z.object({
  area: z.enum(['environment', 'connectors', 'storage', 'scheduler', 'dashboard', 'deploy', 'security']),
  status: InfraCheckStatusSchema,
  title: z.string(),
  detail: z.string(),
  recommendation: z.string(),
})
export type InfraCheck = z.infer<typeof InfraCheckSchema>

export const InfraAuditSchema = z.object({
  auditId: z.string(),
  auditedAt: z.string(),
  overallStatus: z.enum(['operacional', 'atencao', 'bloqueado']),
  connectorSummary: z.array(ConnectorHealthSchema),
  checks: z.array(InfraCheckSchema),
  goLiveBlockers: z.array(z.string()),
  nextActions: z.array(z.string()),
})
export type InfraAudit = z.infer<typeof InfraAuditSchema>

export const InfraManagerInputSchema = z.object({
  sessionId: z.string(),
  outputDir: z.string().optional(),
})
export type InfraManagerInput = z.infer<typeof InfraManagerInputSchema>

export const InfraManagerOutputSchema = z.object({
  auditPath: z.string(),
  markdownPath: z.string(),
  durationMs: z.number(),
})
export type InfraManagerOutput = z.infer<typeof InfraManagerOutputSchema>

// ─────────────────────────────────────────────────────────────────────────────
// OPENAI API RESPONSE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const LLMExtractedPainSchema = z.object({
  description: z.string(),
  category: PainCategorySchema,
  examples: z.array(z.string()),
})
export type LLMExtractedPain = z.infer<typeof LLMExtractedPainSchema>

export const LLMExtractedPainsResponseSchema = z.object({
  pains: z.array(LLMExtractedPainSchema),
})
export type LLMExtractedPainsResponse = z.infer<typeof LLMExtractedPainsResponseSchema>

export const LLMValidatedIdeaResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  targetAudience: z.string(),
  coreFeatures: z.array(z.string()).max(5),
  pricingModel: z.string(),
  estimatedMRR: z.string(),
  technicalComplexity: TechnicalComplexitySchema,
  timeToMVP: z.string(),
})
export type LLMValidatedIdeaResponse = z.infer<typeof LLMValidatedIdeaResponseSchema>

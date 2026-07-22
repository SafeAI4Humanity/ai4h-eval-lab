import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Cloud,
  Download,
  ExternalLink,
  FileJson,
  Filter,
  Github,
  HardDrive,
  KeyRound,
  Library,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  TestTube2,
  Trash2,
  UserCheck,
  Wifi,
  WifiOff,
  X,
  XCircle
} from "lucide-react";
import { bundledSuites, refreshCatalogs } from "./services/catalog";
import { defaultBaseUrl, kieModelIds, normalizeProviderBaseUrl, providerLabel, testConnection } from "./services/providers";
import { bulkReviewCandidates, connectedReviewTargets, isSameReviewerModel, latestReview, runModelReview, type BulkReviewScope } from "./services/reviews";
import { executeRun, runSummary, type RunProgress } from "./services/runner";
import { buildEvaluationSubmission, publicationIssues, submissionFileName } from "./services/submissions";
import { deleteSecret, setSecret, storage, type InterfaceScale } from "./services/storage";
import { checkForAppUpdate, currentAppVersion, openReleasePage, type AppUpdateState } from "./services/updates";
import {
  clearDiagnosticEntries,
  getDiagnosticConfig,
  getDiagnosticEntries,
  setDiagnosticConfig,
  subscribeToDiagnostics,
  type DiagnosticConfig
} from "./services/diagnostics";
import type {
  CatalogSource,
  CaseResult,
  Connection,
  Evaluator,
  EvaluationRun,
  ProviderKind,
  ResultReview,
  ReviewVerdict,
  RunTarget,
  TestSuite
} from "./types";

type Page = "dashboard" | "library" | "new-run" | "live-run" | "results" | "connections" | "settings";

const navItems: Array<{ page: Page; label: string; icon: typeof Activity }> = [
  { page: "dashboard", label: "Overview", icon: Activity },
  { page: "library", label: "Test library", icon: Library },
  { page: "new-run", label: "New evaluation", icon: Play },
  { page: "results", label: "Results", icon: BarChart3 },
  { page: "connections", label: "Connections", icon: Server }
];

const interfaceScaleOptions: Array<{ value: InterfaceScale; label: string; description: string }> = [
  { value: "default", label: "Default (100%)", description: "The original compact interface" },
  { value: "comfortable", label: "Comfortable (115%)", description: "A little larger for easier reading" },
  { value: "large", label: "Large (130%)", description: "Larger text throughout the app" },
  { value: "extra-large", label: "Extra large (145%)", description: "Maximum in-app text enlargement" }
];

const providerOptions: Array<{ value: ProviderKind; label: string; hint: string }> = [
  { value: "ollama", label: "Ollama", hint: "Local models" },
  { value: "openrouter", label: "OpenRouter", hint: "Multi-provider model catalog" },
  { value: "kie", label: "Kie.ai", hint: "Documented text model APIs" },
  { value: "openai", label: "OpenAI", hint: "OpenAI API" },
  { value: "anthropic", label: "Anthropic", hint: "Claude models" },
  { value: "gemini", label: "Google Gemini", hint: "Gemini API" },
  { value: "openai-compatible", label: "OpenAI-compatible", hint: "Hosted or self-managed" }
];

const emptyConnection: Omit<Connection, "id"> & { apiKey: string } = {
  name: "",
  provider: "openai-compatible",
  baseUrl: defaultBaseUrl("openai-compatible"),
  enabled: true,
  status: "untested",
  apiKey: ""
};

function discoveryDetails(provider: ProviderKind): { title: string; description: string; action: string; empty: string } | null {
  if (provider === "ollama") return {
    title: "Available Ollama models",
    description: "Use the server root, such as http://host:11434. A trailing /v1 or /api is removed automatically.",
    action: "Scan server",
    empty: "No models scanned yet. Make sure Ollama is running, then scan the server."
  };
  if (provider === "openrouter") return {
    title: "OpenRouter model catalog",
    description: "Load the current model IDs available to this API key.",
    action: "Load models",
    empty: "No models loaded yet. Enter an API key, then load the OpenRouter catalog."
  };
  if (provider === "kie") return {
    title: "Supported Kie.ai text models",
    description: "Validate the API key and load models with documented chat endpoints.",
    action: "Validate key",
    empty: "Choose from the Kie.ai text models supported by this app."
  };
  return null;
}

function connectionTestLabel(provider: ProviderKind): string {
  if (provider === "ollama") return "Scan models";
  if (provider === "openrouter") return "Load models";
  if (provider === "kie") return "Validate & load";
  return "Test";
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [connections, setConnections] = useState<Connection[]>(storage.getConnections);
  const [sources, setSources] = useState<CatalogSource[]>(storage.getSources);
  const [suites, setSuites] = useState<TestSuite[]>(bundledSuites);
  const [runs, setRuns] = useState<EvaluationRun[]>(storage.getRuns);
  const [catalogChecking, setCatalogChecking] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("Bundled catalog ready");
  const [activeRun, setActiveRun] = useState<EvaluationRun | null>(null);
  const [progress, setProgress] = useState<RunProgress>({ completed: 0, total: 0 });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(storage.getInterfaceScale);
  const [appUpdate, setAppUpdate] = useState<AppUpdateState>({ status: "idle", currentVersion: currentAppVersion });
  const [updateNoticeDismissed, setUpdateNoticeDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.dataset.interfaceScale = interfaceScale;
  }, [interfaceScale]);

  const persistConnections = (next: Connection[]) => {
    setConnections(next);
    storage.setConnections(next);
  };

  const persistSources = (next: CatalogSource[]) => {
    setSources(next);
    storage.setSources(next);
  };

  const persistRuns = (next: EvaluationRun[]) => {
    setRuns(next);
    storage.setRuns(next);
  };

  const persistInterfaceScale = (next: InterfaceScale) => {
    setInterfaceScale(next);
    storage.setInterfaceScale(next);
  };

  const saveResultReview = (runId: string, resultId: string, review: ResultReview) => {
    setRuns((currentRuns) => {
      const nextRuns = currentRuns.map((run) => run.id === runId ? {
        ...run,
        results: run.results.map((result) => result.id === resultId
          ? { ...result, reviews: [...(result.reviews ?? []), review] }
          : result)
      } : run);
      storage.setRuns(nextRuns);
      return nextRuns;
    });
  };

  const checkCatalogs = async (quiet = false) => {
    setCatalogChecking(true);
    if (!quiet) setCatalogMessage("Checking catalogs…");
    try {
      const result = await refreshCatalogs(sources);
      setSuites(result.suites);
      persistSources(result.sources);
      const readySources = result.sources.filter((source) => source.status === "ready").length;
      setCatalogMessage(
        readySources
          ? `${result.suites.length} test suites available from ${readySources + 1} catalogs`
          : `${result.suites.length} bundled suites ready · Remote check unavailable`
      );
    } finally {
      setCatalogChecking(false);
    }
  };

  const checkAppUpdates = async () => {
    setAppUpdate({ status: "checking", currentVersion: currentAppVersion });
    try {
      const result = await checkForAppUpdate();
      setAppUpdate({
        status: result.updateAvailable ? "available" : "current",
        currentVersion: currentAppVersion,
        release: result.release
      });
      setUpdateNoticeDismissed(false);
    } catch (error) {
      setAppUpdate({
        status: "error",
        currentVersion: currentAppVersion,
        error: error instanceof Error ? error.message : "Could not check for application updates."
      });
    }
  };

  const openAvailableUpdate = () => {
    if (appUpdate.status === "available" || appUpdate.status === "current") {
      void openReleasePage(appUpdate.release.url);
    }
  };

  useEffect(() => {
    void checkCatalogs(true);
    void checkAppUpdates();
    // Catalog and app update checks happen once on launch; subsequent checks are user initiated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = (next: Page) => {
    setPage(next);
    setMobileNav(false);
  };

  const beginRun = async (name: string, selectedSuites: TestSuite[], targets: RunTarget[]) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPage("live-run");
    const completed = await executeRun(
      name,
      selectedSuites,
      targets,
      connections,
      (run, nextProgress) => {
        setActiveRun(run);
        setProgress(nextProgress);
      },
      controller.signal
    );
    abortRef.current = null;
    persistRuns([completed, ...runs.filter((run) => run.id !== completed.id)]);
    setSelectedRunId(completed.id);
  };

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <img src="/logo.png" alt="Safe AI for Humanity" />
          <div>
            <strong>AI4H</strong>
            <span>Eval Lab</span>
          </div>
        </div>
        <button className="sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        <nav aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => (
            <button key={item.page} className={page === item.page ? "active" : ""} onClick={() => navigate(item.page)}>
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.page === "results" && runs.length > 0 && <small>{runs.length}</small>}
            </button>
          ))}
          <p className="nav-label nav-label-secondary">Manage</p>
          <button className={page === "settings" ? "active" : ""} onClick={() => navigate("settings")}>
            <Settings size={18} />
            <span>Settings & sources</span>
          </button>
        </nav>
        <div className="sidebar-card">
          <ShieldCheck size={20} />
          <div><strong>Local by default</strong><span>No telemetry. Results stay on this device.</span></div>
        </div>
        <div className="sidebar-footer">
          <span>Safe AI for Humanity Foundation</span>
          <a href="https://github.com/SafeAI4Humanity" target="_blank" rel="noreferrer"><Github size={16} /> Open source</a>
        </div>
      </aside>
      {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}

      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="catalog-status">
            <span className={catalogChecking ? "status-pulse checking" : "status-pulse"} />
            {catalogMessage}
          </div>
          <div className="topbar-actions">
            <button className="icon-button" title="Help"><CircleHelp size={19} /></button>
            <button className="button button-primary button-small" onClick={() => navigate("new-run")}><Play size={15} fill="currentColor" /> New evaluation</button>
          </div>
        </header>

        <div className="page-wrap">
          {appUpdate.status === "available" && !updateNoticeDismissed && (
            <section className="app-update-banner" role="status" aria-live="polite">
              <span className="update-banner-icon"><Download size={19} /></span>
              <div><strong>AI4H Eval Lab {appUpdate.release.tagName} is available</strong><span>You are using v{appUpdate.currentVersion}. Review the release notes before downloading the installer for your platform.</span></div>
              <button className="button button-primary button-small" onClick={openAvailableUpdate}><ExternalLink size={15} /> View release</button>
              <button className="icon-button small" onClick={() => setUpdateNoticeDismissed(true)} aria-label="Dismiss update notification"><X size={16} /></button>
            </section>
          )}
          {page === "dashboard" && (
            <Dashboard
              suites={suites}
              connections={connections}
              runs={runs}
              catalogChecking={catalogChecking}
              onNavigate={navigate}
              onCheckCatalog={() => void checkCatalogs()}
            />
          )}
          {page === "library" && <TestLibrary suites={suites} sources={sources} onRunSuite={() => navigate("new-run")} />}
          {page === "new-run" && <NewEvaluation suites={suites} connections={connections} onStart={beginRun} onConnections={() => navigate("connections")} />}
          {page === "live-run" && (
            <LiveRun run={activeRun} progress={progress} onCancel={() => abortRef.current?.abort()} onResults={() => navigate("results")} />
          )}
          {page === "results" && (
            <Results
              runs={runs}
              selected={selectedRun}
              connections={connections}
              suites={suites}
              onSelect={setSelectedRunId}
              onNew={() => navigate("new-run")}
              onSaveReview={saveResultReview}
            />
          )}
          {page === "connections" && <Connections connections={connections} onChange={persistConnections} />}
          {page === "settings" && (
            <SettingsPage
              sources={sources}
              interfaceScale={interfaceScale}
              onInterfaceScaleChange={persistInterfaceScale}
              onChange={persistSources}
              onRefresh={() => void checkCatalogs()}
              checking={catalogChecking}
              appUpdate={appUpdate}
              onCheckUpdate={() => void checkAppUpdates()}
              onOpenUpdate={openAvailableUpdate}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="page-title-row">
      <div className="page-title">
        {eyebrow && <span>{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function Dashboard({
  suites,
  connections,
  runs,
  catalogChecking,
  onNavigate,
  onCheckCatalog
}: {
  suites: TestSuite[];
  connections: Connection[];
  runs: EvaluationRun[];
  catalogChecking: boolean;
  onNavigate: (page: Page) => void;
  onCheckCatalog: () => void;
}) {
  const completedResults = runs.flatMap((run) => run.results);
  const recorded = completedResults.length;
  const latest = runs[0];
  const localConnection = connections.find((connection) => connection.provider === "ollama");

  return (
    <>
      <PageTitle
        eyebrow="Research workspace"
        title="Good morning"
        description="Run transparent, reproducible safety evaluations across local and hosted language models."
      />

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="hero-kicker"><Sparkles size={14} /> Start with a trusted suite</span>
          <h2>What would you like to evaluate?</h2>
          <p>Select one or more public-interest test suites, compare models, and keep a complete evidence trail.</p>
          <div className="hero-actions">
            <button className="button button-light" onClick={() => onNavigate("new-run")}><Play size={16} fill="currentColor" /> New evaluation</button>
            <button className="button button-ghost-light" onClick={() => onNavigate("library")}>Browse test library <ArrowRight size={16} /></button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one"><ShieldCheck /></div>
          <div className="orbit orbit-two"><Bot /></div>
          <div className="orbit orbit-three"><TestTube2 /></div>
          <div className="hero-core"><Activity /></div>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard icon={TestTube2} tone="teal" label="Available suites" value={String(suites.length)} detail={`${suites.reduce((sum, suite) => sum + suite.cases.length, 0)} individual tests`} />
        <MetricCard icon={Server} tone="blue" label="Model connections" value={String(connections.length)} detail={`${connections.filter((connection) => connection.status === "connected").length} verified`} />
        <MetricCard icon={Activity} tone="amber" label="Evaluation runs" value={String(runs.length)} detail={runs.length ? `${recorded} case results recorded` : "Ready for your first run"} />
        <MetricCard icon={HardDrive} tone="slate" label="Data location" value="Local" detail="Nothing uploaded by AI4H" />
      </section>

      <section className="dashboard-grid">
        <div className="panel recent-panel">
          <div className="panel-heading">
            <div><h3>Recent evaluations</h3><p>Your latest model test runs</p></div>
            <button className="text-button" onClick={() => onNavigate("results")}>View all <ArrowRight size={14} /></button>
          </div>
          {runs.length === 0 ? (
            <div className="empty-state compact">
              <div className="empty-icon"><BarChart3 size={22} /></div>
              <strong>No evaluations yet</strong>
              <span>Run a starter suite to create your first evidence record.</span>
              <button className="button button-secondary button-small" onClick={() => onNavigate("new-run")}>Set up an evaluation</button>
            </div>
          ) : (
            <div className="run-list">
              {runs.slice(0, 4).map((run) => {
                const summary = runSummary(run);
                return (
                  <button key={run.id} className="run-row" onClick={() => onNavigate("results")}>
                    <div className="run-icon"><Activity size={17} /></div>
                    <div className="run-main"><strong>{run.name}</strong><span>{run.targets.map((target) => target.model).join(", ")}</span></div>
                    <span className="run-date">{formatRelative(run.createdAt)}</span>
                    <span className="mini-result pass"><Check size={12} /> {summary.pass}</span>
                    <span className="mini-result fail"><X size={12} /> {summary.fail}</span>
                    <span className="mini-result error"><WifiOff size={12} /> {summary.error}</span>
                    <ChevronDown className="row-chevron" size={16} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel readiness-panel">
          <div className="panel-heading"><div><h3>Lab readiness</h3><p>Connections and catalog health</p></div></div>
          <div className="readiness-item">
            <div className={`readiness-icon ${localConnection?.status === "connected" ? "good" : "neutral"}`}><HardDrive size={17} /></div>
            <div><strong>Local Ollama</strong><span>{localConnection?.status === "connected" ? `${localConnection.models?.length ?? 0} models found` : "Ready to connect"}</span></div>
            <button className="text-button" onClick={() => onNavigate("connections")}>Manage</button>
          </div>
          <div className="readiness-item">
            <div className="readiness-icon good"><BookOpen size={17} /></div>
            <div><strong>Test catalog</strong><span>{suites.length} validated suites loaded</span></div>
            <button className="icon-button small" onClick={onCheckCatalog} disabled={catalogChecking} aria-label="Refresh catalog"><RefreshCw className={catalogChecking ? "spinning" : ""} size={15} /></button>
          </div>
          <div className="readiness-item">
            <div className="readiness-icon good"><ShieldCheck size={17} /></div>
            <div><strong>Privacy mode</strong><span>Telemetry disabled</span></div>
            <span className="status-chip success">Protected</span>
          </div>
          {latest && (
            <div className="last-run-note"><Clock3 size={14} /> Last run {formatRelative(latest.createdAt)}</div>
          )}
        </div>
      </section>
    </>
  );
}

function MetricCard({ icon: Icon, tone, label, value, detail }: { icon: typeof Activity; tone: string; label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}><Icon size={20} /></div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </div>
  );
}

function TestLibrary({ suites, sources, onRunSuite }: { suites: TestSuite[]; sources: CatalogSource[]; onRunSuite: () => void }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [inspecting, setInspecting] = useState<TestSuite | null>(null);
  const categories = ["All", ...new Set(suites.map((suite) => suite.category))];
  const filtered = suites.filter((suite) => {
    const normalize = (value: string) => value.toLowerCase().replace(/[-&]/g, " ").replace(/\s+/g, " ").trim();
    const text = normalize(`${suite.title} ${suite.summary} ${suite.tags.join(" ")}`);
    return (category === "All" || suite.category === category) && text.includes(normalize(search));
  });

  return (
    <>
      <PageTitle
        eyebrow="Community resources"
        title="Test library"
        description="Transparent, versioned evaluation suites from AI4H and trusted community sources."
        action={<div className="source-count"><Cloud size={16} /> {sources.filter((source) => source.enabled).length + 1} active sources</div>}
      />
      <div className="library-toolbar">
        <label className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suites, tags, or categories…" /></label>
        <div className="category-tabs">
          {categories.slice(0, 5).map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
        <button className="button button-secondary"><Filter size={16} /> Filters</button>
      </div>
      <div className="suite-count"><strong>{filtered.length}</strong> suites · {filtered.reduce((sum, suite) => sum + suite.cases.length, 0)} tests</div>
      <div className="suite-grid">
        {filtered.map((suite) => <SuiteCard key={`${suite.id}-${suite.version}`} suite={suite} onRun={onRunSuite} onInspect={() => setInspecting(suite)} />)}
      </div>
      {inspecting && <SuiteInspector suite={inspecting} onClose={() => setInspecting(null)} />}
    </>
  );
}

function SuiteCard({ suite, onRun, onInspect }: { suite: TestSuite; onRun: () => void; onInspect: () => void }) {
  const categoryIcon = suite.category.includes("injection") ? ShieldCheck : suite.category.includes("ground") ? BookOpen : TestTube2;
  const Icon = categoryIcon;
  return (
    <article className="suite-card">
      <div className="suite-top">
        <div className="suite-icon"><Icon size={21} /></div>
        <div className="suite-badges">
          <span className={`risk-badge ${suite.risk}`}>{suite.risk} risk</span>
          <button className="icon-button small" aria-label="More suite options"><MoreHorizontal size={17} /></button>
        </div>
      </div>
      <span className="suite-category">{suite.category}</span>
      <h3>{suite.title}</h3>
      <p>{suite.summary}</p>
      <div className="tag-list">{suite.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <div className="suite-meta">
        <span><TestTube2 size={14} /> {suite.cases.length} tests</span>
        <span>v{suite.version}</span>
        <span className={suite.sourceId === "bundled" || suite.sourceId === "ai4h-official" ? "verified" : ""}>
          {suite.sourceId === "bundled" || suite.sourceId === "ai4h-official" ? <><ShieldCheck size={14} /> AI4H</> : "Community"}
        </span>
      </div>
      <div className="suite-footer">
        <span>{suite.license}</span>
        <div className="suite-footer-actions"><button className="text-button" onClick={onInspect}>View criteria</button><button className="text-button" onClick={onRun}>Run suite <ArrowRight size={14} /></button></div>
      </div>
    </article>
  );
}

function SuiteInspector({ suite, onClose }: { suite: TestSuite; onClose: () => void }) {
  return (
    <Modal title={`${suite.title} · v${suite.version}`} onClose={onClose}>
      <div className="suite-inspector">
        <div className="inspector-summary"><p>{suite.summary}</p><span>{suite.id}</span><span>{suite.contentHash ?? "No content hash supplied"}</span></div>
        {suite.cases.map((testCase) => (
          <section className="inspector-case" key={testCase.id}>
            <div className="inspector-case-heading"><div><span>Test case</span><h3>{testCase.title}</h3></div><code>{testCase.id}</code></div>
            <div className="inspector-block"><strong>Messages sent to the model</strong>{testCase.messages.map((message, index) => <div className="inspector-message" key={index}><span>{message.role}</span><p>{message.content}</p></div>)}</div>
            <div className="inspector-parameters"><span>Temperature <strong>{testCase.parameters?.temperature ?? "provider default"}</strong></span><span>Max tokens <strong>{testCase.parameters?.maxTokens ?? "provider default"}</strong></span><span>Seed <strong>{testCase.parameters?.seed ?? "not set"}</strong></span></div>
            <div className="inspector-block"><strong>Evaluation criteria</strong>{testCase.evaluators.map((evaluator, index) => <div className="inspector-rule" key={index}><span>{evaluator.type.replaceAll("_", " ")}</span><p>{formatEvaluatorCriteria(evaluator)}</p></div>)}</div>
          </section>
        ))}
        <div className="modal-actions"><button className="button button-primary" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

function NewEvaluation({ suites, connections, onStart, onConnections }: { suites: TestSuite[]; connections: Connection[]; onStart: (name: string, suites: TestSuite[], targets: RunTarget[]) => void; onConnections: () => void }) {
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<string[]>(suites.slice(0, 1).map((suite) => suite.id));
  const [targets, setTargets] = useState<Array<{ connectionId: string; model: string }>>([]);
  const [name, setName] = useState(`Model safety evaluation · ${new Date().toLocaleDateString()}`);
  const selectedSuites = suites.filter((suite) => selectedSuiteIds.includes(suite.id));
  const totalCases = selectedSuites.reduce((sum, suite) => sum + suite.cases.length, 0) * Math.max(targets.length, 1);

  const toggleSuite = (id: string) => setSelectedSuiteIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const addTarget = (connection: Connection) => {
    const defaultModel = connection.modelHint ?? connection.models?.[0] ?? "";
    setTargets((current) => [...current, { connectionId: connection.id, model: defaultModel }]);
  };
  const start = () => {
    const runTargets: RunTarget[] = targets.map((target) => {
      const connection = connections.find((item) => item.id === target.connectionId)!;
      return {
        id: crypto.randomUUID(),
        connectionId: connection.id,
        provider: connection.provider,
        connectionName: connection.name,
        model: target.model.trim()
      };
    });
    if (selectedSuites.length && runTargets.length && runTargets.every((target) => target.model)) void onStart(name, selectedSuites, runTargets);
  };

  return (
    <>
      <PageTitle eyebrow="Evaluation builder" title="New evaluation" description="Choose test suites and model targets. You will review the exact scope before requests are sent." />
      <div className="builder-layout">
        <div className="builder-main">
          <section className="panel builder-section">
            <div className="step-heading"><span>1</span><div><h3>Name this run</h3><p>Use a clear name so the result can be identified later.</p></div></div>
            <label className="field"><span>Evaluation name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          </section>
          <section className="panel builder-section">
            <div className="step-heading"><span>2</span><div><h3>Select test suites</h3><p>Suite contents and version hashes are stored with the result.</p></div><strong>{selectedSuiteIds.length} selected</strong></div>
            <div className="suite-picker">
              {suites.map((suite) => (
                <button key={suite.id} className={selectedSuiteIds.includes(suite.id) ? "selected" : ""} onClick={() => toggleSuite(suite.id)}>
                  <span className="check-box">{selectedSuiteIds.includes(suite.id) && <Check size={14} />}</span>
                  <span className="picker-main"><strong>{suite.title}</strong><small>{suite.category} · {suite.cases.length} tests · v{suite.version}</small></span>
                  <span className={`risk-badge ${suite.risk}`}>{suite.risk}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="panel builder-section">
            <div className="step-heading"><span>3</span><div><h3>Add model targets</h3><p>Compare multiple providers or models in one run.</p></div><strong>{targets.length} targets</strong></div>
            {targets.length > 0 && (
              <div className="target-list">
                {targets.map((target, index) => {
                  const connection = connections.find((item) => item.id === target.connectionId)!;
                  return (
                    <div className="target-row" key={`${target.connectionId}-${index}`}>
                      <div className="provider-mark"><Bot size={17} /></div>
                      <div><strong>{connection.name}</strong><span>{providerLabel(connection.provider)}</span></div>
                      {connection.models?.length ? (
                        <select value={target.model} onChange={(event) => setTargets((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, model: event.target.value } : item))}>
                          <option value="">Choose a model</option>
                          {connection.models.map((model) => <option key={model} value={model}>{model}</option>)}
                        </select>
                      ) : (
                        <input value={target.model} placeholder="Exact model ID" onChange={(event) => setTargets((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, model: event.target.value } : item))} />
                      )}
                      <button className="icon-button small danger" onClick={() => setTargets((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove target"><X size={16} /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="connection-picker">
              {connections.filter((connection) => connection.enabled).map((connection) => (
                <button key={connection.id} onClick={() => addTarget(connection)}>
                  <Plus size={16} /><span><strong>{connection.name}</strong><small>{connection.models?.length ? `${connection.models.length} models available` : "Enter model ID after adding"}</small></span>
                </button>
              ))}
              <button onClick={onConnections}><Settings size={16} /><span><strong>Manage connections</strong><small>Add another provider</small></span></button>
            </div>
          </section>
        </div>
        <aside className="run-summary panel">
          <h3>Run summary</h3>
          <div className="summary-line"><span>Suites</span><strong>{selectedSuites.length}</strong></div>
          <div className="summary-line"><span>Individual tests</span><strong>{selectedSuites.reduce((sum, suite) => sum + suite.cases.length, 0)}</strong></div>
          <div className="summary-line"><span>Model targets</span><strong>{targets.length}</strong></div>
          <div className="summary-line total"><span>Total requests</span><strong>{targets.length ? totalCases : 0}</strong></div>
          <div className="privacy-callout"><ShieldCheck size={18} /><div><strong>Evidence-first record</strong><span>Provider, model ID, parameters, suite versions, raw responses, and timing will be recorded locally.</span></div></div>
          <button className="button button-primary button-full" disabled={!selectedSuites.length || !targets.length || targets.some((target) => !target.model.trim())} onClick={start}>
            <Play size={16} fill="currentColor" /> Start evaluation
          </button>
          {targets.some((target) => connections.find((connection) => connection.id === target.connectionId)?.provider !== "ollama") && (
            <p className="remote-warning"><Cloud size={14} /> Selected prompts will be sent to remote API providers.</p>
          )}
        </aside>
      </div>
    </>
  );
}

function LiveRun({ run, progress, onCancel, onResults }: { run: EvaluationRun | null; progress: RunProgress; onCancel: () => void; onResults: () => void }) {
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const summary = run ? runSummary(run) : { pass: 0, fail: 0, review: 0, error: 0 };
  const done = run?.status === "completed" || run?.status === "cancelled";
  return (
    <>
      <PageTitle eyebrow="Live evaluation" title={run?.name ?? "Preparing evaluation…"} description={done ? `Run ${run?.status}. Review the evidence and model responses.` : "Requests are processed in a stable order and saved as they complete."} />
      <div className="live-layout">
        <section className="panel progress-panel">
          <div className="progress-header">
            <div className={`live-status ${done ? "done" : ""}`}>{done ? <CheckCircle2 size={20} /> : <LoaderCircle className="spinning" size={20} />}<div><strong>{done ? "Evaluation complete" : "Evaluation in progress"}</strong><span>{progress.completed} of {progress.total} requests processed</span></div></div>
            <strong className="progress-percent">{percent}%</strong>
          </div>
          <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
          <div className="live-metrics">
            <span className="pass"><CheckCircle2 size={16} /> {summary.pass} passed</span>
            <span className="fail"><XCircle size={16} /> {summary.fail} failed</span>
            <span className="review"><CircleHelp size={16} /> {summary.review} review</span>
            <span className="error"><WifiOff size={16} /> {summary.error} errors</span>
            <span><Clock3 size={16} /> {run ? formatDuration(Date.now() - new Date(run.createdAt).getTime()) : "0s"}</span>
          </div>
          <div className="live-actions">
            {!done ? <button className="button button-secondary" onClick={onCancel}><Square size={14} fill="currentColor" /> Stop run</button> : <button className="button button-primary" onClick={onResults}>Open full results <ArrowRight size={15} /></button>}
          </div>
        </section>
        <section className="panel evidence-stream">
          <div className="panel-heading"><div><h3>Evidence stream</h3><p>Most recent results appear first</p></div></div>
          <div className="evidence-list">
            {[...(run?.results ?? [])].reverse().map((result) => <EvidenceRow key={result.id} result={result} />)}
            {!run?.results.length && <div className="empty-state compact"><LoaderCircle className="spinning" size={22} /><strong>Waiting for the first response</strong></div>}
          </div>
        </section>
      </div>
    </>
  );
}

function EvidenceRow({ result }: { result: CaseResult }) {
  return (
    <div className="evidence-row">
      <span className={`result-dot ${result.status}`}>{result.status === "pass" ? <Check size={13} /> : result.status === "fail" || result.status === "error" ? <X size={13} /> : <CircleHelp size={13} />}</span>
      <div><strong>{result.caseTitle}</strong><span>{result.target.model} · {result.target.connectionName}</span>{result.error && <small>{result.error}</small>}</div>
      <span className={`status-chip ${result.status}`}>{result.status}</span>
      <span className="latency">{result.latencyMs.toLocaleString()} ms</span>
    </div>
  );
}

function Results({
  runs,
  selected,
  connections,
  suites,
  onSelect,
  onNew,
  onSaveReview
}: {
  runs: EvaluationRun[];
  selected: EvaluationRun | null;
  connections: Connection[];
  suites: TestSuite[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onSaveReview: (runId: string, resultId: string, review: ResultReview) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [publicationOpen, setPublicationOpen] = useState(false);
  if (!selected) {
    return <><PageTitle eyebrow="Evidence archive" title="Results" description="Compare model behavior and inspect every evaluator decision." /><div className="panel empty-state"><BarChart3 size={28} /><strong>No results yet</strong><span>Complete an evaluation to see results here.</span><button className="button button-primary" onClick={onNew}>Start an evaluation</button></div></>;
  }
  const summary = runSummary(selected);
  const scoredTotal = summary.pass + summary.fail + summary.review;
  const passPercent = scoredTotal ? Math.round((summary.pass / scoredTotal) * 100) : 0;
  return (
    <>
      <PageTitle
        eyebrow="Evidence archive"
        title="Results"
        description="Inspect model-identified results, raw responses, timing, and evaluator decisions."
        action={<div className="page-actions"><button className="button button-secondary" onClick={() => setPublicationOpen(true)}><FileJson size={16} /> Prepare publication</button><button className="button button-secondary" onClick={() => setBulkReviewOpen(true)}><Bot size={16} /> Bulk LLM review</button><button className="button button-secondary" onClick={() => exportRun(selected)}><Download size={16} /> Export JSON</button></div>}
      />
      <div className="results-layout">
        <aside className="run-history panel">
          <div className="panel-heading"><div><h3>Evaluation runs</h3><p>{runs.length} stored locally</p></div></div>
          {runs.map((run) => (
            <button key={run.id} className={run.id === selected.id ? "active" : ""} onClick={() => onSelect(run.id)}>
              <span className="history-icon"><Activity size={16} /></span>
              <span><strong>{run.name}</strong><small>{formatDate(run.createdAt)} · {run.targets.length} target{run.targets.length === 1 ? "" : "s"}</small></span>
            </button>
          ))}
        </aside>
        <div className="results-main">
          <section className="panel result-overview">
            <div className="result-title"><div><span className="status-chip success">{selected.status}</span><h2>{selected.name}</h2><p>{formatDate(selected.createdAt)} · {selected.suiteSnapshots.map((suite) => `${suite.title} v${suite.version}`).join(", ")}</p></div><button className="icon-button"><MoreHorizontal size={19} /></button></div>
            <div className="score-row">
              <div className="score-ring" style={{ "--score": `${passPercent * 3.6}deg` } as React.CSSProperties}><span><strong>{scoredTotal ? `${passPercent}%` : "—"}</strong><small>automatic pass</small></span></div>
              <div className="score-stat pass"><span><CheckCircle2 size={17} /> Passed</span><strong>{summary.pass}</strong></div>
              <div className="score-stat fail"><span><XCircle size={17} /> Failed</span><strong>{summary.fail}</strong></div>
              <div className="score-stat review"><span><CircleHelp size={17} /> Needs review</span><strong>{summary.review}</strong></div>
              <div className="score-stat error"><span><WifiOff size={17} /> Errors</span><strong>{summary.error}</strong></div>
              <div className="score-stat"><span><Clock3 size={17} /> Median latency</span><strong>{median(selected.results.map((result) => result.latencyMs)).toLocaleString()} ms</strong></div>
            </div>
            <div className="interpretation-note"><AlertTriangle size={17} /><span><strong>Interpret with care.</strong> Automatic checks are indicators, not a universal safety score. Review raw responses and suite limitations before publishing claims.</span></div>
          </section>
          <section className="panel result-table-panel">
            <div className="panel-heading"><div><h3>Case evidence</h3><p>Every response is tied to an identified model and suite snapshot</p></div><label className="mini-search"><Search size={15} /><input placeholder="Find a result" /></label></div>
            <div className="result-table">
              <div className="result-table-head"><span>Test case</span><span>Model</span><span>Outcome</span><span>Latency</span><span /></div>
              {selected.results.map((result) => {
                const review = latestReview(result);
                return <div className="result-record" key={result.id}>
                  <button className="result-record-row" onClick={() => setExpanded(expanded === result.id ? null : result.id)}>
                    <span><i className={`result-dot ${result.status}`}>{result.status === "pass" ? <Check size={12} /> : result.status === "review" ? <CircleHelp size={12} /> : <X size={12} />}</i><span><strong>{result.caseTitle}</strong><small>{result.suiteId} · v{result.suiteVersion}</small></span></span>
                    <span><strong>{result.target.model}</strong><small>{providerLabel(result.target.provider)}</small></span>
                    <span className="outcome-stack"><b className={`status-chip ${result.status}`}>{result.status}</b>{review && <small className={`review-verdict ${review.verdict}`}>{review.reviewerType === "human" ? "Human" : "Model"}: {review.verdict}</small>}</span>
                    <span>{result.latencyMs.toLocaleString()} ms</span>
                    <span><ChevronDown className={expanded === result.id ? "rotated" : ""} size={17} /></span>
                  </button>
                  {expanded === result.id && (
                    <div className="result-detail">
                      <div><h4>Raw model response</h4><pre>{result.response || result.error}</pre></div>
                      <div><h4>Evaluator evidence</h4>{result.outcomes.map((outcome, index) => <div className="evaluator-record" key={index}><p className={outcome.status}><span>{outcome.status === "pass" ? <Check size={13} /> : outcome.status === "fail" ? <X size={13} /> : <CircleHelp size={13} />}</span>{outcome.explanation}</p><small>{formatEvaluatorCriteria(outcome.evaluator)}</small></div>)}</div>
                      <ResultReviewPanel result={result} connections={connections} onSave={(nextReview) => onSaveReview(selected.id, result.id, nextReview)} />
                      <small>Suite hash: {result.suiteHash ?? "not supplied"} · Started {new Date(result.startedAt).toISOString()}</small>
                    </div>
                  )}
                </div>;
              })}
            </div>
          </section>
        </div>
      </div>
      {bulkReviewOpen && <BulkReviewModal run={selected} connections={connections} onSave={onSaveReview} onClose={() => setBulkReviewOpen(false)} />}
      {publicationOpen && <PublicationModal run={selected} suites={suites} onClose={() => setPublicationOpen(false)} />}
    </>
  );
}

function PublicationModal({ run, suites, onClose }: { run: EvaluationRun; suites: TestSuite[]; onClose: () => void }) {
  const [submitter, setSubmitter] = useState("");
  const [notes, setNotes] = useState("");
  const [publicConsent, setPublicConsent] = useState(false);
  const [evidenceConsent, setEvidenceConsent] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const issues = publicationIssues(run, suites);
  const modelCount = new Set(run.results.map((result) => `${result.target.provider}:${result.target.model}`)).size;
  const reviewedCount = run.results.filter((result) => result.reviews?.length).length;

  const prepare = () => {
    if (issues.length || !publicConsent || !evidenceConsent) return;
    const submission = buildEvaluationSubmission(run, suites, { submitter, notes }, currentAppVersion);
    downloadJson(submission, submissionFileName(submission));
    setDownloaded(true);
  };

  return (
    <Modal title="Prepare website submission" onClose={onClose} wide>
      <div className="publication-modal">
        <div className="publication-warning"><AlertTriangle size={18} /><span><strong>This creates a public evidence bundle.</strong> If accepted through GitHub review, prompts, model responses, evaluator evidence, and saved review notes will be visible on the AI4H website.</span></div>
        <div className="bulk-review-counts publication-counts">
          <span><strong>{run.results.length}</strong> case results</span>
          <span><strong>{modelCount}</strong> identified model{modelCount === 1 ? "" : "s"}</span>
          <span><strong>{reviewedCount}</strong> reviewed responses</span>
        </div>
        {issues.length ? <div className="publication-issues"><strong>This run is not ready for public submission</strong>{issues.slice(0, 6).map((issue) => <span key={issue}>{issue}</span>)}<small>Refresh the official catalog and run the evaluation again to capture release-grade suite metadata.</small></div> : null}
        <div className="publication-grid">
          <div><strong>Included</strong><span>Exact provider and model IDs</span><span>Suite versions, categories, and SHA-256 hashes</span><span>Prompts, raw responses, evaluator outcomes, and reviews</span><span>Timing and token counts when available</span></div>
          <div><strong>Excluded</strong><span>API keys and stored credentials</span><span>Connection URLs, IDs, and local connection names</span><span>Hostnames, local paths, and diagnostic details</span><span>Application logs and unrelated settings</span></div>
        </div>
        <label className="field"><span>Public submitter name <small>Optional</small></span><input value={submitter} onChange={(event) => setSubmitter(event.target.value)} maxLength={120} placeholder="Individual, lab, or organization" /></label>
        <label className="field"><span>Methodology notes <small>Optional</small></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={4} placeholder="Hardware context, reproduction notes, or other information readers should know" /></label>
        <label className="consent-row"><input type="checkbox" checked={publicConsent} onChange={(event) => setPublicConsent(event.target.checked)} /><span><strong>I authorize public release of this evaluation bundle.</strong><small>Accepted submissions remain publicly downloadable and may be cited by AI4H or others.</small></span></label>
        <label className="consent-row"><input type="checkbox" checked={evidenceConsent} onChange={(event) => setEvidenceConsent(event.target.checked)} /><span><strong>I reviewed the raw responses and review notes for sensitive information.</strong><small>Model output is untrusted content and may contain inaccurate, offensive, or unsafe material.</small></span></label>
        {downloaded && <div className="publication-ready"><CheckCircle2 size={17} /><span><strong>Bundle downloaded.</strong> Review the file once more, then add it under <code>submissions/YYYY/MM/</code> in the results repository through a pull request.</span></div>}
        <div className="modal-actions">
          <button className="button button-secondary" onClick={onClose}>Close</button>
          {downloaded && <button className="button button-secondary" onClick={() => void openReleasePage("https://github.com/SafeAI4Humanity/ai4h-evaluation-results")}><Github size={15} /> Contribution instructions</button>}
          <button className="button button-primary" onClick={prepare} disabled={Boolean(issues.length) || !publicConsent || !evidenceConsent}><Download size={15} /> Download public bundle</button>
        </div>
      </div>
    </Modal>
  );
}

function BulkReviewModal({ run, connections, onSave, onClose }: {
  run: EvaluationRun;
  connections: Connection[];
  onSave: (runId: string, resultId: string, review: ResultReview) => void;
  onClose: () => void;
}) {
  const [reviewTarget, setReviewTarget] = useState("");
  const [scope, setScope] = useState<BulkReviewScope>("unreviewed");
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const [failures, setFailures] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const [outcome, setOutcome] = useState<"complete" | "cancelled" | null>(null);
  const cancelRef = useRef(false);
  const reviewTargets = connectedReviewTargets(connections);
  const selectedTarget = reviewTargets.find((target) => target.key === reviewTarget) ?? reviewTargets[0];
  const candidates = selectedTarget ? bulkReviewCandidates(run.results, selectedTarget, scope) : [];
  const responseResults = run.results.filter((result) => result.response && result.status !== "error");
  const sameModelCount = selectedTarget ? responseResults.filter((result) => isSameReviewerModel(result, selectedTarget)).length : 0;
  const previouslyReviewedCount = responseResults.filter((result) => result.reviews?.some((review) => review.reviewerType === "model")).length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  const startBulkReview = async () => {
    if (!selectedTarget) return;
    const queue = [...bulkReviewCandidates(run.results, selectedTarget, scope)];
    if (!queue.length) return;
    cancelRef.current = false;
    setRunning(true);
    setCancelling(false);
    setCompleted(0);
    setTotal(queue.length);
    setFailures([]);
    setOutcome(null);
    let processed = 0;
    for (const result of queue) {
      if (cancelRef.current) break;
      setCurrentTitle(result.caseTitle);
      try {
        onSave(run.id, result.id, await runModelReview(result, selectedTarget));
      } catch (error) {
        setFailures((current) => [...current, {
          id: result.id,
          title: result.caseTitle,
          message: error instanceof Error ? error.message : "The model review failed."
        }]);
      }
      processed += 1;
      setCompleted(processed);
    }
    setCurrentTitle(null);
    setOutcome(cancelRef.current ? "cancelled" : "complete");
    setRunning(false);
    setCancelling(false);
  };

  const requestCancel = () => {
    cancelRef.current = true;
    setCancelling(true);
  };

  return (
    <Modal title="Bulk LLM review" onClose={onClose} closeDisabled={running} wide>
      <div className="bulk-review-modal">
        <div className="model-review-warning"><AlertTriangle size={17} /><span><strong>Human review is strongly recommended.</strong> Bulk LLM review is useful for triage, but a model judge can repeat biases, miss nuance, or be influenced by evaluated content. Treat these verdicts as review assistance.</span></div>
        {reviewTargets.length ? <div className="bulk-review-config">
          <label className="field"><span>Reviewing model</span><select value={selectedTarget?.key ?? ""} onChange={(event) => setReviewTarget(event.target.value)} disabled={running}>{reviewTargets.map((target) => <option key={target.key} value={target.key}>{target.connection.name} · {target.model}</option>)}</select></label>
          <label className="field"><span>Review scope</span><select value={scope} onChange={(event) => setScope(event.target.value as BulkReviewScope)} disabled={running}><option value="unreviewed">Responses without an LLM review</option><option value="all">All responses — add another review</option></select></label>
        </div> : <p className="review-empty">Connect and test an LLM with an available model before starting a bulk review.</p>}
        <div className="bulk-review-counts">
          <span><strong>{candidates.length}</strong> eligible responses</span>
          <span><strong>{sameModelCount}</strong> same-model skipped</span>
          <span><strong>{previouslyReviewedCount}</strong> previously LLM-reviewed</span>
        </div>
        <p className="bulk-review-note">The reviewer must be different from the evaluated model. Requests run one at a time to reduce rate-limit pressure, and every completed verdict is saved immediately.</p>
        {(running || outcome) && <div className="bulk-review-progress">
          <div><strong>{running ? cancelling ? "Stopping after the current response…" : `Reviewing ${currentTitle ?? "response"}` : outcome === "cancelled" ? "Bulk review stopped" : "Bulk review complete"}</strong><span>{completed} of {total} processed · {Math.max(0, completed - failures.length)} saved · {failures.length} failed</span></div>
          <b>{percent}%</b>
          <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
        </div>}
        {failures.length ? <div className="bulk-review-errors"><strong>{failures.length} response{failures.length === 1 ? "" : "s"} could not be reviewed</strong>{failures.slice(0, 4).map((failure) => <span key={failure.id}>{failure.title}: {failure.message}</span>)}</div> : null}
        <div className="modal-actions">
          <button className="button button-secondary" onClick={onClose} disabled={running}>Close</button>
          {running ? <button className="button button-secondary" onClick={requestCancel} disabled={cancelling}><Square size={14} fill="currentColor" /> {cancelling ? "Stopping…" : "Stop after current"}</button> : <button className="button button-primary" onClick={() => void startBulkReview()} disabled={!selectedTarget || !candidates.length}><Bot size={15} /> {outcome ? "Run bulk review again" : `Review ${candidates.length} response${candidates.length === 1 ? "" : "s"}`}</button>}
        </div>
      </div>
    </Modal>
  );
}

function ResultReviewPanel({ result, connections, onSave }: { result: CaseResult; connections: Connection[]; onSave: (review: ResultReview) => void }) {
  const [reviewerType, setReviewerType] = useState<"human" | "model">("human");
  const [humanVerdict, setHumanVerdict] = useState<ReviewVerdict | null>(null);
  const [notes, setNotes] = useState("");
  const [reviewTarget, setReviewTarget] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewTargets = connectedReviewTargets(connections);
  const selectedTarget = reviewTargets.find((target) => target.key === reviewTarget) ?? reviewTargets[0];

  const saveHumanReview = () => {
    if (!humanVerdict) return;
    onSave({
      id: crypto.randomUUID(),
      reviewerType: "human",
      verdict: humanVerdict,
      reviewedAt: new Date().toISOString(),
      notes: notes.trim() || undefined
    });
    setNotes("");
  };

  const askModelToReview = async () => {
    if (!selectedTarget || !result.response) return;
    setReviewing(true);
    setReviewError(null);
    try {
      onSave(await runModelReview(result, selectedTarget));
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The model review failed.");
    } finally {
      setReviewing(false);
    }
  };

  return (
    <section className="review-panel">
      <div className="review-heading"><div><h4>Review decision</h4><p>Review verdicts are stored alongside—never over—the automatic evaluator evidence.</p></div>{result.reviews?.length ? <span>{result.reviews.length} saved</span> : null}</div>
      {result.reviews?.length ? <div className="review-history">{[...result.reviews].reverse().map((review) => (
        <div className="saved-review" key={review.id}>
          <span className={`reviewer-mark ${review.reviewerType}`}>{review.reviewerType === "human" ? <UserCheck size={15} /> : <Bot size={15} />}</span>
          <div><strong>{review.reviewerType === "human" ? "Reviewed by human" : `${review.connectionName} · ${review.model}`}</strong><p>{review.reviewerType === "human" ? review.notes || "No notes supplied." : review.rationale}</p><small>{new Date(review.reviewedAt).toLocaleString()}</small></div>
          <b className={`review-decision ${review.verdict}`}>{review.verdict}</b>
        </div>
      ))}</div> : null}
      <div className="reviewer-tabs" role="tablist" aria-label="Review method">
        <button role="tab" aria-selected={reviewerType === "human"} className={reviewerType === "human" ? "active" : ""} onClick={() => setReviewerType("human")}><UserCheck size={15} /> Reviewed by human</button>
        <button role="tab" aria-selected={reviewerType === "model"} className={reviewerType === "model" ? "active" : ""} onClick={() => setReviewerType("model")}><Bot size={15} /> Use a connected LLM</button>
      </div>
      {reviewerType === "human" ? (
        <div className="human-review-form">
          <div className="verdict-buttons" aria-label="Human verdict">
            <button aria-pressed={humanVerdict === "pass"} className={humanVerdict === "pass" ? "pass selected" : "pass"} onClick={() => setHumanVerdict("pass")}><Check size={15} /> Pass</button>
            <button aria-pressed={humanVerdict === "fail"} className={humanVerdict === "fail" ? "fail selected" : "fail"} onClick={() => setHumanVerdict("fail")}><X size={15} /> Fail</button>
          </div>
          <label><span>Reviewer notes (optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Explain the judgment or note any ambiguity…" /></label>
          <button className="button button-primary button-small" disabled={!humanVerdict} onClick={saveHumanReview}><UserCheck size={15} /> Save human review</button>
        </div>
      ) : (
        <div className="model-review-form">
          <div className="model-review-warning"><AlertTriangle size={17} /><span><strong>Human review is strongly recommended.</strong> An LLM judge can repeat model biases, miss nuance, or produce an unreliable verdict. Treat this as review assistance, not a substitute for human judgment.</span></div>
          {reviewTargets.length ? <label><span>Reviewing model</span><select value={selectedTarget?.key ?? ""} onChange={(event) => setReviewTarget(event.target.value)}>{reviewTargets.map((target) => <option key={target.key} value={target.key}>{target.connection.name} · {target.model}</option>)}</select></label> : <p className="review-empty">Connect and test an LLM with an available model before requesting a model review.</p>}
          {reviewError && <p className="review-error">{reviewError}</p>}
          <button className="button button-secondary button-small" disabled={!selectedTarget || !result.response || reviewing} onClick={() => void askModelToReview()}>{reviewing ? <LoaderCircle className="spinning" size={15} /> : <Bot size={15} />} {reviewing ? "Reviewing…" : "Run model-assisted review"}</button>
        </div>
      )}
    </section>
  );
}

function Connections({ connections, onChange }: { connections: Connection[]; onChange: (connections: Connection[]) => void }) {
  const [editing, setEditing] = useState<(typeof emptyConnection & { id?: string }) | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modalMessage, setModalMessage] = useState<string | null>(null);
  const [scanningModal, setScanningModal] = useState(false);

  const save = async () => {
    if (!editing || !editing.name.trim() || !editing.baseUrl.trim()) return;
    const id = editing.id ?? crypto.randomUUID();
    const connection: Connection = { ...editing, id, name: editing.name.trim(), baseUrl: normalizeProviderBaseUrl(editing.provider, editing.baseUrl) };
    const { apiKey, ...safeConnection } = connection as Connection & { apiKey?: string };
    if (apiKey) await setSecret(id, apiKey);
    const next = editing.id ? connections.map((item) => item.id === id ? safeConnection : item) : [...connections, safeConnection];
    onChange(next);
    setEditing(null);
  };

  const test = async (connection: Connection) => {
    setTestingId(connection.id);
    setMessage(null);
    try {
      const models = await testConnection(connection);
      onChange(connections.map((item) => item.id === connection.id ? {
        ...item,
        models,
        modelHint: item.modelHint && models.includes(item.modelHint) ? item.modelHint : models[0],
        status: "connected",
        lastCheckedAt: new Date().toISOString()
      } : item));
      setMessage(`${connection.name} connected · ${models.length} model${models.length === 1 ? "" : "s"} found`);
    } catch (error) {
      onChange(connections.map((item) => item.id === connection.id ? { ...item, status: "unavailable", lastCheckedAt: new Date().toISOString() } : item));
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setTestingId(null);
    }
  };

  const scanEditingProvider = async () => {
    if (!editing || !discoveryDetails(editing.provider)) return;
    setScanningModal(true);
    setModalMessage(null);
    const candidate: Connection = {
      ...editing,
      id: editing.id ?? `${editing.provider}-connection-preview`,
      name: editing.name || providerLabel(editing.provider),
      baseUrl: normalizeProviderBaseUrl(editing.provider, editing.baseUrl),
      enabled: true
    };
    try {
      const models = await testConnection(candidate, editing.apiKey.trim() || undefined);
      setEditing((current) => current ? {
        ...current,
        models,
        modelHint: current.modelHint && models.includes(current.modelHint) ? current.modelHint : models[0],
        status: "connected",
        lastCheckedAt: new Date().toISOString()
      } : null);
      setModalMessage(`${models.length} model${models.length === 1 ? "" : "s"} available for this connection.`);
    } catch (error) {
      setEditing((current) => current ? { ...current, status: "unavailable" } : null);
      setModalMessage(error instanceof Error ? error.message : "The model provider could not be reached.");
    } finally {
      setScanningModal(false);
    }
  };

  const remove = async (connection: Connection) => {
    await deleteSecret(connection.id);
    onChange(connections.filter((item) => item.id !== connection.id));
  };

  return (
    <>
      <PageTitle
        eyebrow="Model access"
        title="Connections"
        description="Connect local and hosted model providers. Credentials are never included in evaluation data."
        action={<button className="button button-primary" onClick={() => { setModalMessage(null); setEditing({ ...emptyConnection }); }}><Plus size={16} /> Add connection</button>}
      />
      <div className="security-banner"><KeyRound size={19} /><div><strong>Credentials stay protected</strong><span>Desktop builds store API keys in the operating system credential vault. Browser preview keeps them only for this session.</span></div></div>
      {message && <div className="inline-message"><Wifi size={16} /> {message}<button onClick={() => setMessage(null)}><X size={14} /></button></div>}
      <div className="connection-grid">
        {connections.map((connection) => (
          <article className="connection-card" key={connection.id}>
            <div className="connection-card-top">
              <div className={`connection-logo ${connection.provider}`}><Bot size={22} /></div>
              <span className={`connection-state ${connection.status}`}><i /> {connection.status === "connected" ? "Connected" : connection.status === "unavailable" ? "Unavailable" : "Not tested"}</span>
              <button className="icon-button small"><MoreHorizontal size={17} /></button>
            </div>
            <h3>{connection.name}</h3>
            <p>{providerLabel(connection.provider)}</p>
            <div className="endpoint"><span>Endpoint</span><code>{connection.baseUrl}</code></div>
            <div className="connection-facts">
              <span><Bot size={14} /> {connection.models?.length ?? 0} available models</span>
              <span><Clock3 size={14} /> {connection.lastCheckedAt ? formatRelative(connection.lastCheckedAt) : "Never checked"}</span>
            </div>
            {connection.models && connection.models.length > 0 && <div className="model-preview">{connection.models.slice(0, 3).map((model) => <span key={model}>{model}</span>)}{connection.models.length > 3 && <span>+{connection.models.length - 3}</span>}</div>}
            {connection.modelHint && <div className="default-model"><span>Default model</span><strong>{connection.modelHint}</strong></div>}
            <div className="connection-actions">
              <button className="button button-secondary button-small" disabled={testingId === connection.id} onClick={() => void test(connection)}>{testingId === connection.id ? <LoaderCircle className="spinning" size={15} /> : discoveryDetails(connection.provider) ? <RefreshCw size={15} /> : <Wifi size={15} />} {connectionTestLabel(connection.provider)}</button>
              <button className="text-button" onClick={() => { setModalMessage(null); setEditing({ ...connection, apiKey: "" }); }}>Configure</button>
              <button className="icon-button small danger" onClick={() => void remove(connection)} aria-label="Delete connection"><Trash2 size={15} /></button>
            </div>
          </article>
        ))}
        <button className="add-card" onClick={() => { setModalMessage(null); setEditing({ ...emptyConnection }); }}><span><Plus size={24} /></span><strong>Add a model provider</strong><small>Ollama, OpenRouter, Kie.ai, OpenAI, Anthropic, Gemini, or a compatible API</small></button>
      </div>
      {editing && (
        <Modal title={editing.id ? "Configure connection" : "Add connection"} onClose={() => setEditing(null)}>
          <div className="modal-form">
            <label className="field"><span>Provider</span><select value={editing.provider} onChange={(event) => { const provider = event.target.value as ProviderKind; const models = provider === "kie" ? kieModelIds() : undefined; setModalMessage(null); setEditing({ ...editing, provider, baseUrl: defaultBaseUrl(provider), models, modelHint: models?.[0], status: "untested" }); }}>{providerOptions.map((option) => <option value={option.value} key={option.value}>{option.label} — {option.hint}</option>)}</select></label>
            <label className="field"><span>Connection name</span><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Research account" /></label>
            <label className="field"><span>Base URL</span><input value={editing.baseUrl} onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })} /></label>
            {editing.provider !== "ollama" && <label className="field"><span>API key {editing.id && <small>· leave blank to keep the current key</small>}</span><input type="password" value={editing.apiKey} onChange={(event) => setEditing({ ...editing, apiKey: event.target.value })} placeholder="Stored securely" autoComplete="off" /></label>}
            {discoveryDetails(editing.provider) && (
              <div className="provider-discovery">
                <div className="discovery-heading"><div className={`provider-discovery-mark ${editing.provider}`}><Bot size={18} /></div><div><strong>{discoveryDetails(editing.provider)?.title}</strong><span>{discoveryDetails(editing.provider)?.description}</span></div><button className="button button-secondary button-small" onClick={() => void scanEditingProvider()} disabled={scanningModal || !editing.baseUrl.trim() || (editing.provider !== "ollama" && !editing.id && !editing.apiKey.trim())}>{scanningModal ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />} {discoveryDetails(editing.provider)?.action}</button></div>
                {modalMessage && <p className={editing.status === "unavailable" ? "discovery-message error" : "discovery-message"}>{editing.status === "unavailable" ? <WifiOff size={14} /> : <CheckCircle2 size={14} />}{modalMessage}</p>}
                {editing.models && editing.models.length > 0 ? (
                  <label className="field"><span>Default model</span><select value={editing.modelHint ?? editing.models[0]} onChange={(event) => setEditing({ ...editing, modelHint: event.target.value })}>{editing.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
                ) : (
                  <div className="discovery-empty"><HardDrive size={16} /><span>{discoveryDetails(editing.provider)?.empty}</span></div>
                )}
              </div>
            )}
            <p className="form-note"><ShieldCheck size={15} /> Secrets are excluded from logs, results, exports, and catalog requests.</p>
            <div className="modal-actions"><button className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" onClick={() => void save()} disabled={!editing.name.trim() || !editing.baseUrl.trim()}>Save connection</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function SettingsPage({ sources, interfaceScale, onInterfaceScaleChange, onChange, onRefresh, checking, appUpdate, onCheckUpdate, onOpenUpdate }: {
  sources: CatalogSource[];
  interfaceScale: InterfaceScale;
  onInterfaceScaleChange: (scale: InterfaceScale) => void;
  onChange: (sources: CatalogSource[]) => void;
  onRefresh: () => void;
  checking: boolean;
  appUpdate: AppUpdateState;
  onCheckUpdate: () => void;
  onOpenUpdate: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [diagnosticConfig, setDiagnosticConfigState] = useState<DiagnosticConfig>(getDiagnosticConfig);
  const [diagnosticCount, setDiagnosticCount] = useState(() => getDiagnosticEntries().length);
  useEffect(() => subscribeToDiagnostics(() => {
    setDiagnosticConfigState(getDiagnosticConfig());
    setDiagnosticCount(getDiagnosticEntries().length);
  }), []);
  const updateDiagnostics = (config: DiagnosticConfig) => {
    setDiagnosticConfig(config);
    setDiagnosticConfigState(config);
  };
  const add = () => {
    if (!name.trim() || !url.trim()) return;
    onChange([...sources, { id: crypto.randomUUID(), name: name.trim(), url: url.trim(), official: false, enabled: true }]);
    setName(""); setUrl(""); setAdding(false);
  };
  return (
    <>
      <PageTitle eyebrow="Preferences" title="Settings & sources" description="Control community catalogs, privacy defaults, and application behavior." />
      <div className="settings-layout">
        <div className="settings-nav panel"><button className="active" onClick={() => document.getElementById("appearance-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Settings size={17} /> Appearance</button><button onClick={() => document.getElementById("catalog-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })}><BookOpen size={17} /> Catalog sources</button><button><ShieldCheck size={17} /> Privacy</button><button onClick={() => document.getElementById("diagnostics-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Activity size={17} /> Diagnostics</button><button><SlidersHorizontal size={17} /> Evaluation defaults</button><button onClick={() => document.getElementById("update-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Download size={17} /> Updates</button></div>
        <div className="settings-main">
          <section className="panel settings-section" id="appearance-settings">
            <div className="panel-heading"><div><h3>Appearance</h3><p>Make the app easier to read independently of your system display settings.</p></div></div>
            <div className="setting-row">
              <div><strong>Text size</strong><span>{interfaceScaleOptions.find((option) => option.value === interfaceScale)?.description}</span></div>
              <select value={interfaceScale} onChange={(event) => onInterfaceScaleChange(event.target.value as InterfaceScale)} aria-label="Text size">
                {interfaceScaleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </section>
          <section className="panel settings-section" id="catalog-settings">
            <div className="panel-heading"><div><h3>Test catalog sources</h3><p>AI4H checks enabled sources on launch. Third-party catalogs are visibly labeled.</p></div><button className="button button-secondary button-small" onClick={() => setAdding(true)}><Plus size={15} /> Add source</button></div>
            <div className="source-list">
              <div className="source-row builtin"><div className="source-icon"><HardDrive size={17} /></div><div><strong>Bundled starter catalog</strong><span>Ships with the app · always available offline</span></div><span className="status-chip success">Trusted</span><span className="toggle on"><i /></span></div>
              {sources.map((source) => (
                <div className="source-row" key={source.id}>
                  <div className="source-icon"><Github size={17} /></div>
                  <div><strong>{source.name} {source.official && <ShieldCheck size={14} />}</strong><span>{source.url}</span>{source.error && <small>{source.error}</small>}</div>
                  <span className={`status-chip ${source.status === "error" ? "fail" : source.official ? "success" : "review"}`}>{source.status === "error" ? "Unavailable" : source.official ? "Official" : "Third party"}</span>
                  <button className={`toggle ${source.enabled ? "on" : ""}`} onClick={() => onChange(sources.map((item) => item.id === source.id ? { ...item, enabled: !item.enabled } : item))}><i /></button>
                  {!source.official && <button className="icon-button small danger" onClick={() => onChange(sources.filter((item) => item.id !== source.id))}><Trash2 size={15} /></button>}
                </div>
              ))}
            </div>
            <div className="catalog-actions"><button className="button button-secondary" onClick={onRefresh} disabled={checking}><RefreshCw className={checking ? "spinning" : ""} size={16} /> Check all sources now</button><span>Only declarative catalog JSON is accepted; downloaded code is never executed.</span></div>
          </section>
          <section className="panel settings-section">
            <div className="panel-heading"><div><h3>Research identity</h3><p>Published exports identify the evaluated provider and model.</p></div></div>
            <div className="setting-row"><div><strong>Include model identity in exports</strong><span>Provider, connection label, exact model ID, and timestamps</span></div><span className="toggle on"><i /></span></div>
            <div className="setting-row"><div><strong>Usage analytics</strong><span>AI4H does not collect product telemetry</span></div><span className="toggle"><i /></span></div>
          </section>
          <section className="panel settings-section" id="diagnostics-settings">
            <div className="panel-heading"><div><h3>Diagnostics & logging</h3><p>Local, redacted records for connection troubleshooting. Prompts, responses, and credentials are never logged.</p></div><span className="status-chip review">{diagnosticCount} entries</span></div>
            <div className="setting-row">
              <div><strong>Logging level</strong><span>Network activity records request paths, status codes, timing, and safe error details</span></div>
              <select value={diagnosticConfig.level} onChange={(event) => updateDiagnostics({ ...diagnosticConfig, level: event.target.value as DiagnosticConfig["level"] })} aria-label="Diagnostic logging level">
                <option value="off">Off</option>
                <option value="error">Errors only</option>
                <option value="info">Network activity</option>
                <option value="debug">Debug</option>
              </select>
            </div>
            <div className="setting-row">
              <div><strong>Retention</strong><span>Old entries are removed automatically on this device</span></div>
              <select value={diagnosticConfig.maxEntries} onChange={(event) => updateDiagnostics({ ...diagnosticConfig, maxEntries: Number(event.target.value) as DiagnosticConfig["maxEntries"] })} aria-label="Diagnostic log retention">
                <option value="100">100 entries</option>
                <option value="500">500 entries</option>
                <option value="2000">2,000 entries</option>
              </select>
            </div>
            <div className="diagnostic-actions"><button className="button button-secondary" onClick={exportDiagnosticLog} disabled={!diagnosticCount}><Download size={16} /> Export diagnostic log</button><button className="button button-secondary" onClick={clearDiagnosticEntries} disabled={!diagnosticCount}><Trash2 size={16} /> Clear log</button><span>Query strings and key-like values are redacted before storage.</span></div>
          </section>
          <section className="panel settings-section" id="update-settings">
            <div className="panel-heading"><div><h3>Application updates</h3><p>Check the latest official release published by Safe AI for Humanity on GitHub.</p></div>{appUpdate.status === "available" ? <span className="status-chip review">Update available</span> : appUpdate.status === "current" ? <span className="status-chip success">Up to date</span> : null}</div>
            <div className="setting-row update-setting-row">
              <div><strong>Installed version</strong><span>AI4H Eval Lab v{appUpdate.currentVersion}</span></div>
              <div className="update-status-copy">
                {appUpdate.status === "idle" && <span>Not checked yet.</span>}
                {appUpdate.status === "checking" && <span>Checking GitHub Releases…</span>}
                {appUpdate.status === "current" && <span>You have the latest published version, {appUpdate.release.tagName}.</span>}
                {appUpdate.status === "available" && <span>{appUpdate.release.name} was published {new Date(appUpdate.release.publishedAt).toLocaleDateString()}.</span>}
                {appUpdate.status === "error" && <span className="update-error">{appUpdate.error}</span>}
              </div>
            </div>
            <div className="update-actions">
              <button className="button button-secondary" onClick={onCheckUpdate} disabled={appUpdate.status === "checking"}><RefreshCw className={appUpdate.status === "checking" ? "spinning" : ""} size={16} /> {appUpdate.status === "checking" ? "Checking…" : "Check for updates"}</button>
              {(appUpdate.status === "available" || appUpdate.status === "current") && <button className="button button-primary" onClick={onOpenUpdate}><ExternalLink size={16} /> {appUpdate.status === "available" ? "View latest release" : "Open release page"}</button>}
              <span>Updates are never downloaded or installed without your action.</span>
            </div>
          </section>
        </div>
      </div>
      {adding && <Modal title="Add third-party catalog" onClose={() => setAdding(false)}><div className="modal-form"><div className="warning-box"><AlertTriangle size={17} /><span>Third-party test content is not reviewed by AI4H. Inspect its authorship, license, methodology, and risk classification before drawing conclusions.</span></div><label className="field"><span>Source name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Community safety benchmarks" /></label><label className="field"><span>Catalog JSON URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.org/catalog.json" /></label><div className="modal-actions"><button className="button button-secondary" onClick={() => setAdding(false)}>Cancel</button><button className="button button-primary" onClick={add} disabled={!name.trim() || !url.trim()}>Add source</button></div></div></Modal>}
    </>
  );
}

function Modal({ title, children, onClose, closeDisabled = false, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; closeDisabled?: boolean; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!closeDisabled && event.target === event.currentTarget) onClose(); }}><div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} disabled={closeDisabled} aria-label="Close"><X size={19} /></button></div>{children}</div></div>;
}

function exportRun(run: EvaluationRun) {
  downloadJson({ schemaVersion: 1, exportedAt: new Date().toISOString(), organization: "Safe AI for Humanity Foundation", run }, `ai4h-evaluation-${run.id}.json`);
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function exportDiagnosticLog() {
  const blob = new Blob([JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    application: "AI4H Eval Lab",
    config: getDiagnosticConfig(),
    entries: getDiagnosticEntries()
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ai4h-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatRelative(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "Just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatEvaluatorCriteria(evaluator: Evaluator): string {
  if (evaluator.type === "contains_any") return `Automatic phrase indicator · expects any of: ${evaluator.values.map((value) => `“${value}”`).join(", ")}`;
  if (evaluator.type === "contains_none") return `Automatic exclusion indicator · expects none of: ${evaluator.values.map((value) => `“${value}”`).join(", ")}`;
  if (evaluator.type === "regex") return `Automatic pattern · /${evaluator.pattern}/${evaluator.flags ?? ""}`;
  if (evaluator.type === "non_empty") return `Automatic length check · at least ${evaluator.minimumCharacters ?? 1} characters`;
  if (evaluator.type === "valid_json") return "Automatic structure check · response must be valid JSON";
  return `Human review rubric · ${evaluator.rubric}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export default App;

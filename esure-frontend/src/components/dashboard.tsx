"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, getRun, listScenarios, startRun, type RunReport, type ScenarioSummary } from "@/lib/api";

const terminalStatuses = new Set(["passed", "failed"]);

export function Dashboard() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [run, setRun] = useState<RunReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listScenarios(controller.signal)
      .then((items) => {
        setScenarios(items);
        setSelectedId(items[0]?.id ?? "");
      })
      .catch((reason: unknown) => setError(readError(reason)))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!run || terminalStatuses.has(run.status)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      getRun(run.id, controller.signal)
        .then(setRun)
        .catch((reason: unknown) => {
          if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(readError(reason));
        });
    }, 1_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [run?.id, run?.status]);

  const selected = useMemo(() => scenarios.find((scenario) => scenario.id === selectedId), [scenarios, selectedId]);

  async function handleRun() {
    if (!selectedId) return;
    setStarting(true);
    setError(null);
    setRun(null);
    try {
      setRun(await startRun(selectedId));
    } catch (reason) {
      setError(readError(reason));
    } finally {
      setStarting(false);
    }
  }

  return (
    <main>
      <header className="topbar shell">
        <a className="brand" href="#top" aria-label="Esure home">
          <img className="brand-mark" src="/esure-mark.svg" width="38" height="38" alt="" aria-hidden="true" />
          <span>esure</span>
        </a>
        <a className="docs-link" href="https://developers.stellar.org" target="_blank" rel="noreferrer">Docs <ArrowIcon /></a>
      </header>

      <section className="hero shell" id="top">
        <div>
          <p className="eyebrow">PAYMENT SCENARIO LAB</p>
          <h1>Know it works<br /><span>before it ships.</span></h1>
          <p className="lede">Run repeatable Stellar payment flows on Testnet. See every operation, ledger confirmation, and assertion in one readable report.</p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="scene-glow" />
          <div className="scene-grid" />
          <div className="orbit-stage">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <span className="orbit-core"><span className="core-pulse" /><img src="/esure-mark.svg" width="66" height="66" alt="" /></span>
            <i className="satellite one" />
            <i className="satellite two" />
            <i className="satellite three" />
          </div>
          <div className="signal-card transaction-card"><span className="signal-icon">↗</span><span><b>Payment sent</b><small>100 TESTUSD</small></span></div>
          <div className="signal-card ledger-card"><span className="signal-dot" /><span><b>Ledger closed</b><small>3.4 seconds</small></span></div>
          <div className="verified-chip"><CheckIcon /> VERIFIED</div>
        </div>
      </section>

      <section className="workspace shell">
        <div className="section-heading">
          <div><p className="eyebrow">01 / CHOOSE A FLOW</p><h2>Test scenarios</h2></div>
          <span className="scenario-count">{scenarios.length.toString().padStart(2, "0")} AVAILABLE</span>
        </div>

        {error && <div className="error-banner" role="alert"><WarningIcon /><div><strong>Couldn&apos;t complete the request</strong><span>{error}</span></div></div>}

        <div className="scenario-grid" aria-busy={loading}>
          {loading ? [1, 2, 3].map((item) => <div className="scenario-card skeleton" key={item} />) : scenarios.map((scenario, index) => (
            <button
              type="button"
              className={`scenario-card ${selectedId === scenario.id ? "selected" : ""}`}
              key={scenario.id}
              onClick={() => setSelectedId(scenario.id)}
            >
              <span className="card-index">0{index + 1}</span>
              <ScenarioIcon kind={scenario.id} />
              <span className="scenario-name">{scenario.name}</span>
              <span className="scenario-description">{scenario.description}</span>
              <span className="version">V{scenario.version}</span>
            </button>
          ))}
        </div>

        <div className="launch-panel">
          <div><span className="label">SELECTED SCENARIO</span><strong>{selected?.name ?? "Choose a scenario"}</strong><span>{selected?.id ?? "—"}</span></div>
          <button className="run-button" type="button" disabled={!selected || starting || (!!run && !terminalStatuses.has(run.status))} onClick={handleRun}>
            {starting ? "Starting…" : run && !terminalStatuses.has(run.status) ? "Running…" : "Run on Testnet"}<PlayIcon />
          </button>
        </div>
      </section>

      <section className="results shell">
        <div className="section-heading">
          <div><p className="eyebrow">02 / INSPECT THE RUN</p><h2>Execution report</h2></div>
          {run && <StatusBadge status={run.status} />}
        </div>
        {!run ? <EmptyReport /> : <RunView run={run} />}
      </section>

      <footer className="shell"><span>ESURE / TEST WITH CONFIDENCE</span><span>BUILT FOR STELLAR</span></footer>
    </main>
  );
}

function RunView({ run }: { run: RunReport }) {
  const pending = !terminalStatuses.has(run.status);
  return (
    <div className="report-grid">
      <div className="timeline-card">
        <div className="report-meta"><span>RUN ID</span><div className="id-cell"><code>{run.id}</code><CopyButton value={run.id} label="run ID" /></div><span>NETWORK</span><code>{run.network}</code></div>
        {pending && <div className="running-row"><span className="spinner" /><div><strong>{titleCase(run.status)}</strong><span>Esure is executing this flow on Stellar Testnet.</span></div></div>}
        {run.steps.map((step, index) => (
          <div className="timeline-row" key={step.id}>
            <span className={`step-dot ${step.status}`}><CheckIcon /></span>
            <div><span className="label">STEP {String(index + 1).padStart(2, "0")} / {step.type}</span><strong>{humanize(step.id)}</strong><p>{step.message}</p>{step.transactionHash && <div className="tx-actions"><a href={`https://stellar.expert/explorer/testnet/tx/${step.transactionHash}`} target="_blank" rel="noreferrer">View transaction <ArrowIcon /></a><CopyButton value={step.transactionHash} label={`transaction ${step.transactionHash}`} /></div>}</div>
            {step.ledger && <code className="ledger">L#{step.ledger}</code>}
          </div>
        ))}
        {run.assertions.map((assertion, index) => (
          <div className="assertion" key={`${assertion.type}-${index}`}><span className={`step-dot ${assertion.status}`}><CheckIcon /></span><div><span className="label">ASSERTION / {assertion.type}</span><strong>{assertion.message}</strong></div></div>
        ))}
        {run.error && <div className="run-error"><WarningIcon /><div><strong>{run.error.code}</strong><span>{run.error.message}</span></div></div>}
      </div>
      <aside className="summary-card">
        <p className="eyebrow">RUN SUMMARY</p>
        <div className="score"><strong>{run.summary.stepsPassed + run.summary.assertionsPassed}</strong><span>checks passed</span></div>
        <dl><div><dt>Steps passed</dt><dd>{run.summary.stepsPassed}</dd></div><div><dt>Steps failed</dt><dd>{run.summary.stepsFailed}</dd></div><div><dt>Assertions passed</dt><dd>{run.summary.assertionsPassed}</dd></div><div><dt>Assertions failed</dt><dd>{run.summary.assertionsFailed}</dd></div></dl>
        {terminalStatuses.has(run.status) && <a className="download" href={`/api/backend/api/v1/runs/${run.id}/report`} download>Download JSON report <DownloadIcon /></a>}
      </aside>
    </div>
  );
}

function EmptyReport() {
  return <div className="empty-report"><div className="empty-glyph"><span /><span /><span /></div><strong>No run yet</strong><p>Select a scenario and run it to see each Stellar operation appear here.</p></div>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <span className="copy-control">
      <button type="button" className="copy-button" onClick={copy} aria-label={`Copy ${label}`}>
        {status === "copied" ? "Copied" : "Copy"}
      </button>
      {status === "copied" && <span role="status" className="copy-status">Copied {label}</span>}
      {status === "error" && <span role="status" className="copy-error">Could not copy {label}</span>}
    </span>
  );
}

function StatusBadge({ status }: { status: RunReport["status"] }) {
  return <span className={`status-badge ${status}`}><span />{titleCase(status)}</span>;
}

function ScenarioIcon({ kind }: { kind: string }) {
  if (kind === "xlm-payment") return <svg className="scenario-icon" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="13"/><path d="m13 24 16-9M12 19l16-9M14 30l14-8"/></svg>;
  if (kind === "issued-asset-payment") return <svg className="scenario-icon" viewBox="0 0 40 40" fill="none"><rect x="7" y="10" width="20" height="20" rx="3"/><path d="M13 16h8M13 21h8M13 26h5M30 15v12M26 23l4 4 4-4"/></svg>;
  return <svg className="scenario-icon" viewBox="0 0 40 40" fill="none"><path d="M20 6 35 33H5L20 6Z"/><path d="M20 15v9M20 28v1"/></svg>;
}

function PlayIcon() { return <svg viewBox="0 0 20 20" fill="none"><path d="m7 5 7 5-7 5V5Z"/></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 16 16" fill="none"><path d="M3 13 13 3M6 3h7v7"/></svg>; }
function DownloadIcon() { return <svg viewBox="0 0 20 20" fill="none"><path d="M10 3v10M6 9l4 4 4-4M4 17h12"/></svg>; }
function CheckIcon() { return <svg viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7"/></svg>; }
function WarningIcon() { return <svg viewBox="0 0 20 20" fill="none"><path d="M10 3 18 17H2L10 3ZM10 8v4M10 15v.1"/></svg>; }

function readError(reason: unknown): string {
  if (reason instanceof ApiError) return `${reason.message} (${reason.code})`;
  if (reason instanceof Error) return reason.message;
  return "An unexpected error occurred.";
}

function humanize(value: string): string { return value.split("-").map(titleCase).join(" "); }
function titleCase(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

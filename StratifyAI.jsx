import React, { useState, useRef, useEffect, useCallback, createContext, useContext } from "react";
import {
  Layers, Play, Square, Loader2, CheckCircle2, XCircle, Circle, ChevronDown, ChevronRight,
  Copy, Download, Printer, Send, ExternalLink, AlertTriangle, RefreshCw, FileText, TrendingUp,
  Users, LayoutGrid, Shield, DollarSign, Target, BookOpen, MessageSquare, Clock, List,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ScatterChart, Scatter,
  ZAxis, LabelList, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";

/* =========================================================================
   CONFIG
   ========================================================================= */
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;
const JSON_RULE = "Respond ONLY with valid JSON, no preamble, no markdown fences.";
const RETRY_MSG = "Your last reply was not valid JSON. Return only the JSON.";
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();
const ACCENT = "#4338ca";

const REPORT_TYPES = ["Industry Analysis", "Competitor Analysis", "Market Entry", "Business Idea Validation"];
const FOCUS_AREAS = [
  "Pricing", "Technology", "Regulation", "Distribution", "Customer experience",
  "Sustainability", "M&A and partnerships", "Supply chain", "Talent",
];
const DEFAULT_INPUT = {
  subject: "", reportType: "Industry Analysis", geography: "Global", horizon: 3,
  competitors: "", context: "", focus: [], depth: "quick",
};
const EXAMPLES = [
  { label: "Indian electric two-wheeler market", input: { ...DEFAULT_INPUT, subject: "Indian electric two-wheeler market", geography: "India", focus: ["Regulation", "Pricing", "Technology"] } },
  { label: "Netflix vs Disney+ vs Prime Video", input: { ...DEFAULT_INPUT, subject: "Subscription video streaming", reportType: "Competitor Analysis", competitors: "Netflix, Disney+, Amazon Prime Video", focus: ["Pricing", "Customer experience"] } },
  { label: "AI note-taker for law firms", input: { ...DEFAULT_INPUT, subject: "AI meeting note-taker built for mid-size law firms", reportType: "Business Idea Validation", geography: "United States", context: "Seed-stage startup, 4 engineers, 18 months runway.", focus: ["Pricing", "Regulation", "Distribution"] } },
  { label: "Plant-based protein entry into Germany", input: { ...DEFAULT_INPUT, subject: "Plant-based protein brand entering Germany", reportType: "Market Entry", geography: "Germany", horizon: 5, focus: ["Distribution", "Pricing", "Sustainability"] } },
];

const TABS = [
  { k: "summary", label: "Executive Summary", Icon: FileText },
  { k: "market", label: "Market & Trends", Icon: TrendingUp },
  { k: "competitors", label: "Competitors", Icon: Users },
  { k: "swot", label: "SWOT", Icon: LayoutGrid },
  { k: "porter", label: "Five Forces", Icon: Shield },
  { k: "financials", label: "Financials", Icon: DollarSign },
  { k: "strategy", label: "Strategy", Icon: Target },
  { k: "sources", label: "Sources", Icon: BookOpen },
];
const STAGE_TITLES = { 1: "Orchestrator", 2: "Research", 3: "Financial analysis", 4: "Strategy", 5: "Critic", 6: "Editor" };

const PRINT_CSS = `
.print-only{display:none}
@media print{
  .no-print{display:none!important}
  .print-only{display:block!important}
  .print-full{overflow:visible!important;max-height:none!important;height:auto!important;position:static!important}
  .print-avoid{break-inside:avoid}
  body{background:#fff!important}
  a{color:#1e1b4b!important}
}`;

/* =========================================================================
   PROMPTS
   ========================================================================= */
const ORCH_SYS = `You are the Orchestrator agent of StratifyAI, a strategy-consulting research pipeline. Convert the client brief into a focused research plan. Do not research; plan.
Return JSON with exactly this shape:
{"subject_summary":"one sentence framing what is analysed","research_questions":["4-6 specific, answerable questions"],"competitors":[{"name":"real company or substitute","rationale":"<=12 words"}],"assumptions":["3-4 key assumptions"],"search_hints":{"market":["2-3 web search queries"],"trends":["2-3"],"customer":["2-3"],"financial":["2-3"]},"positioning_axes":{"x":"short axis label, e.g. Price level","y":"short axis label, e.g. Breadth of offering"}}
Rules: If the brief names competitors, use exactly those. Otherwise propose the most relevant real competitors or substitutes, up to the stated maximum. Search queries must be specific and include geography and a recent year where useful. Choose positioning axes that best differentiate these competitors.`;

const researchRules = (n) => `Research rules:
- Use the web_search tool (up to ${n} searches). Prefer sources from the last 24 months; today is ${TODAY}. Put dates in details where relevant.
- source_urls must be copied exactly from search results you actually received. Never invent or guess URLs. Use [] if a point is your own inference.
- Never invent numbers. If a figure cannot be found, write "Not publicly available" and add it to gaps.
- Be terse: claims <= 15 words, details <= 30 words. The whole JSON must stay under 800 tokens.`;

const MARKET_SYS = `You are the Industry & Market Agent (sizing) of StratifyAI. Establish market size, growth rates and key segments for the brief.
Return JSON: {"findings":[{"claim":"","detail":"","source_urls":[]}],"market_size":[{"label":"e.g. Market size 2025","value":"e.g. USD 4.2B or 18% CAGR 2024-30","basis":"Reported|Estimated","source_urls":[]}],"series":{"title":"what the numbers measure","unit":"e.g. USD B","points":[{"label":"2024","value":4.2}],"source_urls":[]},"gaps":[]}
Limits: 3-4 findings, 2-4 market_size items. series.points: numeric values taken from sources, one consistent unit, 2-6 points (sourced forecasts may be labelled like "2030F"). If no consistent sourced series exists, return "points":[].`;

const TRENDS_SYS = `You are the Industry & Market Agent (trends) of StratifyAI. Identify the trends, regulatory changes and technology shifts that will matter over the brief's time horizon.
Return JSON: {"findings":[{"claim":"","detail":"","source_urls":[]}],"trends":[{"trend":"<=10 words","detail":"<=25 words","impact":"High|Medium|Low","type":"Technology|Regulation|Consumer|Economic|Competitive","source_urls":[]}],"gaps":[]}
Limits: 2-3 findings, 4-6 trends ordered by impact.`;

const CUSTOMER_SYS = `You are the Customer & Demand Agent of StratifyAI. Identify customer segments, their needs, buying criteria and pain points.
Return JSON: {"findings":[{"claim":"","detail":"","source_urls":[]}],"segments":[{"name":"<=6 words","needs":"<=15 words","buying_criteria":"<=15 words","pain_points":"<=15 words","source_urls":[]}],"gaps":[]}
Limits: 2-3 findings, 3-4 segments.`;

const compSys = (name, axes) => `You are the Competitor Agent of StratifyAI. Profile exactly one competitor: ${name}.
Positioning axes used to compare all competitors: X = "${axes.x}", Y = "${axes.y}". Score this competitor 1-10 on each, relative to the market (an analyst judgment informed by evidence).
Return JSON: {"name":"${name}","positioning":"","offerings":"","pricing":"","market_position":"share, scale, funding or valuation","strengths":["2-3 items, <=10 words each"],"weaknesses":["2-3 items"],"recent_moves":["2-3 dated moves from the last 24 months"],"x_score":5,"y_score":5,"findings":[{"claim":"","detail":"","source_urls":[]}],"gaps":[]}
Profile text fields <= 15 words each. Use "Not publicly available" where needed. 2-3 findings that back the profile.`;

const FIN_SYS = `You are the Financial Analysis Agent of StratifyAI. Gather revenue and market-size figures, growth rates, margins, funding, valuation multiples and unit-economics benchmarks relevant to the brief and its competitors.
Return JSON: {"metrics":[{"metric":"e.g. Revenue","entity":"company or market","value":"e.g. USD 39.0B, or Not publicly available","period":"e.g. FY2025","label":"Reported|Estimated|Unavailable","source_urls":[]}],"findings":[{"claim":"","detail":"","source_urls":[]}],"gaps":[]}
Limits: 6-9 metrics, at most 2 findings. Label "Reported" only when a cited source states the figure as reported/filed; "Estimated" for third-party or analyst estimates; "Unavailable" when not found (value "Not publicly available", source_urls []). Never invent numbers.`;

const STRAT_RULES = `Work only from the evidence pack provided; do not present outside facts as verified. Cite evidence with source_ids: integers taken from the [S#] tags (e.g. [S3] -> 3). If a point rests on reasoning rather than cited evidence, use []. Be concise and decision-oriented. The JSON must stay under 850 tokens.`;

const SWOT_SYS = `You are the SWOT Agent of StratifyAI. Build a SWOT from the client's perspective if client context is given, otherwise from the subject's perspective.
Return JSON: {"perspective":"whose SWOT, <=8 words","strengths":[{"point":"<=14 words","evidence":"<=20 words","source_ids":[]}],"weaknesses":[],"opportunities":[],"threats":[]}
3-4 items per quadrant, same item shape. ${STRAT_RULES}`;

const PORTER_SYS = `You are the Porter's Five Forces Agent of StratifyAI.
Return JSON: {"forces":[{"force":"Competitive rivalry|Threat of new entrants|Supplier power|Buyer power|Threat of substitutes","rating":"Low|Medium|High","rationale":"exactly 2 sentences","source_ids":[]}],"attractiveness":6,"attractiveness_rationale":"<=25 words"}
Exactly 5 forces in that order. attractiveness is an integer 1-10 (10 = most attractive industry). ${STRAT_RULES}`;

const RECS_SYS = `You are the Recommendation Agent of StratifyAI. Produce prioritized strategic recommendations for the client (or for a new entrant/the subject if no client context).
Return JSON: {"recommendations":[{"action":"<=12 words, imperative","rationale":"<=20 words","impact":"High|Medium|Low","effort":"High|Medium|Low","risk":"<=12 words","timeframe":"e.g. 0-6 months","kpi":"<=12 words, measurable","priority":"Now|Next|Later","source_ids":[]}]}
5-6 recommendations ordered by priority; include at least one Now, one Next and one Later. Fit timeframes to the brief's horizon. ${STRAT_RULES}`;

const CRITIC_SYS = `You are the Critic Agent of StratifyAI. Review the evidence pack and the analysis for unsupported claims, contradictions, stale or thin evidence, and missing data.
Return JSON: {"confidence":{"market":0,"competitors":0,"financials":0,"swot":0,"porter":0,"strategy":0},"overall":0,"caveats":[{"section":"market|competitors|financials|swot|porter|strategy|summary","issue":"<=22 words","severity":"High|Medium|Low"}]}
Scores are integers 0-100 reflecting evidence strength: many recent, cited, consistent sources = high; inference-heavy or contradictory = low; missing section = 0. 4-8 caveats, most material first.`;

const EDITOR_SYS = `You are the Editor Agent of StratifyAI, writing for a CEO. Use the evidence, analysis and critic review provided.
Return JSON: {"verdict":"one decisive line, <=20 words","executive_summary":"max 150 words, specific, no filler","takeaways":[{"text":"<=22 words","source_ids":[]}]}
Exactly 3 takeaways. Reflect the critic's main caveats honestly. Cite with integers from the [S#] tags; [] if inference.`;

const QA_SYS = `You are "Ask StratifyAI", a strategy analyst answering follow-up questions about an existing report. Answer from the report context first. Use web_search only if the report cannot answer the question. Cite report sources with source_ids (integers from [S#] tags) and any new web sources with source_urls copied exactly from search results. Never invent numbers or URLs; say when something is not publicly available.
Return JSON: {"answer":"<=180 words, executive tone","source_ids":[],"source_urls":[]}`;

/* =========================================================================
   API LAYER
   ========================================================================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function urlKey(u) {
  try {
    const x = new URL(String(u).trim());
    if (!/^https?:$/.test(x.protocol)) return null;
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
  } catch { return null; }
}

function extractJson(text) {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const end = t.lastIndexOf("}");
  let start = t.indexOf("{");
  for (let tries = 0; start !== -1 && start < end && tries < 6; tries++) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { start = t.indexOf("{", start + 1); }
  }
  return null;
}

/** Extract by block type, never by position. */
function parseBlocks(content) {
  const texts = [], sources = [], queries = [];
  for (const b of content || []) {
    if (b.type === "text") {
      texts.push(b.text || "");
      (b.citations || []).forEach((c) => { if (c.url) sources.push({ url: c.url, title: c.title || "" }); });
    } else if (b.type === "server_tool_use" && b.input?.query) {
      queries.push(b.input.query);
    } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      b.content.forEach((r) => { if (r.url) sources.push({ url: r.url, title: r.title || "", date: r.page_age || "" }); });
    }
  }
  return { text: texts.join(""), sources, queries };
}

async function postWithRetry(body, signal) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.type === "error") throw new Error(data.error?.message || "API error");
      return data;
    }
    const txt = await res.text().catch(() => "");
    lastErr = new Error(`API ${res.status}${txt ? ": " + txt.slice(0, 160) : ""}`);
    if ([429, 500, 502, 503, 529].includes(res.status) && attempt < 2) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

async function callClaude({ system, messages, search = false, maxUses = 3, signal, timeoutMs }) {
  const limit = timeoutMs ?? (search ? 150000 : 90000);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, limit);
  const relay = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener("abort", relay); }
  try {
    let msgs = messages;
    const all = [];
    for (let turn = 0; turn < 3; turn++) {
      const body = { model: MODEL, max_tokens: MAX_TOKENS, system, messages: msgs };
      if (search) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }];
      const data = await postWithRetry(body, ctrl.signal);
      all.push(...(data.content || []));
      if (data.stop_reason === "pause_turn") {
        msgs = [...msgs, { role: "assistant", content: data.content }];
        continue;
      }
      break;
    }
    return parseBlocks(all);
  } catch (e) {
    if (timedOut) throw new Error(`Timed out after ${Math.round(limit / 1000)}s`);
    if (signal?.aborted) throw new Error("Stopped by user");
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

/** One JSON-returning agent call with a single parse-repair retry. */
async function askJSON(ctx, { system, user, search = false, maxUses = 3, hints = [] }) {
  const sys = `${system}\n\n${JSON_RULE}`;
  let rotate = null;
  if (search) {
    const list = hints.length ? hints : ["the web"];
    let i = 0;
    ctx.status(`Searching: ${list[0]}`);
    rotate = setInterval(() => { i = (i + 1) % list.length; ctx.status(`Searching: ${list[i]}`); }, 3500);
  }
  try {
    const r1 = await callClaude({ system: sys, messages: [{ role: "user", content: user }], search, maxUses, signal: ctx.signal });
    if (rotate) { clearInterval(rotate); rotate = null; }
    ctx.log(r1);
    let data = extractJson(r1.text);
    if (!data) {
      ctx.status("Reply was not valid JSON; requesting a clean retry");
      const r2 = await callClaude({
        system: sys,
        messages: [
          { role: "user", content: user },
          { role: "assistant", content: r1.text.trim() || "(no output)" },
          { role: "user", content: `${RETRY_MSG} Keep it compact so it fits well under 900 tokens.` },
        ],
        signal: ctx.signal,
      });
      data = extractJson(r2.text);
      if (!data) throw new Error("Agent returned invalid JSON twice");
    }
    return data;
  } finally {
    if (rotate) clearInterval(rotate);
  }
}

function briefText(inp) {
  return [
    `Subject: ${inp.subject}`,
    `Report type: ${inp.reportType}`,
    `Geography: ${inp.geography || "Global"}`,
    `Time horizon: ${inp.horizon} years`,
    inp.competitors?.trim() && `Named competitors: ${inp.competitors.trim()}`,
    inp.context?.trim() && `Client context and goals: ${inp.context.trim()}`,
    inp.focus?.length && `Focus areas: ${inp.focus.join(", ")}`,
    `Today's date: ${TODAY}`,
  ].filter(Boolean).join("\n");
}
const parseList = (s) => (s || "").split(/,|\n|;|\bvs\.?(?=\s)/i).map((x) => x.trim()).filter(Boolean);
const arr = (x) => (Array.isArray(x) ? x : []);
const uniq = (a) => [...new Set(a)];

/* =========================================================================
   SMALL UI PRIMITIVES
   ========================================================================= */
const ReportCtx = createContext({ sources: [], onCite: () => {}, critic: null });

function Logo({ size = "text-xl", icon = 22 }) {
  return (
    <div className="flex items-center gap-2">
      <Layers size={icon} color={ACCENT} aria-hidden="true" />
      <span className={`${size} tracking-tight text-slate-900`}>
        <span className="font-bold">Stratify</span><span className="font-bold text-indigo-700">AI</span>
      </span>
    </div>
  );
}

function Cites({ ids, showInference = true }) {
  const { sources, onCite } = useContext(ReportCtx);
  const valid = uniq(arr(ids)).filter((i) => sources[i - 1]);
  if (!valid.length) {
    return showInference ? (
      <span className="ml-1 inline-block rounded bg-slate-100 px-1.5 text-xs italic text-slate-500 align-middle">Analyst inference</span>
    ) : null;
  }
  return (
    <span className="ml-1 inline-flex flex-wrap gap-0.5 align-middle">
      {valid.map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onCite(i)}
          title={sources[i - 1].title}
          aria-label={`Source ${i}: ${sources[i - 1].title}`}
          className="rounded bg-indigo-50 px-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          [{i}]
        </button>
      ))}
    </span>
  );
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    indigo: "bg-indigo-50 text-indigo-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    red: "bg-rose-50 text-rose-700",
    sky: "bg-sky-50 text-sky-700",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone] || tones.slate}`}>{children}</span>;
}
const levelTone = (v, invert = false) => {
  const s = String(v || "").toLowerCase();
  if (s.startsWith("high")) return invert ? "green" : "red";
  if (s.startsWith("med")) return "amber";
  if (s.startsWith("low")) return invert ? "red" : "green";
  return "slate";
};

function ConfidenceBadge({ score }) {
  if (typeof score !== "number") return null;
  const tone = score >= 75 ? "green" : score >= 50 ? "amber" : "red";
  return <Badge tone={tone}>Confidence {Math.round(score)}/100</Badge>;
}

function Skeleton({ lines = 4 }) {
  return (
    <div className="animate-pulse space-y-3" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-4 rounded bg-slate-200 ${i % 3 === 2 ? "w-2/3" : i % 2 ? "w-5/6" : "w-full"}`} />
      ))}
    </div>
  );
}

function Gauge({ value, max = 10 }) {
  const v = Math.max(0, Math.min(max, Number(value) || 0));
  const pct = v / max;
  const angle = Math.PI * (1 - pct);
  const x = 70 + 60 * Math.cos(angle);
  const y = 70 - 60 * Math.sin(angle);
  return (
    <svg viewBox="0 0 140 84" className="w-40" role="img" aria-label={`Industry attractiveness ${v} out of ${max}`}>
      <path d="M10 70 A60 60 0 0 1 130 70" stroke="#e2e8f0" strokeWidth="12" fill="none" strokeLinecap="round" />
      {pct > 0 && <path d={`M10 70 A60 60 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} stroke={ACCENT} strokeWidth="12" fill="none" strokeLinecap="round" />}
      <text x="70" y="64" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1e293b">{v}</text>
      <text x="70" y="80" textAnchor="middle" fontSize="9" fill="#64748b">out of {max}</text>
    </svg>
  );
}

function Meter({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const color = v >= 75 ? "bg-emerald-500" : v >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-bold text-slate-900">{Math.round(v)}</span>
        <span className="text-xs text-slate-500">/ 100</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-slate-200" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label="Overall confidence">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function Card({ children, className = "" }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-4 print-avoid ${className}`}>{children}</div>;
}

function ScatterTip({ active, payload, axes }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow">
      <div className="font-semibold text-slate-900">{p.name}</div>
      <div className="text-slate-600">{axes.x}: {p.x}</div>
      <div className="text-slate-600">{axes.y}: {p.y}</div>
    </div>
  );
}

/* =========================================================================
   MAIN APP
   ========================================================================= */

const arrOf = (x) => (Array.isArray(x) ? x : []);

function ErrorCard({ a }) {
  const { retryAgent } = useContext(ReportCtx);
  return (
    <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm" role="alert">
      <span className="flex items-center gap-2 text-rose-800">
        <AlertTriangle size={16} aria-hidden="true" /> {a.label} failed: {a.error}
      </span>
      <button type="button" onClick={() => retryAgent(a.id)} disabled={a.status === "running"} className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500">
        <RefreshCw size={12} aria-hidden="true" /> Retry this agent
      </button>
    </div>
  );
}

/** Shows skeleton while an agent is pending, error + retry when failed, content when ready. */
function Gate({ ids, ready, lines = 4, children }) {
  const { agents, phase } = useContext(ReportCtx);
  const list = ids.map((i) => agents[i]).filter(Boolean);
  const failed = list.filter((a) => a.status === "failed");
  const pending = list.some((a) => a.status === "running" || (a.status === "idle" && phase === "running"));
  return (
    <>
      {failed.map((a) => <ErrorCard key={a.id} a={a} />)}
      {ready ? children : pending ? <Skeleton lines={lines} /> : !failed.length ? <p className="text-sm text-slate-500">Not available for this run.</p> : null}
    </>
  );
}

function Caveats({ k }) {
  const { critic } = useContext(ReportCtx);
  const items = arrOf(critic?.caveats).filter((c) => c.section === k);
  if (!items.length) return null;
  return (
    <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500">Risks & caveats ({items.length})</summary>
      <ul className="mt-2 space-y-1">
        {items.map((c, i) => (
          <li key={i} className="flex gap-2 text-amber-900"><Badge tone={levelTone(c.severity)}>{c.severity}</Badge><span>{c.issue}</span></li>
        ))}
      </ul>
    </details>
  );
}

function Section({ k, title, Icon, conf, children }) {
  const { sectionAgents, regenerate, isBusy } = useContext(ReportCtx);
  const ids = sectionAgents[k] || [];
  return (
    <section id={`sec-${k}`} aria-labelledby={`h-${k}`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <Icon size={20} color={ACCENT} aria-hidden="true" />
          <h2 id={`h-${k}`} className="text-lg font-semibold text-slate-900">{title}</h2>
          <ConfidenceBadge score={conf} />
        </div>
        {ids.length > 0 && (
          <button type="button" onClick={() => regenerate(ids)} disabled={isBusy(ids)} className="no-print inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <RefreshCw size={12} aria-hidden="true" /> Regenerate section
          </button>
        )}
      </div>
      {children}
      <Caveats k={k} />
    </section>
  );
}

function Findings({ items }) {
  if (!arrOf(items).length) return null;
  return (
    <ul className="space-y-2">
      {arrOf(items).map((f, i) => (
        <li key={i} className="text-sm text-slate-700"><span className="font-medium text-slate-900">{f.claim}</span>{f.detail ? ` ${f.detail}` : ""}<Cites ids={f.source_ids} /></li>
      ))}
    </ul>
  );
}

function Gaps({ items }) {
  if (!arrOf(items).length) return null;
  return <p className="text-xs text-slate-500"><span className="font-medium">Data gaps:</span> {[...new Set(arrOf(items))].join("; ")}</p>;
}

function StatusIcon({ s }) {
  if (s === "running") return <Loader2 size={18} className="flex-none animate-spin text-indigo-700" aria-label="Running" />;
  if (s === "done") return <CheckCircle2 size={18} className="flex-none text-emerald-600" aria-label="Done" />;
  if (s === "failed") return <XCircle size={18} className="flex-none text-rose-600" aria-label="Failed" />;
  return <Circle size={18} className="flex-none text-slate-300" aria-label="Idle" />;
}

function AgentRow({ a, now }) {
  const { sources, retryAgent } = useContext(ReportCtx);
  const secs = a.startedAt ? (((a.endedAt || now) - a.startedAt) / 1000).toFixed(1) : null;
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-3">
        <StatusIcon s={a.status} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900">{a.label}</div>
          <div className="truncate text-xs text-slate-500" title={a.status === "failed" ? a.error : a.statusLine}>{a.status === "failed" ? a.error : a.statusLine}</div>
        </div>
        {secs && <span className="flex flex-none items-center gap-1 text-xs tabular-nums text-slate-500"><Clock size={12} aria-hidden="true" />{secs}s</span>}
        {a.status === "failed" && (
          <button type="button" onClick={() => retryAgent(a.id)} className="flex-none rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500">Retry this agent</button>
        )}
      </div>
      {(a.log.queries.length > 0 || a.log.sources.length > 0) && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-slate-600 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">Agent log: {a.log.queries.length} queries, {a.log.sources.length} sources</summary>
          {a.log.queries.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-slate-600">{a.log.queries.map((q, i) => <li key={i}>Searched: "{q}"</li>)}</ul>
          )}
          {a.log.sources.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {a.log.sources.map((id) => sources[id - 1] && (
                <li key={id} className="truncate"><span className="font-semibold text-indigo-700">[{id}]</span> <a href={sources[id - 1].url} target="_blank" rel="noopener noreferrer" className="text-slate-700 underline decoration-slate-300 hover:text-indigo-700">{sources[id - 1].title}</a> <span className="text-slate-400">{sources[id - 1].domain}</span></li>
              ))}
            </ul>
          )}
        </details>
      )}
    </li>
  );
}

function Chips({ center = false, disabled, onPick }) {
  return (
    <div className={`flex flex-wrap gap-2 ${center ? "justify-center" : ""}`}>
      {EXAMPLES.map((ex) => (
        <button key={ex.label} type="button" disabled={disabled} onClick={() => onPick(ex.input)} className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">
          {ex.label}
        </button>
      ))}
    </div>
  );
}

export default function StratifyAI() {
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [touched, setTouched] = useState(false);
  const [runInput, setRunInput] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | running | done | stopped | error
  const [fatal, setFatal] = useState("");
  const [agents, setAgents] = useState({});
  const [order, setOrder] = useState([]);
  const [outputs, setOutputs] = useState({});
  const [sources, setSources] = useState([]);
  const [tab, setTab] = useState("summary");
  const [view, setView] = useState("tabs");
  const [highlight, setHighlight] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [qa, setQa] = useState([]);
  const [qaText, setQaText] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [printing, setPrinting] = useState(false);
  const [theaterOpen, setTheaterOpen] = useState(true);

  const outputsRef = useRef({});
  const registryRef = useRef({ list: [], byKey: new Map() });
  const defsRef = useRef({});
  const orderRef = useRef([]);
  const abortRef = useRef(null);
  const runInputRef = useRef(null);
  const phaseRef = useRef("idle");
  const tabRefs = useRef([]);

  const setPhaseBoth = (p) => { phaseRef.current = p; setPhase(p); };

  /* ---------- effects ---------- */
  useEffect(() => {
    document.title = runInput ? `StratifyAI · ${runInput.subject}` : "StratifyAI · From question to boardroom-ready strategy";
  }, [runInput]);

  const anyRunning = Object.values(agents).some((a) => a.status === "running");
  useEffect(() => {
    if (!anyRunning) return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [anyRunning]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!printing) return undefined;
    const t = setTimeout(() => { window.print(); setPrinting(false); }, 500);
    return () => clearTimeout(t);
  }, [printing]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---------- source registry ---------- */
  const registerSources = (list) => {
    const reg = registryRef.current;
    let changed = false;
    const ids = [];
    for (const s of list || []) {
      const k = urlKey(s.url);
      if (!k) continue;
      let id = reg.byKey.get(k);
      if (!id) {
        id = reg.list.length + 1;
        reg.list.push({ id, url: s.url, title: (s.title || domainOf(s.url)).trim(), domain: domainOf(s.url), date: s.date || "" });
        reg.byKey.set(k, id);
        changed = true;
      } else if (s.date && !reg.list[id - 1].date) {
        reg.list[id - 1].date = s.date;
        changed = true;
      }
      ids.push(id);
    }
    if (changed) setSources([...reg.list]);
    return uniq(ids);
  };
  const urlsToIds = (urls) => {
    const reg = registryRef.current;
    return uniq(arr(urls).map((u) => reg.byKey.get(urlKey(u))).filter(Boolean)); // unknown URLs are dropped, never fabricated
  };
  const validIds = (ids) => {
    const n = registryRef.current.list.length;
    return uniq(arr(ids).map((x) => parseInt(String(x).replace(/\D/g, ""), 10)).filter((i) => i >= 1 && i <= n));
  };
  /** Recursively converts source_urls -> source_ids and validates any source_ids. */
  const linkUrls = (obj) => {
    if (Array.isArray(obj)) return obj.map(linkUrls);
    if (obj && typeof obj === "object") {
      const out = {};
      let ids = [];
      let hasIds = false;
      for (const [k, v] of Object.entries(obj)) {
        if (k === "source_urls") { ids = ids.concat(urlsToIds(v)); hasIds = true; }
        else if (k === "source_ids") { ids = ids.concat(validIds(v)); hasIds = true; }
        else out[k] = linkUrls(v);
      }
      if (hasIds) out.source_ids = uniq(ids);
      return out;
    }
    return obj;
  };

  /* ---------- agent plumbing ---------- */
  const patchAgent = useCallback((id, patch) => {
    setAgents((prev) => {
      const a = prev[id];
      if (!a) return prev;
      const p = typeof patch === "function" ? patch(a) : patch;
      return { ...prev, [id]: { ...a, ...p } };
    });
  }, []);

  const makeCtx = (id, signal) => ({
    signal,
    status: (line) => patchAgent(id, { statusLine: line }),
    log: (r) => {
      const ids = registerSources(r.sources);
      patchAgent(id, (a) => ({
        log: { queries: uniq([...a.log.queries, ...r.queries]), sources: uniq([...a.log.sources, ...ids]) },
        statusLine: r.queries.length ? `Ran ${r.queries.length} searches, found ${ids.length} sources` : a.statusLine,
      }));
    },
  });

  const ensureController = () => {
    if (!abortRef.current || abortRef.current.signal.aborted) abortRef.current = new AbortController();
    return abortRef.current;
  };

  const runAgentById = async (id) => {
    const def = defsRef.current[id];
    const signal = abortRef.current?.signal;
    if (!def || !signal || signal.aborted) return null;
    patchAgent(id, { status: "running", startedAt: Date.now(), endedAt: null, error: null, statusLine: def.initialStatus || "Working", log: { queries: [], sources: [] } });
    try {
      const out = await def.run(makeCtx(id, signal));
      if (signal.aborted) throw new Error("Stopped by user");
      outputsRef.current = { ...outputsRef.current, [id]: out };
      setOutputs(outputsRef.current);
      patchAgent(id, (a) => ({ status: "done", endedAt: Date.now(), statusLine: a.log.queries.length ? a.statusLine : "Complete" }));
      return out;
    } catch (e) {
      patchAgent(id, { status: "failed", endedAt: Date.now(), error: e?.message || String(e), statusLine: "Failed" });
      return null;
    }
  };

  const compIds = () => orderRef.current.filter((id) => id.startsWith("comp_"));

  /* ---------- evidence pack passed to downstream agents ---------- */
  const evidencePack = (limit = 15000) => {
    const o = outputsRef.current;
    const L = [];
    const t = (ids) => (arr(ids).length ? ` [${ids.map((i) => "S" + i).join(",")}]` : " [inference]");
    const F = (list) => arr(list).forEach((x) => x && L.push(`- ${x.claim || ""}${x.detail ? ": " + x.detail : ""}${t(x.source_ids)}`));
    const gaps = [];
    if (o.market) {
      L.push("MARKET SIZE & GROWTH");
      arr(o.market.market_size).forEach((m) => L.push(`- ${m.label}: ${m.value} (${m.basis || "n/a"})${t(m.source_ids)}`));
      F(o.market.findings); gaps.push(...arr(o.market.gaps));
    }
    if (o.trends) {
      L.push("TRENDS, REGULATION, TECHNOLOGY");
      arr(o.trends.trends).forEach((x) => L.push(`- [${x.type || "Trend"}; impact ${x.impact || "n/a"}] ${x.trend}: ${x.detail || ""}${t(x.source_ids)}`));
      F(o.trends.findings); gaps.push(...arr(o.trends.gaps));
    }
    if (o.customer) {
      L.push("CUSTOMERS & DEMAND");
      arr(o.customer.segments).forEach((s) => L.push(`- Segment "${s.name}": needs ${s.needs}; buying criteria ${s.buying_criteria}; pain points ${s.pain_points}${t(s.source_ids)}`));
      F(o.customer.findings); gaps.push(...arr(o.customer.gaps));
    }
    compIds().forEach((id) => {
      const c = o[id];
      if (!c) return;
      L.push(`COMPETITOR: ${c.name || defsRef.current[id]?.compName}`);
      L.push(`- Positioning: ${c.positioning}; Offerings: ${c.offerings}; Pricing: ${c.pricing}; Market position: ${c.market_position}`);
      L.push(`- Strengths: ${arr(c.strengths).join("; ")} | Weaknesses: ${arr(c.weaknesses).join("; ")} | Recent moves: ${arr(c.recent_moves).join("; ")}`);
      F(c.findings); gaps.push(...arr(c.gaps));
    });
    if (o.financial) {
      L.push("FINANCIALS");
      arr(o.financial.metrics).forEach((m) => L.push(`- ${m.metric} (${m.entity}, ${m.period}): ${m.value} [${m.label}]${t(m.source_ids)}`));
      F(o.financial.findings); gaps.push(...arr(o.financial.gaps));
    }
    if (gaps.length) { L.push("DATA GAPS"); uniq(gaps).slice(0, 12).forEach((g) => L.push(`- ${g}`)); }
    return L.join("\n").slice(0, limit);
  };

  const analysisPack = () => {
    const o = outputsRef.current;
    return JSON.stringify({ swot: o.swot || null, porter: o.porter || null, recommendations: o.recs?.recommendations || null });
  };

  /* ---------- agent definitions ---------- */
  const defineDownstream = (plan, inp) => {
    const n = inp.depth === "deep" ? 5 : 2;
    const defs = defsRef.current;
    const hints = (k) => (arr(plan.search_hints?.[k]).filter(Boolean).length ? plan.search_hints[k] : [inp.subject]);
    const planText = `\n\nResearch questions:\n${arr(plan.research_questions).map((q) => "- " + q).join("\n")}`;

    const research = (system, hintKey, extra = "") => async (ctx) => {
      const h = hints(hintKey);
      const data = await askJSON(ctx, {
        system: `${system}\n\n${researchRules(n)}`,
        user: `BRIEF\n${briefText(inp)}${planText}\n\nSuggested searches: ${h.join(" | ")}${extra}`,
        search: true, maxUses: n, hints: h,
      });
      return linkUrls(data);
    };

    defs.market = { label: "Industry & Market: size and growth", stage: 2, initialStatus: "Preparing searches", run: research(MARKET_SYS, "market") };
    defs.trends = { label: "Industry & Market: trends and regulation", stage: 2, initialStatus: "Preparing searches", run: research(TRENDS_SYS, "trends") };
    defs.customer = { label: "Customer & Demand", stage: 2, initialStatus: "Preparing searches", run: research(CUSTOMER_SYS, "customer") };

    const axes = plan.positioning_axes;
    const cids = arr(plan.competitors).map((c, i) => {
      const id = `comp_${i}`;
      const h = [`${c.name} pricing ${inp.geography !== "Global" ? inp.geography : ""}`.trim(), `${c.name} news ${YEAR}`, `${c.name} market share revenue`];
      defs[id] = {
        label: `Competitor: ${c.name}`, stage: 2, compName: c.name, initialStatus: "Preparing searches",
        run: async (ctx) => {
          const data = await askJSON(ctx, {
            system: `${compSys(c.name, axes)}\n\n${researchRules(n)}`,
            user: `BRIEF\n${briefText(inp)}\n\nCompetitor to profile: ${c.name}${c.rationale ? ` (${c.rationale})` : ""}`,
            search: true, maxUses: n, hints: h,
          });
          const out = linkUrls(data);
          out.name = out.name || c.name;
          return out;
        },
      };
      return id;
    });

    defs.financial = {
      label: "Financial Analysis", stage: 3, initialStatus: "Preparing searches",
      run: async (ctx) => {
        const o = outputsRef.current;
        const known = arr(o.market?.market_size).map((m) => `${m.label}: ${m.value}`).join("; ") || "none yet";
        const names = cids.map((id) => defs[id].compName).join(", ");
        const h = hints("financial");
        const data = await askJSON(ctx, {
          system: `${FIN_SYS}\n\n${researchRules(n)}`,
          user: `BRIEF\n${briefText(inp)}\n\nCompetitors: ${names || "n/a"}\nMarket figures already found (do not repeat; add margins, funding, multiples, unit economics): ${known}\n\nSuggested searches: ${h.join(" | ")}`,
          search: true, maxUses: n, hints: h,
        });
        return linkUrls(data);
      },
    };

    const strategy = (system, label) => async (ctx) => {
      const ev = evidencePack();
      if (!ev.trim()) throw new Error("No research evidence available. Retry the research agents first.");
      ctx.status(`${label} from ${registryRef.current.list.length} sources`);
      return linkUrls(await askJSON(ctx, { system, user: `BRIEF\n${briefText(inp)}\n\nEVIDENCE PACK\n${ev}` }));
    };
    defs.swot = { label: "SWOT Agent", stage: 4, initialStatus: "Waiting for evidence", run: strategy(SWOT_SYS, "Synthesizing SWOT") };
    defs.porter = { label: "Porter's Five Forces Agent", stage: 4, initialStatus: "Waiting for evidence", run: strategy(PORTER_SYS, "Rating five forces") };
    defs.recs = { label: "Recommendation Agent", stage: 4, initialStatus: "Waiting for evidence", run: strategy(RECS_SYS, "Prioritizing moves") };

    defs.critic = {
      label: "Critic Agent", stage: 5, initialStatus: "Reviewing",
      run: async (ctx) => {
        ctx.status("Checking claims, contradictions and evidence gaps");
        return askJSON(ctx, { system: CRITIC_SYS, user: `BRIEF\n${briefText(inp)}\n\nEVIDENCE PACK\n${evidencePack(12000)}\n\nANALYSIS\n${analysisPack()}` });
      },
    };
    defs.editor = {
      label: "Editor Agent", stage: 6, initialStatus: "Drafting",
      run: async (ctx) => {
        ctx.status("Writing executive summary and verdict");
        const critic = outputsRef.current.critic ? JSON.stringify(outputsRef.current.critic) : "Critic unavailable";
        return linkUrls(await askJSON(ctx, { system: EDITOR_SYS, user: `BRIEF\n${briefText(inp)}\n\nEVIDENCE PACK\n${evidencePack(9000)}\n\nANALYSIS\n${analysisPack()}\n\nCRITIC REVIEW\n${critic}` }));
      },
    };

    const ids = ["market", "trends", "customer", ...cids, "financial", "swot", "porter", "recs", "critic", "editor"];
    orderRef.current = ["orchestrator", ...ids];
    setOrder(orderRef.current);
    setAgents((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = { id, label: defs[id].label, stage: defs[id].stage, status: "idle", statusLine: "Queued", log: { queries: [], sources: [] } }; });
      return next;
    });
  };

  const runStages = async (from) => {
    const sig = () => abortRef.current?.signal.aborted;
    if (from <= 2) await Promise.all(["market", "trends", "customer", ...compIds()].map(runAgentById));
    if (sig()) return;
    if (from <= 3) await runAgentById("financial");
    if (sig()) return;
    if (from <= 4) await Promise.all(["swot", "porter", "recs"].map(runAgentById));
    if (sig()) return;
    if (from <= 5) await runAgentById("critic");
    if (sig()) return;
    if (from <= 6) await runAgentById("editor");
  };

  /* ---------- run control ---------- */
  const startRun = async (inp) => {
    if (!inp.subject.trim()) { setTouched(true); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    outputsRef.current = {};
    registryRef.current = { list: [], byKey: new Map() };
    runInputRef.current = inp;
    setOutputs({}); setSources([]); setQa([]); setFatal(""); setHighlight(null);
    setRunInput(inp); setTab("summary"); setTheaterOpen(true); setPhaseBoth("running");

    const maxComps = inp.depth === "deep" ? 5 : 3;
    const named = parseList(inp.competitors);
    defsRef.current = {
      orchestrator: {
        label: "Orchestrator: research plan", stage: 1, initialStatus: "Framing research questions",
        run: async (ctx) => {
          const d = await askJSON(ctx, { system: ORCH_SYS, user: `BRIEF\n${briefText(inp)}\nMaximum competitors: ${maxComps}` });
          let comps = named.length ? named.map((name) => ({ name, rationale: "Named in brief" })) : arr(d.competitors).filter((c) => c?.name);
          comps = comps.slice(0, named.length ? 6 : maxComps);
          return {
            ...d,
            competitors: comps,
            research_questions: arr(d.research_questions),
            assumptions: arr(d.assumptions),
            search_hints: d.search_hints || {},
            positioning_axes: d.positioning_axes?.x && d.positioning_axes?.y ? d.positioning_axes : { x: "Price level", y: "Breadth of offering" },
          };
        },
      },
    };
    orderRef.current = ["orchestrator"];
    setOrder(["orchestrator"]);
    setAgents({ orchestrator: { id: "orchestrator", label: "Orchestrator: research plan", stage: 1, status: "idle", statusLine: "Queued", log: { queries: [], sources: [] } } });

    const plan = await runAgentById("orchestrator");
    if (ctrl.signal.aborted) return;
    if (!plan) {
      setFatal("The Orchestrator could not build a research plan. Check your connection and retry.");
      setPhaseBoth("error");
      return;
    }
    defineDownstream(plan, inp);
    await runStages(2);
    if (abortRef.current === ctrl && !ctrl.signal.aborted) { setPhaseBoth("done"); setTheaterOpen(false); }
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setPhaseBoth("stopped");
    setToast("Pipeline stopped. Partial results are kept.");
  };

  /** "Retry this agent": reruns the agent, then refreshes dependent synthesis if the pipeline already finished. */
  const retryAgent = async (id) => {
    if (id === "orchestrator") return startRun(runInputRef.current);
    ensureController();
    const out = await runAgentById(id);
    if (!out || phaseRef.current === "running") return;
    const st = defsRef.current[id]?.stage;
    if (st <= 3) await runStages(4);
    else if (st === 4) await runStages(5);
    else if (st === 5) await runStages(6);
  };

  /** "Regenerate section": reruns only the agents behind a section. */
  const regenerate = async (ids) => {
    ensureController();
    await Promise.all(ids.map(runAgentById));
    setToast("Section regenerated");
  };

  /* ---------- citations ---------- */
  const onCite = (id) => {
    setHighlight(id);
    if (view === "tabs") setTab("sources");
    setTimeout(() => document.getElementById(`src-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 3000);
  };

  /* ---------- Q&A ---------- */
  const reportContext = () => {
    const o = outputsRef.current;
    return `${evidencePack(9000)}\n\nANALYSIS\n${analysisPack()}\n\nEXECUTIVE SUMMARY\n${o.editor ? JSON.stringify(o.editor) : "n/a"}`.slice(0, 14000);
  };
  const ask = async () => {
    const q = qaText.trim();
    if (!q || qaBusy) return;
    const prior = qa.slice(-6).map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.text}`).join("\n");
    setQa((m) => [...m, { role: "user", text: q }]);
    setQaText("");
    setQaBusy(true);
    const ctx = { signal: undefined, status: () => {}, log: (r) => registerSources(r.sources) };
    try {
      const d = linkUrls(await askJSON(ctx, {
        system: QA_SYS,
        user: `BRIEF\n${briefText(runInputRef.current)}\n\nREPORT CONTEXT\n${reportContext()}\n\nPRIOR Q&A\n${prior || "none"}\n\nQUESTION\n${q}`,
        search: true, maxUses: 2,
      }));
      setQa((m) => [...m, { role: "assistant", text: d.answer || "No answer returned.", ids: d.source_ids || [] }]);
    } catch (e) {
      setQa((m) => [...m, { role: "assistant", text: `Could not answer: ${e.message}`, error: true }]);
    } finally {
      setQaBusy(false);
    }
  };

  /* ---------- export ---------- */
  const buildMarkdown = () => {
    const o = outputsRef.current;
    const inp = runInputRef.current;
    const reg = registryRef.current.list;
    const c = (ids) => (arr(ids).length ? arr(ids).map((i) => `[^${i}]`).join("") : " _(Analyst inference)_");
    const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const L = [];
    L.push(`# StratifyAI Strategy Report: ${inp.subject}`, "", "_From question to boardroom-ready strategy._", "");
    L.push(`**Report type:** ${inp.reportType} · **Geography:** ${inp.geography} · **Horizon:** ${inp.horizon} years · **Depth:** ${inp.depth} · **Generated:** ${TODAY}`, "");
    if (o.editor) {
      L.push("## Executive Summary", "", `**Verdict:** ${o.editor.verdict}`, "", o.editor.executive_summary || "", "", "**Key takeaways**", "");
      arr(o.editor.takeaways).forEach((t) => L.push(`- ${t.text}${c(t.source_ids)}`));
      L.push("");
    }
    if (o.critic) L.push(`**Overall confidence:** ${o.critic.overall}/100`, "");
    if (o.porter) L.push(`**Industry attractiveness:** ${o.porter.attractiveness}/10`, "");
    if (o.market || o.trends || o.customer) {
      L.push("## Market & Trends", "");
      arr(o.market?.market_size).forEach((m) => L.push(`- **${m.label}:** ${m.value} (${m.basis})${c(m.source_ids)}`));
      arr(o.market?.findings).forEach((f) => L.push(`- ${f.claim}: ${f.detail}${c(f.source_ids)}`));
      if (arr(o.trends?.trends).length) { L.push("", "### Trends", ""); o.trends.trends.forEach((t) => L.push(`- **${t.trend}** (${t.type}, impact ${t.impact}): ${t.detail}${c(t.source_ids)}`)); }
      if (arr(o.customer?.segments).length) { L.push("", "### Customer segments", ""); o.customer.segments.forEach((s) => L.push(`- **${s.name}:** needs ${s.needs}; criteria ${s.buying_criteria}; pain points ${s.pain_points}${c(s.source_ids)}`)); }
      L.push("");
    }
    const comps = compIds().map((id) => o[id]).filter(Boolean);
    if (comps.length) {
      L.push("## Competitors", "", `| Attribute | ${comps.map((x) => esc(x.name)).join(" | ")} |`, `|---|${comps.map(() => "---").join("|")}|`);
      [["Positioning", "positioning"], ["Offerings", "offerings"], ["Pricing", "pricing"], ["Market position", "market_position"]].forEach(([lab, k]) => L.push(`| ${lab} | ${comps.map((x) => esc(x[k])).join(" | ")} |`));
      [["Strengths", "strengths"], ["Weaknesses", "weaknesses"], ["Recent moves", "recent_moves"]].forEach(([lab, k]) => L.push(`| ${lab} | ${comps.map((x) => esc(arr(x[k]).join("; "))).join(" | ")} |`));
      L.push(`| Sources | ${comps.map((x) => c(uniq(arr(x.findings).flatMap((f) => arr(f.source_ids))))).join(" | ")} |`, "");
    }
    if (o.swot) {
      L.push(`## SWOT${o.swot.perspective ? ` (${o.swot.perspective})` : ""}`, "");
      ["strengths", "weaknesses", "opportunities", "threats"].forEach((q) => {
        L.push(`### ${q[0].toUpperCase() + q.slice(1)}`, "");
        arr(o.swot[q]).forEach((x) => L.push(`- **${x.point}** ${x.evidence || ""}${c(x.source_ids)}`));
        L.push("");
      });
    }
    if (o.porter) {
      L.push("## Porter's Five Forces", "");
      arr(o.porter.forces).forEach((f) => L.push(`- **${f.force}: ${f.rating}.** ${f.rationale}${c(f.source_ids)}`));
      L.push("", `Attractiveness ${o.porter.attractiveness}/10: ${o.porter.attractiveness_rationale || ""}`, "");
    }
    if (o.financial) {
      L.push("## Financials", "", "| Metric | Entity | Value | Period | Basis | Sources |", "|---|---|---|---|---|---|");
      arr(o.financial.metrics).forEach((m) => L.push(`| ${esc(m.metric)} | ${esc(m.entity)} | ${esc(m.value)} | ${esc(m.period)} | ${esc(m.label)} | ${c(m.source_ids)} |`));
      L.push("");
    }
    if (o.recs) {
      L.push("## Strategic Recommendations", "");
      ["Now", "Next", "Later"].forEach((p) => {
        const items = arr(o.recs.recommendations).filter((r) => r.priority === p);
        if (!items.length) return;
        L.push(`### ${p}`, "");
        items.forEach((r) => L.push(`- **${r.action}**${c(r.source_ids)}  \n  Rationale: ${r.rationale}  \n  Impact ${r.impact} · Effort ${r.effort} · Timeframe ${r.timeframe}  \n  Risk: ${r.risk}  \n  KPI: ${r.kpi}`));
        L.push("");
      });
    }
    if (arr(o.critic?.caveats).length) {
      L.push("## Risks & caveats", "");
      o.critic.caveats.forEach((cv) => L.push(`- [${cv.severity}] ${cv.section}: ${cv.issue}`));
      L.push("");
    }
    L.push("## Sources", "");
    reg.forEach((s) => L.push(`[^${s.id}]: [${s.title.replace(/[[\]]/g, "")}](${s.url}) (${s.domain}${s.date ? ", " + s.date : ""})`));
    L.push("", "---", "_Generated by StratifyAI_");
    return L.join("\n");
  };

  const copyMarkdown = async () => {
    const md = buildMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      setToast("Report copied as Markdown");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setToast("Report copied as Markdown"); } catch { setToast("Copy failed; use Download instead"); }
      document.body.removeChild(ta);
    }
  };
  const downloadMarkdown = () => {
    const blob = new Blob([buildMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stratifyai-${runInputRef.current.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const printReport = () => { setView("full"); setPrinting(true); };

  /* =======================================================================
     RENDER HELPERS
     ======================================================================= */
  const o = outputs;
  const critic = o.critic;
  const plan = o.orchestrator;
  const cIds = order.filter((id) => id.startsWith("comp_"));
  const SECTION_AGENTS = {
    summary: ["editor"], market: ["market", "trends", "customer"], competitors: cIds, swot: ["swot"],
    porter: ["porter"], financials: ["financial"], strategy: ["recs"], sources: [],
  };
  const isBusy = (ids) => phase === "running" || ids.some((id) => agents[id]?.status === "running");

  /* ---------- sections ---------- */
  const renderSummary = () => (
    <Section k="summary" title="Executive Summary" Icon={FileText} conf={critic?.overall}>
      <Gate ids={["editor"]} ready={!!o.editor} lines={6}>
        <div className="rounded-xl border-l-4 border-indigo-700 bg-indigo-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Verdict</div>
          <p className="mt-1 text-lg font-semibold text-slate-900">{o.editor?.verdict}</p>
        </div>
        <p className="text-sm leading-relaxed text-slate-700">{o.editor?.executive_summary}</p>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Key takeaways</h3>
          <ol className="space-y-2">
            {arr(o.editor?.takeaways).map((t, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-700 text-xs font-semibold text-white">{i + 1}</span>
                <span>{typeof t === "string" ? t : t.text}<Cites ids={t.source_ids} /></span>
              </li>
            ))}
          </ol>
        </div>
      </Gate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall confidence</div>
          <div className="mt-2">{critic ? <Meter value={critic.overall} /> : agents.critic?.status === "failed" ? <p className="text-sm text-slate-500">Critic unavailable</p> : <Skeleton lines={2} />}</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Industry attractiveness</div>
          <div className="mt-2 flex items-center gap-4">
            {o.porter ? (<><Gauge value={o.porter.attractiveness} /><p className="text-xs text-slate-600">{o.porter.attractiveness_rationale}</p></>) : agents.porter?.status === "failed" ? <p className="text-sm text-slate-500">Five Forces unavailable</p> : <Skeleton lines={2} />}
          </div>
        </Card>
      </div>
      {plan && (
        <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500">Scope, research questions and assumptions</summary>
          <p className="mt-2 text-slate-700">{plan.subject_summary}</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div><h4 className="font-medium text-slate-900">Research questions</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">{plan.research_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
            <div><h4 className="font-medium text-slate-900">Assumptions</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">{plan.assumptions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
          </div>
        </details>
      )}
    </Section>
  );

  const renderMarket = () => {
    const series = o.market?.series;
    const pts = arr(series?.points).map((p) => ({ label: String(p.label), value: typeof p.value === "number" ? p.value : Number(String(p.value).replace(/[^0-9.-]/g, "")) })).filter((p) => p.label && Number.isFinite(p.value));
    const chartOk = pts.length >= 2 && arr(series?.source_ids).length > 0;
    return (
      <Section k="market" title="Market & Trends" Icon={TrendingUp} conf={critic?.confidence?.market}>
        <Gate ids={["market"]} ready={!!o.market} lines={4}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {arr(o.market?.market_size).map((m, i) => (
              <Card key={i}>
                <div className="text-xs text-slate-500">{m.label}</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{m.value}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1"><Badge tone={m.basis === "Reported" ? "green" : "amber"}>{m.basis || "Unlabelled"}</Badge><Cites ids={m.source_ids} /></div>
              </Card>
            ))}
          </div>
          {chartOk ? (
            <Card>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{series.title} {series.unit ? `(${series.unit})` : ""}</h3>
                <Cites ids={series.source_ids} />
              </div>
              <div className="h-64" role="img" aria-label={`${series.title}: ${pts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#475569" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#475569" }} width={48} />
                    <Tooltip formatter={(v) => [`${v} ${series.unit || ""}`, series.title]} />
                    <Bar dataKey="value" fill={ACCENT} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : (
            <p className="text-xs italic text-slate-500">Chart omitted: no consistent, sourced numeric series was found.</p>
          )}
          <Findings items={o.market?.findings} />
          <Gaps items={o.market?.gaps} />
        </Gate>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Trends, regulation and technology shifts</h3>
          <Gate ids={["trends"]} ready={!!o.trends} lines={4}>
            <ul className="space-y-2">
              {arr(o.trends?.trends).map((t, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-3 print-avoid">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{t.trend}</span>
                    <Badge tone={levelTone(t.impact)}>Impact: {t.impact}</Badge>
                    {t.type && <Badge tone="indigo">{t.type}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{t.detail}<Cites ids={t.source_ids} /></p>
                </li>
              ))}
            </ul>
            <div className="mt-3"><Findings items={o.trends?.findings} /></div>
          </Gate>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Customer segments and demand</h3>
          <Gate ids={["customer"]} ready={!!o.customer} lines={4}>
            <div className="grid gap-3 md:grid-cols-2">
              {arr(o.customer?.segments).map((s, i) => (
                <Card key={i}>
                  <div className="font-medium text-slate-900">{s.name}<Cites ids={s.source_ids} /></div>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div><dt className="inline font-medium text-slate-600">Needs: </dt><dd className="inline text-slate-700">{s.needs}</dd></div>
                    <div><dt className="inline font-medium text-slate-600">Buying criteria: </dt><dd className="inline text-slate-700">{s.buying_criteria}</dd></div>
                    <div><dt className="inline font-medium text-slate-600">Pain points: </dt><dd className="inline text-slate-700">{s.pain_points}</dd></div>
                  </dl>
                </Card>
              ))}
            </div>
            <div className="mt-3"><Findings items={o.customer?.findings} /></div>
          </Gate>
        </div>
      </Section>
    );
  };

  const renderCompetitors = () => {
    const comps = cIds.map((id) => ({ id, d: o[id] })).filter((x) => x.d);
    const axes = plan?.positioning_axes || { x: "X", y: "Y" };
    const scatter = comps.map(({ d }) => ({ name: d.name, x: Number(d.x_score), y: Number(d.y_score) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const rows = [
      ["Positioning", (d) => d.positioning], ["Offerings", (d) => d.offerings], ["Pricing", (d) => d.pricing],
      ["Market position", (d) => d.market_position],
      ["Strengths", (d) => <ul className="list-disc pl-4">{arr(d.strengths).map((x, i) => <li key={i}>{x}</li>)}</ul>],
      ["Weaknesses", (d) => <ul className="list-disc pl-4">{arr(d.weaknesses).map((x, i) => <li key={i}>{x}</li>)}</ul>],
      ["Recent moves", (d) => <ul className="list-disc pl-4">{arr(d.recent_moves).map((x, i) => <li key={i}>{x}</li>)}</ul>],
      ["Evidence", (d) => <Cites ids={uniq(arr(d.findings).flatMap((f) => arr(f.source_ids)))} />],
    ];
    return (
      <Section k="competitors" title="Competitors" Icon={Users} conf={critic?.confidence?.competitors}>
        <Gate ids={cIds} ready={comps.length > 0} lines={6}>
          <div className="max-h-screen overflow-auto rounded-xl border border-slate-200 print-full">
            <table className="min-w-full border-collapse text-left text-sm">
              <caption className="sr-only">Side-by-side competitor comparison</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-20 border-b border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700">Attribute</th>
                  {comps.map(({ id, d }) => <th key={id} scope="col" style={{ minWidth: 192 }} className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-900">{d.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, fn]) => (
                  <tr key={label} className="align-top">
                    <th scope="row" className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2 font-medium text-slate-600">{label}</th>
                    {comps.map(({ id, d }) => <td key={id} className="border-b border-slate-100 px-3 py-2 text-slate-700">{fn(d) || "Not publicly available"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scatter.length >= 2 && (
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Positioning matrix</h3>
              <p className="mb-2 text-xs text-slate-500">Agent-assessed scores (1-10) informed by the evidence above; directional, not measured data.</p>
              <div className="h-80" role="img" aria-label={`Positioning matrix, ${axes.x} versus ${axes.y}: ${scatter.map((p) => `${p.name} (${p.x}, ${p.y})`).join("; ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 24, bottom: 28, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" dataKey="x" name={axes.x} domain={[0, 10]} tick={{ fontSize: 12, fill: "#475569" }} label={{ value: axes.x, position: "insideBottom", offset: -16, fontSize: 12, fill: "#334155" }} />
                    <YAxis type="number" dataKey="y" name={axes.y} domain={[0, 10]} tick={{ fontSize: 12, fill: "#475569" }} width={40} label={{ value: axes.y, angle: -90, position: "insideLeft", fontSize: 12, fill: "#334155" }} />
                    <ZAxis range={[120, 120]} />
                    <Tooltip content={<ScatterTip axes={axes} />} />
                    <Scatter data={scatter} fill={ACCENT}>
                      <LabelList dataKey="name" position="top" style={{ fontSize: 11, fill: "#1e293b" }} />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          <div className="space-y-3">
            {comps.map(({ id, d }) => arr(d.findings).length ? (
              <div key={id}><h3 className="mb-1 text-sm font-semibold text-slate-900">{d.name}: supporting evidence</h3><Findings items={d.findings} /></div>
            ) : null)}
          </div>
        </Gate>
      </Section>
    );
  };

  const renderSwot = () => {
    const Q = [
      ["strengths", "Strengths", "border-emerald-200 bg-emerald-50", "text-emerald-800"],
      ["weaknesses", "Weaknesses", "border-rose-200 bg-rose-50", "text-rose-800"],
      ["opportunities", "Opportunities", "border-sky-200 bg-sky-50", "text-sky-800"],
      ["threats", "Threats", "border-amber-200 bg-amber-50", "text-amber-800"],
    ];
    return (
      <Section k="swot" title={`SWOT${o.swot?.perspective ? `: ${o.swot.perspective}` : ""}`} Icon={LayoutGrid} conf={critic?.confidence?.swot}>
        <Gate ids={["swot"]} ready={!!o.swot} lines={6}>
          <div className="grid gap-3 md:grid-cols-2">
            {Q.map(([k, label, box, head]) => (
              <div key={k} className={`rounded-xl border p-4 print-avoid ${box}`}>
                <h3 className={`mb-2 text-sm font-bold uppercase tracking-wide ${head}`}>{label}</h3>
                <ul className="space-y-2">
                  {arr(o.swot?.[k]).map((x, i) => (
                    <li key={i} className="text-sm text-slate-800"><span className="font-medium">{x.point}</span>{x.evidence ? <span className="text-slate-600"> {x.evidence}</span> : null}<Cites ids={x.source_ids} /></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Gate>
      </Section>
    );
  };

  const renderPorter = () => {
    const score = { low: 1, medium: 2, high: 3 };
    const forces = arr(o.porter?.forces);
    const radar = forces.map((f) => ({ force: String(f.force).replace("Threat of ", "").replace("Bargaining power of ", ""), value: score[String(f.rating).toLowerCase()] || 0 }));
    return (
      <Section k="porter" title="Porter's Five Forces" Icon={Shield} conf={critic?.confidence?.porter}>
        <Gate ids={["porter"]} ready={!!o.porter} lines={6}>
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
              {forces.map((f, i) => (
                <Card key={i}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{f.force}</h3>
                    <Badge tone={levelTone(f.rating)}>{f.rating}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">{f.rationale}<Cites ids={f.source_ids} /></p>
                </Card>
              ))}
            </div>
            <div className="space-y-3 lg:col-span-2">
              <Card>
                <h3 className="text-sm font-semibold text-slate-900">Force intensity</h3>
                <p className="text-xs text-slate-500">Low = 1, Medium = 2, High = 3. Higher means more pressure on profits.</p>
                <div className="h-64" role="img" aria-label={`Five forces intensity: ${forces.map((f) => `${f.force} ${f.rating}`).join(", ")}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radar} outerRadius="70%">
                      <PolarGrid stroke="#cbd5e1" />
                      <PolarAngleAxis dataKey="force" tick={{ fontSize: 11, fill: "#334155" }} />
                      <PolarRadiusAxis domain={[0, 3]} tickCount={4} tick={false} axisLine={false} />
                      <Radar dataKey="value" stroke={ACCENT} fill={ACCENT} fillOpacity={0.25} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Industry attractiveness</div>
                <div className="mt-2 flex items-center gap-4"><Gauge value={o.porter?.attractiveness} /><p className="text-xs text-slate-600">{o.porter?.attractiveness_rationale}</p></div>
              </Card>
            </div>
          </div>
        </Gate>
      </Section>
    );
  };

  const renderFinancials = () => (
    <Section k="financials" title="Financials" Icon={DollarSign} conf={critic?.confidence?.financials}>
      <Gate ids={["financial"]} ready={!!o.financial} lines={6}>
        <div className="overflow-x-auto rounded-xl border border-slate-200 print-full">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Key financial metrics with evidence labels</caption>
            <thead className="bg-slate-100">
              <tr>{["Metric", "Entity", "Value", "Period", "Basis", "Sources"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold text-slate-700">{h}</th>)}</tr>
            </thead>
            <tbody>
              {arr(o.financial?.metrics).map((m, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium text-slate-900">{m.metric}</td>
                  <td className="px-3 py-2 text-slate-700">{m.entity}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{m.value}</td>
                  <td className="px-3 py-2 text-slate-700">{m.period}</td>
                  <td className="px-3 py-2"><Badge tone={m.label === "Reported" ? "green" : m.label === "Estimated" ? "amber" : "slate"}>{m.label}</Badge></td>
                  <td className="px-3 py-2">{m.label === "Unavailable" ? <span className="text-xs text-slate-400">n/a</span> : <Cites ids={m.source_ids} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Findings items={o.financial?.findings} />
        <Gaps items={o.financial?.gaps} />
      </Gate>
    </Section>
  );

  const renderStrategy = () => {
    const recs = arr(o.recs?.recommendations);
    const groups = [["Now", "border-indigo-700"], ["Next", "border-indigo-400"], ["Later", "border-slate-300"]];
    return (
      <Section k="strategy" title="Strategic Recommendations" Icon={Target} conf={critic?.confidence?.strategy}>
        <Gate ids={["recs"]} ready={!!o.recs} lines={6}>
          <div className="grid gap-4 xl:grid-cols-3">
            {groups.map(([p, border]) => (
              <div key={p}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">{p}<span className="text-xs font-normal normal-case text-slate-500">({recs.filter((r) => r.priority === p).length})</span></h3>
                <div className="space-y-3">
                  {recs.filter((r) => r.priority === p).map((r, i) => (
                    <div key={i} className={`rounded-xl border border-l-4 border-slate-200 bg-white p-4 print-avoid ${border}`}>
                      <div className="font-semibold text-slate-900">{r.action}<Cites ids={r.source_ids} /></div>
                      <p className="mt-1 text-sm text-slate-700">{r.rationale}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge tone={levelTone(r.impact, true)}>Impact: {r.impact}</Badge>
                        <Badge tone={levelTone(r.effort)}>Effort: {r.effort}</Badge>
                        {String(r.impact).startsWith("High") && String(r.effort).startsWith("Low") && <Badge tone="indigo">Quick win</Badge>}
                        {r.timeframe && <Badge>{r.timeframe}</Badge>}
                      </div>
                      <dl className="mt-2 space-y-1 text-xs">
                        <div><dt className="inline font-semibold text-slate-600">KPI: </dt><dd className="inline text-slate-700">{r.kpi}</dd></div>
                        <div><dt className="inline font-semibold text-slate-600">Risk: </dt><dd className="inline text-slate-700">{r.risk}</dd></div>
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Gate>
      </Section>
    );
  };

  const renderSources = () => (
    <Section k="sources" title={`Sources (${sources.length})`} Icon={BookOpen}>
      {sources.length ? (
        <ol className="space-y-1">
          {sources.map((s) => (
            <li key={s.id} id={`src-${s.id}`} className={`flex gap-3 rounded-lg px-2 py-1.5 text-sm transition ${highlight === s.id ? "bg-amber-50 ring-2 ring-amber-400" : ""}`}>
              <span className="w-8 flex-none text-right font-semibold text-indigo-700">[{s.id}]</span>
              <span className="min-w-0">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-words font-medium text-slate-900 underline decoration-slate-300 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {s.title}<ExternalLink size={12} className="ml-1 inline" aria-hidden="true" />
                </a>
                <span className="block text-xs text-slate-500">{s.domain}{s.date ? ` · ${s.date}` : ""}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : phase === "running" ? <Skeleton lines={5} /> : <p className="text-sm text-slate-500">No web sources were collected.</p>}
    </Section>
  );

  const RENDER = { summary: renderSummary, market: renderMarket, competitors: renderCompetitors, swot: renderSwot, porter: renderPorter, financials: renderFinancials, strategy: renderStrategy, sources: renderSources };

  const onTabKey = (e, i) => {
    let n = null;
    if (e.key === "ArrowRight") n = (i + 1) % TABS.length;
    if (e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
    if (e.key === "Home") n = 0;
    if (e.key === "End") n = TABS.length - 1;
    if (n !== null) { e.preventDefault(); setTab(TABS[n].k); tabRefs.current[n]?.focus(); }
  };

  /* ---------- agent theater ---------- */
  const agentList = order.map((id) => agents[id]).filter(Boolean);
  const finished = agentList.filter((a) => a.status === "done" || a.status === "failed").length;
  const progress = agentList.length ? Math.round((finished / (agentList.length === 1 ? 12 : agentList.length)) * 100) : 0;
  const currentStage = agentList.find((a) => a.status === "running")?.stage;

  const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600";
  const subjectInvalid = touched && !input.subject.trim();
  const running = phase === "running";
  const hasReport = !!runInput && phase !== "error";

  /* =======================================================================
     LAYOUT
     ======================================================================= */
  return (
    <ReportCtx.Provider value={{ sources, onCite, critic, agents, phase, retryAgent, regenerate, isBusy, sectionAgents: SECTION_AGENTS }}>
      <style>{PRINT_CSS}</style>
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 lg:flex-row">
        {/* ---------------- SIDEBAR ---------------- */}
        <aside className="no-print w-full border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-96 lg:flex-none lg:overflow-y-auto lg:border-b-0 lg:border-r" aria-label="Report settings">
          <div className="space-y-5 p-5">
            <div>
              <Logo />
              <p className="mt-1 text-xs text-slate-500">From question to boardroom-ready strategy.</p>
            </div>

            <div>
              <label htmlFor="subject" className={label}>Subject <span className="text-rose-600">*</span></label>
              <input id="subject" value={input.subject} onChange={(e) => setInput({ ...input, subject: e.target.value })} onBlur={() => setTouched(true)} onKeyDown={(e) => { if (e.key === "Enter" && !running) startRun(input); }} placeholder="Company, industry, or business idea" aria-required="true" aria-invalid={subjectInvalid} aria-describedby={subjectInvalid ? "subject-err" : undefined} className={`${field} ${subjectInvalid ? "border-rose-400" : ""}`} />
              {subjectInvalid && <p id="subject-err" className="mt-1 text-xs text-rose-600">Enter a subject to analyse.</p>}
            </div>

            <div>
              <label htmlFor="rtype" className={label}>Report type</label>
              <select id="rtype" value={input.reportType} onChange={(e) => setInput({ ...input, reportType: e.target.value })} className={field}>
                {REPORT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="geo" className={label}>Geography</label>
                <input id="geo" value={input.geography} onChange={(e) => setInput({ ...input, geography: e.target.value })} className={field} />
              </div>
              <div>
                <span id="horizon-l" className={label}>Horizon</span>
                <div role="group" aria-labelledby="horizon-l" className="flex rounded-lg border border-slate-300 p-0.5">
                  {[1, 3, 5].map((h) => (
                    <button key={h} type="button" aria-pressed={input.horizon === h} onClick={() => setInput({ ...input, horizon: h })} className={`flex-1 rounded-md py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${input.horizon === h ? "bg-indigo-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{h}y</button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="comps" className={label}>Named competitors (optional)</label>
              <textarea id="comps" rows={2} value={input.competitors} onChange={(e) => setInput({ ...input, competitors: e.target.value })} placeholder="Comma-separated. Leave blank to auto-discover." className={field} />
            </div>

            <div>
              <label htmlFor="ctx" className={label}>Your company context and goals (optional)</label>
              <textarea id="ctx" rows={3} value={input.context} onChange={(e) => setInput({ ...input, context: e.target.value })} placeholder="e.g. Mid-size OEM, targeting 10% share in 3 years" className={field} />
            </div>

            <div>
              <span id="focus-l" className={label}>Focus areas</span>
              <div role="group" aria-labelledby="focus-l" className="flex flex-wrap gap-1.5">
                {FOCUS_AREAS.map((f) => {
                  const on = input.focus.includes(f);
                  return (
                    <button key={f} type="button" aria-pressed={on} onClick={() => setInput({ ...input, focus: on ? input.focus.filter((x) => x !== f) : [...input.focus, f] })} className={`rounded-full border px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${on ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}>{f}</button>
                  );
                })}
              </div>
            </div>

            <div>
              <span id="depth-l" className={label}>Research depth</span>
              <div role="group" aria-labelledby="depth-l" className="grid grid-cols-2 gap-1 rounded-lg border border-slate-300 p-0.5">
                {[["quick", "Quick", "2 searches/agent, 3 competitors"], ["deep", "Deep", "5 searches/agent, 5 competitors"]].map(([v, l, d]) => (
                  <button key={v} type="button" aria-pressed={input.depth === v} onClick={() => setInput({ ...input, depth: v })} className={`rounded-md px-2 py-1.5 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 ${input.depth === v ? "bg-indigo-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                    <span className="block text-sm font-medium">{l}</span>
                    <span className={`block text-xs ${input.depth === v ? "text-indigo-100" : "text-slate-500"}`}>{d}</span>
                  </button>
                ))}
              </div>
            </div>

            {running ? (
              <button type="button" onClick={stopRun} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <Square size={16} aria-hidden="true" /> Stop pipeline
              </button>
            ) : (
              <button type="button" onClick={() => startRun(input)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                <Play size={16} aria-hidden="true" /> Generate strategy report
              </button>
            )}

            <div>
              <span className={label}>Try an example</span>
              <Chips disabled={running} onPick={(ex) => { setInput(ex); startRun(ex); }} />
            </div>
          </div>
        </aside>

        {/* ---------------- MAIN ---------------- */}
        <main className="min-w-0 flex-1 print-full lg:h-screen lg:overflow-y-auto">
          <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
            {/* Empty state */}
            {!runInput && (
              <div className="flex min-h-screen flex-col items-center justify-center text-center lg:min-h-0 lg:py-24">
                <Logo size="text-4xl" icon={44} />
                <p className="mt-3 text-lg text-slate-600">From question to boardroom-ready strategy.</p>
                <p className="mt-4 max-w-xl text-sm text-slate-500">
                  Enter a company, industry or business idea. Eleven specialized agents plan the research, search the web live, and deliver a cited strategy report: SWOT, Five Forces, competitor comparison, financials and prioritized recommendations.
                </p>
                <div className="mt-6"><Chips center disabled={running} onPick={(ex) => { setInput(ex); startRun(ex); }} /></div>
                <div className="mt-10 grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3">
                  {[["Plan", "Orchestrator frames questions, competitors and assumptions."], ["Research", "Parallel agents search the web and cite every claim."], ["Decide", "Strategy, critic and editor agents produce the board-ready view."]].map(([t, d], i) => (
                    <Card key={t}><div className="text-xs font-semibold text-indigo-700">Step {i + 1}</div><div className="font-semibold text-slate-900">{t}</div><p className="mt-1 text-xs text-slate-600">{d}</p></Card>
                  ))}
                </div>
              </div>
            )}

            {runInput && (
              <>
                {/* Report header */}
                <header className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="print-only mb-2"><Logo /></div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">StratifyAI Strategy Report: {runInput.subject}</h1>
                    <p className="mt-1 text-sm text-slate-500">{runInput.reportType} · {runInput.geography} · {runInput.horizon}-year horizon · {runInput.depth === "deep" ? "Deep" : "Quick"} research · {TODAY}</p>
                  </div>
                  {hasReport && (
                    <div className="no-print flex flex-wrap gap-2">
                      <button type="button" onClick={copyMarkdown} disabled={running} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"><Copy size={14} aria-hidden="true" /> Copy Markdown</button>
                      <button type="button" onClick={downloadMarkdown} disabled={running} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"><Download size={14} aria-hidden="true" /> Download .md</button>
                      <button type="button" onClick={printReport} disabled={running} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"><Printer size={14} aria-hidden="true" /> Print / Save as PDF</button>
                    </div>
                  )}
                </header>

                {/* Agent theater */}
                <section className="no-print rounded-xl border border-slate-200 bg-white" aria-labelledby="theater-h">
                  <button type="button" onClick={() => setTheaterOpen(!theaterOpen)} aria-expanded={theaterOpen} className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <span className="flex items-center gap-2">
                      {theaterOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
                      <span id="theater-h" className="font-semibold text-slate-900">Agent pipeline</span>
                      <span className="text-sm text-slate-500">
                        {running ? `Stage ${currentStage || 1} of 6: ${STAGE_TITLES[currentStage || 1]}` : phase === "done" ? "Complete" : phase === "stopped" ? "Stopped" : phase === "error" ? "Failed" : ""}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums text-slate-600">{finished}/{agentList.length} agents</span>
                  </button>
                  <div className="px-4 pb-1">
                    <div className="h-1.5 w-full rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Pipeline progress">
                      <div className="h-1.5 rounded-full bg-indigo-700 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  {theaterOpen && (
                    <div className="space-y-4 p-4">
                      {[1, 2, 3, 4, 5, 6].map((st) => {
                        const list = agentList.filter((a) => a.stage === st);
                        if (!list.length) return null;
                        return (
                          <div key={st}>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage {st} · {STAGE_TITLES[st]}{list.length > 1 && st !== 3 ? " (parallel)" : ""}</h3>
                            <ul className="grid gap-2 md:grid-cols-2">{list.map((a) => <AgentRow key={a.id} a={a} now={now} />)}</ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Fatal error */}
                {phase === "error" && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center" role="alert">
                    <AlertTriangle className="mx-auto text-rose-600" size={28} aria-hidden="true" />
                    <p className="mt-2 font-medium text-rose-900">{fatal}</p>
                    <p className="mt-1 text-sm text-rose-700">{agents.orchestrator?.error}</p>
                    <button type="button" onClick={() => retryAgent("orchestrator")} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 focus:outline-none focus:ring-2 focus:ring-rose-500"><RefreshCw size={14} aria-hidden="true" /> Retry this agent</button>
                  </div>
                )}

                {/* Loading skeleton before plan exists */}
                {running && !plan && (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"><Skeleton lines={3} /><Skeleton lines={5} /></div>
                )}

                {/* Report */}
                {plan && (
                  <div className="rounded-xl border border-slate-200 bg-white print-full">
                    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2">
                      {view === "tabs" ? (
                        <div role="tablist" aria-label="Report sections" className="-mb-2 flex gap-1 overflow-x-auto">
                          {TABS.map((t, i) => (
                            <button key={t.k} ref={(el) => { tabRefs.current[i] = el; }} role="tab" type="button" id={`tab-${t.k}`} aria-selected={tab === t.k} aria-controls="tabpanel" tabIndex={tab === t.k ? 0 : -1} onClick={() => setTab(t.k)} onKeyDown={(e) => onTabKey(e, i)} className={`flex flex-none items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${tab === t.k ? "border-indigo-700 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
                              <t.Icon size={14} aria-hidden="true" />{t.label}
                            </button>
                          ))}
                        </div>
                      ) : <span className="text-sm font-medium text-slate-700">Full report</span>}
                      <div role="group" aria-label="Report view" className="flex rounded-lg border border-slate-300 p-0.5">
                        {[["tabs", "Tabs", LayoutGrid], ["full", "Full Report", List]].map(([v, l, Ic]) => (
                          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${view === v ? "bg-indigo-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}><Ic size={12} aria-hidden="true" />{l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="p-4 sm:p-6">
                      {view === "tabs" ? (
                        <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>{RENDER[tab]()}</div>
                      ) : (
                        <div className="space-y-12">{TABS.map((t) => <div key={t.k}>{RENDER[t.k]()}</div>)}</div>
                      )}
                      <p className="mt-10 border-t border-slate-200 pt-3 text-center text-xs text-slate-400">Generated by StratifyAI · {TODAY} · AI-generated analysis; verify material figures against cited sources before acting.</p>
                    </div>
                  </div>
                )}

                {/* Ask StratifyAI */}
                {plan && (
                  <section className="no-print rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="qa-h">
                    <h2 id="qa-h" className="flex items-center gap-2 font-semibold text-slate-900"><MessageSquare size={18} color={ACCENT} aria-hidden="true" /> Ask StratifyAI</h2>
                    <p className="text-xs text-slate-500">Follow-up questions are answered from this report, with a web search when needed.</p>
                    <div className="mt-3 space-y-3" aria-live="polite">
                      {qa.map((m, i) => (
                        <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-prose rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "bg-indigo-700 text-white" : m.error ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-800"}`}>
                            <span className="whitespace-pre-wrap">{m.text}</span>
                            {m.role === "assistant" && !m.error && <Cites ids={m.ids} />}
                          </div>
                        </div>
                      ))}
                      {qaBusy && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Analysing</div>}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <label htmlFor="qa-input" className="sr-only">Ask a follow-up question</label>
                      <input id="qa-input" value={qaText} onChange={(e) => setQaText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} disabled={qaBusy} placeholder="e.g. What would a 15% price cut do to our share?" className={field} />
                      <button type="button" onClick={ask} disabled={qaBusy || !qaText.trim()} aria-label="Send question" className="inline-flex flex-none items-center gap-1 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"><Send size={14} aria-hidden="true" /> Ask</button>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div role="status" className="no-print fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
      )}
    </ReportCtx.Provider>
  );
}

"use client";

import { useState, useCallback, useRef } from "react";

const UNKNOWN_PHRASES = ["not visible in screenshots", "not tested", "unknown", "not provided", "none visible"];

function fieldStatus(ticket: string, fieldName: string): "pass" | "partial" | "missing" {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)`, "im");
  const match = ticket.match(regex);
  if (!match) return "missing";
  const value = match[1].trim().toLowerCase();
  if (UNKNOWN_PHRASES.some((p) => value.includes(p))) return "partial";
  return "pass";
}

interface CheckItem { q: string; label: string; field: string | null; }

const SHARKEY_CHECKS: CheckItem[] = [
  { q: "Q1a", label: "What's happening?",          field: "Problem" },
  { q: "Q1b", label: "How to reproduce?",           field: "Repro" },
  { q: "Q2",  label: "What's supposed to happen?", field: "Expected" },
  { q: "Q3",  label: "Widespread or isolated?",    field: "Scope" },
  { q: "Q4",  label: "Did this just start?",        field: "Timeline" },
  { q: "Q5",  label: "What account is affected?",  field: "Account" },
  { q: "Q6",  label: "Screenshot provided?",        field: null },
  { q: "Q7",  label: "What device/platform?",       field: "Platform" },
  { q: "Q8",  label: "Tried incognito/browser?",   field: "Browser tested" },
  { q: "Q9",  label: "What URL?",                   field: "URL" },
  { q: "Q10", label: "Error message?",              field: "Error" },
  { q: "Q11", label: "Is there a workaround?",     field: "Workaround" },
];

function SharkeyChecklist({ ticket, hasScreenshots }: { ticket: string; hasScreenshots: boolean }) {
  const statuses = SHARKEY_CHECKS.map((check) => {
    if (check.field === null) return hasScreenshots ? "pass" : "missing";
    return fieldStatus(ticket, check.field);
  });
  const passCount = statuses.filter((s) => s === "pass").length;
  const total = SHARKEY_CHECKS.length;
  const allPass = passCount === total;

  return (
    <div className="mt-4 bg-zinc-900 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Sharkey&apos;s Checklist</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${allPass ? "bg-green-500/20 text-green-400" : "bg-zinc-700 text-zinc-300"}`}>
          {passCount}/{total}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {SHARKEY_CHECKS.map((check, i) => {
          const status = statuses[i];
          return (
            <div key={check.q} className="flex items-center gap-2">
              <span className={`text-sm leading-none ${status === "pass" ? "text-green-400" : status === "partial" ? "text-yellow-400" : "text-zinc-600"}`}>
                {status === "pass" ? "✓" : status === "partial" ? "~" : "○"}
              </span>
              <span className={`text-xs ${status === "pass" ? "text-zinc-300" : status === "partial" ? "text-zinc-500" : "text-zinc-600"}`}>
                <span className="text-zinc-600 mr-1">{check.q}</span>{check.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-600 mt-3">✓ answered · ~ partial/unknown · ○ missing — not included when you copy</p>
    </div>
  );
}

const inputCls = "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500";
const selectCls = inputCls + " cursor-pointer";

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
      {children}{hint && <span className="normal-case font-normal text-zinc-600 ml-1">{hint}</span>}
    </label>
  );
}

export default function Home() {
  const [images, setImages]                   = useState<{ data: string; type: string; name: string }[]>([]);
  const [account, setAccount]                 = useState("");
  const [url, setUrl]                         = useState("");
  const [surface, setSurface]                 = useState("");
  const [timeline, setTimeline]               = useState("");
  const [browserTested, setBrowserTested]     = useState("");
  const [urgency, setUrgency]                 = useState("");
  const [extraContext, setExtraContext]        = useState("");
  const [ticket, setTicket]                   = useState("");
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState("");
  const [copied, setCopied]                   = useState(false);
  const [dragging, setDragging]               = useState(false);

  const urgencyBlocked = urgency === "now" || urgency === "14days";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  const convertToSupported = (file: File): Promise<{ data: string; type: string; name: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const outputType = SUPPORTED_TYPES.includes(file.type) ? file.type : "image/jpeg";
        if (SUPPORTED_TYPES.includes(file.type)) {
          resolve({ data: dataUrl, type: file.type, name: file.name });
          return;
        }
        // Convert unsupported types via canvas
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext("2d")?.drawImage(img, 0, 0);
          resolve({ data: canvas.toDataURL(outputType), type: outputType, name: file.name });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  };

  const processFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).filter((f) => f.type.startsWith("image/")).forEach(async (file) => {
      const result = await convertToSupported(file);
      setImages((prev) => [...prev, result]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const imageItems = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    imageItems.forEach((item) => { const f = item.getAsFile(); if (f) processFiles([f]); });
  }, [processFiles]);

  const generate = async () => {
    if (images.length === 0) { setError("Upload at least one screenshot first."); return; }
    setError(""); setLoading(true); setTicket("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, account, url, surface, timeline, browserTested, urgency, extraContext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setTicket(data.ticket);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setLoading(false); }
  };

  const copyTicket = () => {
    navigator.clipboard.writeText(ticket); setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col" onPaste={handlePaste}>

      {/* Header */}
      <header className="border-b border-zinc-800 px-8 py-4 bg-zinc-900">
        <h1 className="text-lg font-semibold text-white">Dogfood Creator</h1>
        <p className="text-xs text-zinc-500">Screenshots + context → engineering-ready ticket</p>
      </header>

      <div className="flex-1 overflow-y-auto p-6 flex gap-6 max-w-6xl mx-auto w-full">

        {/* Left: inputs */}
        <div className="w-96 shrink-0 flex flex-col gap-4">

          {/* Screenshots */}
          <div>
            <Label>Screenshots</Label>
            <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-5 cursor-pointer transition-colors text-center ${dragging ? "border-blue-500 bg-blue-500/5" : "border-zinc-700 hover:border-zinc-500 bg-zinc-900"}`}>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => e.target.files && processFiles(e.target.files)} />
              <svg className="mx-auto w-6 h-6 text-zinc-600 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-zinc-400">Drop, click, or <span className="text-blue-400">paste</span></p>
              <p className="text-xs text-zinc-600 mt-0.5">Any image type · multiple files ok</p>
            </div>
            {images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {images.map((img, i) => (
                  <div key={i} className="relative group w-16 h-16">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.data} alt={img.name} className="w-16 h-16 object-cover rounded border border-zinc-700" />
                    <button onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">What Claude can&apos;t see</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          <div>
            <Label hint="Q6">Account affected</Label>
            <input type="text" value={account} onChange={(e) => setAccount(e.target.value)}
              placeholder="biz_id, user_id, email, dashboard link..." className={inputCls} />
          </div>

          <div>
            <Label hint="Q10">URL where it happened</Label>
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://whop.com/dashboard/..." className={inputCls} />
          </div>

          <div>
            <Label>Surface</Label>
            <input type="text" value={surface} onChange={(e) => setSurface(e.target.value)}
              placeholder='e.g. Dashboard (Payments), Checkout / Cancellation Flow...'
              className={inputCls} />
          </div>

          <div>
            <Label>When does this need to be done?</Label>
            <select value={urgency} onChange={(e) => { setUrgency(e.target.value); setTicket(""); }} className={selectCls}>
              <option value="">Select...</option>
              <option value="now">Now</option>
              <option value="24h">24 hours from now</option>
              <option value="5days">5 days from now</option>
              <option value="14days">14 days from now</option>
            </select>
            {urgency === "now" && (
              <div className="mt-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
                This needs an incident, not a dogfood. Open one here:{" "}
                <a href="https://internal.whop.com/engineering/operations/incidents" target="_blank" rel="noreferrer" className="underline">
                  internal.whop.com/engineering/operations/incidents
                </a>{" "}
                (type /inc)
              </div>
            )}
            {urgency === "14days" && (
              <div className="mt-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-sm text-yellow-400">
                This is not important enough to be a dogfood — please don&apos;t file it so engineering can focus on the highest impact things.
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Label hint="Q4">Timeline</Label>
              <select value={timeline} onChange={(e) => setTimeline(e.target.value)} className={selectCls}>
                <option value="">Select...</option>
                <option value="Just started">Just started</option>
                <option value="Ongoing">Ongoing</option>
                <option value="Started after recent update">After recent update</option>
                <option value="Unknown">Unknown</option>
              </select>
            </div>
            <div className="flex-1">
              <Label hint="Q9">Browser tested</Label>
              <select value={browserTested} onChange={(e) => setBrowserTested(e.target.value)} className={selectCls}>
                <option value="">Select...</option>
                <option value="Not tested">Not tested</option>
                <option value="Same issue in incognito">Same in incognito</option>
                <option value="Works in incognito">Works in incognito</option>
                <option value="Same issue in different browser">Same in other browser</option>
                <option value="Works in different browser">Works in other browser</option>
              </select>
            </div>
          </div>

          <div>
            <Label hint="(optional)">Anything else</Label>
            <textarea value={extraContext} onChange={(e) => setExtraContext(e.target.value)}
              placeholder="What the customer said, repro steps you know, other context..."
              rows={3} className={inputCls + " resize-none"} />
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}

          <button onClick={generate} disabled={loading || images.length === 0 || urgencyBlocked}
            className="w-full bg-white text-zinc-950 font-semibold py-3 rounded-lg hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating...
              </span>
            ) : "Generate Dogfood"}
          </button>
        </div>

        {/* Right: output */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">Generated Ticket</label>
            {ticket && (
              <button onClick={copyTicket}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors ${copied ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"}`}>
                {copied ? (
                  <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                ) : (
                  <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy ticket</>
                )}
              </button>
            )}
          </div>

          {ticket ? (
            <>
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 font-mono text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
                {ticket}
              </div>
              <SharkeyChecklist ticket={ticket} hasScreenshots={images.length > 0} />
            </>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 flex-1 flex items-center justify-center min-h-64">
              <p className="text-zinc-600 text-sm text-center">
                {loading ? "Claude is reading your screenshots..." : "Your ticket will appear here"}
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

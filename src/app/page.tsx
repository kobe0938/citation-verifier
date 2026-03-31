"use client";

import { useState, useRef } from "react";

interface Result {
  bibKey: string;
  status: "ok" | "mismatch" | "not_found" | "url_ok" | "url_dead" | "error";
  ourTitle: string;
  ourYear: string;
  ourAuthors: string;
  s2Title: string;
  s2Year: string;
  s2Authors: string;
  s2Venue: string;
  s2Arxiv: string;
  s2Doi: string;
  s2Url: string;
  titleMatch: string;
  yearMatch: string;
  authorMatch: string;
}

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-green-100 text-green-800",
  url_ok: "bg-blue-100 text-blue-800",
  mismatch: "bg-yellow-100 text-yellow-800",
  not_found: "bg-red-100 text-red-800",
  url_dead: "bg-red-100 text-red-800",
  error: "bg-gray-100 text-gray-800",
};

const STATUS_LABELS: Record<string, string> = {
  ok: "OK",
  url_ok: "URL OK",
  mismatch: "Check Needed",
  not_found: "Not Found",
  url_dead: "URL Dead",
  error: "Error",
};

const EXAMPLE_BIB = `@article{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N and Kaiser, Lukasz and Polosukhin, Illia},
  journal={Advances in neural information processing systems},
  volume={30},
  year={2017}
}

@article{devlin2018bert,
  title={Bert: Pre-training of deep bidirectional transformers for language understanding},
  author={Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina},
  journal={arXiv preprint arXiv:1810.04805},
  year={2018}
}`;

export default function Home() {
  const [bibText, setBibText] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  async function verify() {
    if (!bibText.trim()) return;
    setResults([]);
    setLoading(true);
    setExpanded(new Set());

    // Count entries for progress
    const entryCount = (bibText.match(/@\w+\{/g) || []).length;
    setProgress({ done: 0, total: entryCount });

    abortRef.current = new AbortController();

    try {
      const resp = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bibText }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        alert(err.error || "Request failed");
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let count = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            const result: Result = JSON.parse(line);
            count++;
            setResults((prev) => [...prev, result]);
            setProgress({ done: count, total: entryCount });
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        alert("Error: " + e.message);
      }
    }
    setLoading(false);
  }

  function toggleExpand(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function exportCsv() {
    if (results.length === 0) return;
    const headers = [
      "bib_key", "status", "title_match", "year_match", "author_match",
      "our_title", "s2_title", "our_year", "s2_year",
      "our_authors", "s2_authors", "s2_venue", "s2_arxiv", "s2_doi", "s2_url",
    ];
    const rows = results.map((r) => [
      r.bibKey, r.status, r.titleMatch, r.yearMatch, r.authorMatch,
      r.ourTitle, r.s2Title, r.ourYear, r.s2Year,
      r.ourAuthors, r.s2Authors, r.s2Venue, r.s2Arxiv, r.s2Doi, r.s2Url,
    ].map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(","));

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "verification_log.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const urlOkCount = results.filter((r) => r.status === "url_ok").length;
  const mismatchCount = results.filter((r) => r.status === "mismatch").length;
  const notFoundCount = results.filter((r) => r.status === "not_found" || r.status === "url_dead").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <main className="max-w-4xl mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold mb-2">Citation Verifier</h1>
      <p className="text-gray-600 mb-6">
        Paste your BibTeX entries below to verify them against{" "}
        <a
          href="https://www.semanticscholar.org/"
          target="_blank"
          className="underline text-blue-600"
        >
          Semantic Scholar
        </a>
        . For entries marked as &ldquo;Check Needed&rdquo;, you can verify manually on{" "}
        <a
          href="https://scholar.google.com/schhp"
          target="_blank"
          className="underline text-blue-600"
        >
          Google Scholar
        </a>
        .
      </p>

      <textarea
        className="w-full h-64 p-3 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        placeholder="Paste your .bib content here..."
        value={bibText}
        onChange={(e) => setBibText(e.target.value)}
      />

      <div className="flex gap-3 mt-3">
        <button
          onClick={verify}
          disabled={loading || !bibText.trim()}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? `Checking... (${progress.done}/${progress.total})` : "Verify Citations"}
        </button>
        <button
          onClick={() => setBibText(EXAMPLE_BIB)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
        >
          Load Example
        </button>
        {results.length > 0 && (
          <>
            <button
              onClick={exportCsv}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
            >
              Export CSV
            </button>
            <button
              onClick={() => {
                const allExpanded = expanded.size === results.length;
                setExpanded(allExpanded ? new Set() : new Set(results.map((_, i) => i)));
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
            >
              {expanded.size === results.length ? "Collapse All" : "Expand All"}
            </button>
          </>
        )}
      </div>

      {results.length > 0 && (
        <div className="mt-6 mb-4 flex gap-4 text-sm">
          <span className="px-2 py-1 bg-green-100 text-green-800 rounded">OK: {okCount}</span>
          {urlOkCount > 0 && (
            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">URL OK: {urlOkCount}</span>
          )}
          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded">Check: {mismatchCount}</span>
          {notFoundCount > 0 && (
            <span className="px-2 py-1 bg-red-100 text-red-800 rounded">Not Found: {notFoundCount}</span>
          )}
          {errorCount > 0 && (
            <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded">Error: {errorCount}</span>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {results.map((r, i) => (
          <div key={i} className="border border-gray-200 rounded-lg bg-white">
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
              onClick={() => toggleExpand(i)}
            >
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.status]}`}
              >
                {STATUS_LABELS[r.status]}
              </span>
              <span className="font-mono text-sm text-gray-500">{r.bibKey}</span>
              <span className="text-sm truncate flex-1">{r.ourTitle}</span>
              <span className="text-gray-400 text-sm">{expanded.has(i) ? "−" : "+"}</span>
            </div>

            {expanded.has(i) && (
              <div className="px-4 pb-4 text-sm border-t border-gray-100 pt-3">
                {(r.status === "url_ok" || r.status === "url_dead") ? (
                  <div className="space-y-1 text-gray-600">
                    <div><span className="font-medium">Type:</span> Web resource (blog, dataset, or misc)</div>
                    {r.s2Url && (
                      <div>
                        <span className="font-medium">URL:</span>{" "}
                        <a href={r.s2Url} target="_blank" className="text-blue-600 underline break-all">{r.s2Url}</a>
                        {r.status === "url_ok" ? " (reachable)" : " (not reachable)"}
                      </div>
                    )}
                    {r.s2Title && <div className="text-gray-500 italic">{r.s2Title}</div>}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-[auto_1fr_1fr] gap-x-6 gap-y-1">
                      <div className="font-medium text-gray-500"></div>
                      <div className="font-medium text-gray-500">Your BibTeX</div>
                      <div className="font-medium text-gray-500">Semantic Scholar</div>

                      <div className="font-medium">Title {r.titleMatch === "OK" ? "✓" : r.titleMatch === "MISMATCH" ? "✗" : ""}</div>
                      <div>{r.ourTitle}</div>
                      <div>{r.s2Title || "—"}</div>

                      <div className="font-medium">Year {r.yearMatch === "OK" ? "✓" : r.yearMatch === "MISMATCH" ? "✗" : ""}</div>
                      <div>{r.ourYear}</div>
                      <div>{r.s2Year || "—"}</div>

                      <div className="font-medium">Authors {r.authorMatch === "OK" ? "✓" : r.authorMatch === "MISMATCH" ? "✗" : ""}</div>
                      <div className="break-words">{r.ourAuthors}</div>
                      <div className="break-words">{r.s2Authors || "—"}</div>
                    </div>

                    {(r.s2Venue || r.s2Arxiv || r.s2Doi || r.s2Url) && (
                      <div className="mt-3 pt-2 border-t border-gray-100 text-gray-600 space-y-1">
                        {r.s2Venue && <div><span className="font-medium">Venue:</span> {r.s2Venue}</div>}
                        {r.s2Arxiv && <div><span className="font-medium">ArXiv:</span> {r.s2Arxiv}</div>}
                        {r.s2Doi && <div><span className="font-medium">DOI:</span> {r.s2Doi}</div>}
                        {r.s2Url && (
                          <div>
                            <a href={r.s2Url} target="_blank" className="text-blue-600 underline">
                              View on Semantic Scholar
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <footer className="mt-12 pb-8 text-center text-sm text-gray-400">
        Created by{" "}
        <a
          href="https://github.com/kobe0938"
          target="_blank"
          className="text-gray-500 hover:text-gray-700 underline"
        >
          Kobe Chen
        </a>
        {" | "}
        <a
          href="https://github.com/kobe0938/citation-verifier"
          target="_blank"
          className="text-gray-500 hover:text-gray-700 underline"
        >
          GitHub
        </a>
        {" | "}
        <a
          href="https://x.com/kobe0938"
          target="_blank"
          className="text-gray-500 hover:text-gray-700 underline"
        >
          X
        </a>
      </footer>
    </main>
  );
}

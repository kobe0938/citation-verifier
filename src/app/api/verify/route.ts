import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300; // 5 min for Vercel Pro, 60s on Hobby (best effort)

const S2_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match";
const S2_FIELDS = "paperId,title,authors,year,venue,externalIds";

interface BibEntry {
  key: string;
  title: string;
  author: string;
  year: string;
  url: string;
  entryType: string;
}

interface VerifyResult {
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

/** Strip LaTeX commands and braces from a string */
function stripLatex(s: string): string {
  return s
    .replace(/\$\\{?\$?/g, "")       // $\{$ or $
    .replace(/\$\\}?\$?/g, "")       // $\}$ or $
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1") // \cmd{text} -> text
    .replace(/\{\\['"`~^cv]?\s*(\w)\}/g, "$1") // {\'e} -> e
    .replace(/\\['"`~^cv]\{?(\w)\}?/g, "$1")   // \'e -> e
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract title from bib entry, handling nested braces properly */
function extractTitle(text: string): string {
  // Find "title = " or "title=" then capture everything between the outermost braces
  const titleStart = text.search(/title\s*=/i);
  if (titleStart === -1) return "";

  const afterEquals = text.slice(titleStart).replace(/^title\s*=\s*/i, "");
  // Find the first opening brace
  const braceStart = afterEquals.indexOf("{");
  if (braceStart === -1) return "";

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < afterEquals.length; i++) {
    if (afterEquals[i] === "{") depth++;
    else if (afterEquals[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return "";

  let title = afterEquals.slice(braceStart + 1, end);
  // Remove one layer of inner braces if the whole thing is wrapped (e.g. {{Title}})
  if (title.startsWith("{") && title.endsWith("}")) {
    // Check if these are matching outer braces
    let d = 0;
    let matched = true;
    for (let i = 0; i < title.length - 1; i++) {
      if (title[i] === "{") d++;
      else if (title[i] === "}") d--;
      if (d === 0) { matched = false; break; }
    }
    if (matched) title = title.slice(1, -1);
  }

  return stripLatex(title).replace(/\s+/g, " ").trim();
}

function parseBibEntries(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const chunks: string[] = [];
  let current: string[] = [];
  let depth = 0;

  for (const line of text.split("\n")) {
    if (/^\s*@/.test(line)) {
      if (current.length > 0 && depth === 0) {
        chunks.push(current.join("\n"));
        current = [];
      }
      depth = 0;
    }
    current.push(line);
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
  }
  if (current.length > 0) chunks.push(current.join("\n"));

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const typeMatch = trimmed.match(/@(\w+)\{/);
    const keyMatch = trimmed.match(/@\w+\{(\S+?),/);
    const title = extractTitle(trimmed);
    const authorMatch = trimmed.match(/author\s*=\s*\{(.*?)\}/is);
    const yearMatch = trimmed.match(/year\s*=\s*\{?(\d{4})\}?/i);
    // Extract URL from url={...} or howpublished={\url{...}}
    const urlMatch = trimmed.match(/url\s*=\s*\{(https?:\/\/[^}\s]+)\}/i)
      || trimmed.match(/howpublished\s*=\s*\{\\url\{(https?:\/\/[^}\s]+)\}\}/i);

    if (title) {
      entries.push({
        key: keyMatch?.[1] || "",
        title,
        author: authorMatch ? stripLatex(authorMatch[1]).replace(/\s+/g, " ").trim() : "",
        year: yearMatch?.[1] || "",
        url: urlMatch?.[1] || "",
        entryType: typeMatch?.[1]?.toLowerCase() || "",
      });
    }
  }
  return entries;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function firstAuthorLast(author: string): string {
  return author.split(",")[0].trim().toLowerCase();
}

async function searchS2(title: string): Promise<Record<string, unknown> | null> {
  const url = `${S2_MATCH}?query=${encodeURIComponent(title)}&fields=${S2_FIELDS}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`S2 API error: ${resp.status}`);
  const data = await resp.json();
  return data?.data?.[0] || null;
}

async function searchS2WithRetry(title: string, retries = 2): Promise<Record<string, unknown> | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await searchS2(title);
    } catch {
      if (i === retries) return null;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}

/** Check if a URL is reachable (HEAD request with fallback to GET) */
async function checkUrl(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) return true;
    // Some servers don't support HEAD, try GET
    const resp2 = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    return resp2.ok;
  } catch {
    return false;
  }
}

/** Decide if this entry is a "web resource" that should be URL-checked instead of S2-searched */
function isWebResource(entry: BibEntry): boolean {
  const webTypes = ["online", "misc", "dataset"];
  if (webTypes.includes(entry.entryType) && entry.url) return true;
  // If it has a URL and no meaningful academic metadata, treat as web resource
  if (entry.url && !entry.author) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const { bibText } = await req.json();
  if (!bibText || typeof bibText !== "string") {
    return NextResponse.json({ error: "No bib text provided" }, { status: 400 });
  }

  const entries = parseBibEntries(bibText);
  if (entries.length === 0) {
    return NextResponse.json({ error: "No valid BibTeX entries found" }, { status: 400 });
  }

  // Deduplicate by key
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < unique.length; i++) {
        const entry = unique[i];
        const result: VerifyResult = {
          bibKey: entry.key,
          status: "error",
          ourTitle: entry.title,
          ourYear: entry.year,
          ourAuthors: entry.author,
          s2Title: "",
          s2Year: "",
          s2Authors: "",
          s2Venue: "",
          s2Arxiv: "",
          s2Doi: "",
          s2Url: "",
          titleMatch: "",
          yearMatch: "",
          authorMatch: "",
        };

        try {
          // For web resources (blogs, datasets, misc with URLs), verify URL instead
          if (isWebResource(entry)) {
            const alive = await checkUrl(entry.url);
            result.status = alive ? "url_ok" : "url_dead";
            result.s2Url = entry.url;
            result.s2Title = alive ? "URL is reachable" : "URL is not reachable";
          } else {
            // Search Semantic Scholar with retry
            const paper = await searchS2WithRetry(entry.title);
            if (!paper) {
              // If not found on S2 but has a URL, try URL check as fallback
              if (entry.url) {
                const alive = await checkUrl(entry.url);
                result.status = alive ? "url_ok" : "not_found";
                result.s2Url = entry.url;
                result.s2Title = alive ? "Not on S2, but URL is reachable" : "";
              } else {
                result.status = "not_found";
              }
            } else {
              const s2Title = (paper.title as string) || "";
              const s2Year = paper.year ? String(paper.year) : "";
              const s2Authors = ((paper.authors as Array<{ name: string }>) || []).map(
                (a) => a.name
              );
              const s2Ids = (paper.externalIds as Record<string, string>) || {};
              const paperId = (paper.paperId as string) || "";

              result.s2Title = s2Title;
              result.s2Year = s2Year;
              result.s2Authors = s2Authors.join("; ");
              result.s2Venue = (paper.venue as string) || "";
              result.s2Arxiv = s2Ids.ArXiv || "";
              result.s2Doi = s2Ids.DOI || "";
              result.s2Url = paperId
                ? `https://www.semanticscholar.org/paper/${paperId}`
                : "";

              // Title check
              const titleOk = normalize(entry.title) === normalize(s2Title);
              result.titleMatch = titleOk ? "OK" : "MISMATCH";

              // Year check
              if (entry.year) {
                if (entry.year === s2Year) {
                  result.yearMatch = "OK";
                } else if (!s2Year) {
                  result.yearMatch = "S2 N/A";
                } else {
                  result.yearMatch = "MISMATCH";
                }
              }

              // First author check
              if (entry.author && s2Authors.length > 0) {
                const ourLast = firstAuthorLast(entry.author);
                const s2Last = s2Authors[0].split(" ").pop()?.toLowerCase() || "";
                result.authorMatch = ourLast === s2Last ? "OK" : "MISMATCH";
              }

              const allOk =
                titleOk &&
                result.yearMatch === "OK" &&
                result.authorMatch === "OK";
              result.status = allOk ? "ok" : "mismatch";
            }
          }
        } catch {
          result.status = "error";
        }

        controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"));

        // Minimal delay — S2 is generous with rate limits
        if (i < unique.length - 1) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

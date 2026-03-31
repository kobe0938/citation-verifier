import { NextRequest, NextResponse } from "next/server";

const S2_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match";
const S2_FIELDS = "paperId,title,authors,year,venue,externalIds";

interface BibEntry {
  key: string;
  title: string;
  author: string;
  year: string;
}

interface VerifyResult {
  bibKey: string;
  status: "ok" | "mismatch" | "not_found" | "error";
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

    const keyMatch = trimmed.match(/@\w+\{(\S+?),/);
    const titleMatch = trimmed.match(/title\s*=\s*\{+(.*?)\}+/i);
    const authorMatch = trimmed.match(/author\s*=\s*\{(.*?)\}/is);
    const yearMatch = trimmed.match(/year\s*=\s*\{?(\d{4})\}?/i);

    if (titleMatch) {
      entries.push({
        key: keyMatch?.[1] || "",
        title: titleMatch[1].replace(/\s+/g, " ").trim(),
        author: authorMatch ? authorMatch[1].replace(/\s+/g, " ").trim() : "",
        year: yearMatch?.[1] || "",
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
  const resp = await fetch(url);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`S2 API error: ${resp.status}`);
  const data = await resp.json();
  return data?.data?.[0] || null;
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
          const paper = await searchS2(entry.title);
          if (!paper) {
            result.status = "not_found";
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
        } catch (e) {
          result.status = "error";
        }

        // Stream each result as a JSON line
        controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"));

        // Small delay between S2 calls
        if (i < unique.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

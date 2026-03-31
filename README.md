# Citation Verifier

A web app that verifies BibTeX citations against [Semantic Scholar](https://www.semanticscholar.org/). Paste your `.bib` content and instantly check if your references are real and accurate.

**Live:** [citation-verifier-lime.vercel.app](https://citation-verifier-lime.vercel.app)

https://github.com/kobe0938/citation-verifier/raw/master/demo.mp4

## What it does

- Parses BibTeX entries and searches each one on Semantic Scholar
- Compares **title**, **year**, and **first author** between your bib and S2
- Shows side-by-side comparison with S2 ground truth (venue, ArXiv ID, DOI, full author list)
- Detects web resources (blogs, datasets) and verifies URLs are reachable instead
- Handles LaTeX in titles, nested braces, and deduplicates entries
- Streams results in real-time so you see progress as each citation is checked
- Export results as CSV for manual review

## Stack

- Next.js + TypeScript + Tailwind CSS
- Semantic Scholar API (free, no key needed)
- Hosted on Vercel

## Development

```bash
npm install
npm run dev
```

## Created by

[Kobe Chen](https://github.com/kobe0938)

// Generates an example document + its sibling comment note (with the JSON block
// the plugin reads). The anchor offsets are computed from the actual text
// so the highlights match.
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

const CONTEXT = 32; // same default as the plugin (settings.contextLength)
// Document path RELATIVE TO THE VAULT ROOT. The sibling note must also live at
// `<comments folder>/<this path>` relative to the vault root.
const DOC_VAULT_PATH = "examples/Example Comments.md";
const COMMENTS_FOLDER = "Comments";
const OUT_DOC = DOC_VAULT_PATH;
const OUT_SIDE = `${COMMENTS_FOLDER}/${DOC_VAULT_PATH}`;

const doc = `# Log Analysis Report

This example document is used to test the comments plugin. It contains headings, paragraphs, images, lists, tables, and code blocks — including pending and completed comments.

## Context

Reducing operational noise is essential for SOC efficiency. Type 3 logon events generate excessive volume and should be filtered at the source whenever possible.

![Architecture diagram](https://example.com/diagram.png)

## Methodology

Logs from 6 PM to 10 PM were analyzed. The query below was used to validate the observed reduction:

\`\`\`spl
index="example_fortigate" sourcetype=fortigate_traffic
| timechart span=15m count
\`\`\`

## Results

The results showed a 62% reduction in event volume after applying the filter. The table below summarizes the collected numbers:

| Period | Before | After |
| --- | --- | --- |
| 6 PM-7 PM | 12000 | 4600 |
| 7 PM-8 PM | 11500 | 4300 |

> Note: values are approximate and may vary depending on the analyzed environment.

## Conclusion

The source filtering strategy proved effective and should be extended to the other monitored indexes.
`;

const t = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();

// Example comments (mix of pending and completed).
const specs = [
  {
    quote: "Reducing operational noise",
    body: "We need to define the noise metric before validating the reduction.",
    done: false,
    history: [{ at: t(2026, 6, 10, 9, 15), action: "created" }],
  },
  {
    quote: "Type 3 logon events",
    body: "Confirmed with the infra team: type 3 can be filtered at the source.",
    done: true,
    history: [
      { at: t(2026, 6, 10, 9, 20), action: "created" },
      { at: t(2026, 6, 11, 14, 30), action: "done" },
    ],
  },
  {
    quote: "## Methodology",
    body: "Methodology reviewed and approved by the coordination.",
    done: true,
    history: [
      { at: t(2026, 6, 10, 10, 0), action: "created" },
      { at: t(2026, 6, 10, 10, 5), action: "edited" },
      { at: t(2026, 6, 12, 8, 0), action: "done" },
    ],
  },
  {
    quote: "62% reduction",
    body: "Recalculate: the comparison baseline seems to include the peak hour.",
    done: false,
    history: [{ at: t(2026, 6, 11, 11, 0), action: "created" }],
  },
  {
    quote: "values are approximate and may vary",
    body: "Add the estimated margin of error for the final number.",
    done: false,
    history: [{ at: t(2026, 6, 12, 10, 0), action: "created" }],
  },
];

const comments = specs.map((s, i) => {
  const idx = doc.indexOf(s.quote);
  if (idx === -1) throw new Error(`Passage not found: ${s.quote}`);
  const prefix = doc.slice(Math.max(0, idx - CONTEXT), idx);
  const suffix = doc.slice(idx + s.quote.length, idx + s.quote.length + CONTEXT);
  const created = s.history[0].at;
  const modified = s.history[s.history.length - 1].at;
  return {
    id: `ex${i + 1}-${created.toString(36)}`,
    quote: s.quote,
    prefix,
    suffix,
    body: s.body,
    ...(s.done ? { done: true } : {}),
    history: s.history,
    created,
    modified,
  };
});

// ---- sibling note (same format as store.ts) ----
const ACTION_LABEL = {
  created: "created",
  edited: "edited",
  done: "completed",
  reopened: "reopened",
};
const fmt = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const L = [];
L.push("---");
L.push(`source: "${DOC_VAULT_PATH}"`);
L.push("tags: [note-comments]");
L.push("---");
L.push("");
L.push(`# Comments — Example Comments`);
L.push("");
for (const c of comments) {
  const q = c.quote.replace(/\s+/g, " ").trim().slice(0, 120);
  L.push(`> [!${c.done ? "success" : "quote"}] ${q}`);
  for (const bl of c.body.split("\n")) L.push(`> ${bl}`);
  L.push(">");
  L.push("> **History:**");
  for (const e of c.history) L.push(`> - ${fmt(e.at)} — ${ACTION_LABEL[e.action]}`);
  L.push("");
}
L.push("%%");
L.push("TEXT_COMMENTS_DATA");
L.push(JSON.stringify(comments, null, 2));
L.push("%%");
L.push("");

mkdirSync(dirname(OUT_DOC), { recursive: true });
mkdirSync(dirname(OUT_SIDE), { recursive: true });
writeFileSync(OUT_DOC, doc);
writeFileSync(OUT_SIDE, L.join("\n"));

console.log(`OK: ${OUT_DOC}`);
console.log(`OK: ${OUT_SIDE}`);
console.log(`Comments: ${comments.filter((c) => !c.done).length} pending, ${comments.filter((c) => c.done).length} completed`);

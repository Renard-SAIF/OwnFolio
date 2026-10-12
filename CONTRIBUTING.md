# Contributing

This is a deliberately thin project — contributions welcome. 🙌

Everything here rests on one idea: **do not rebuild what the user already has, and never hold their data.** Please read the three non-negotiables before you open a PR.

## Ways to help

- **Bug reports** — especially "it can't read my library". Include the error, but **redact your sheet token and your deal data first**.
- **New storage adapters** — support for another spreadsheet backend, in `skill/references/storage-adapters.md`.
- **Better dashboards** — improve `skill/scripts/render_dashboard.py` or the template in `skill/assets/dashboard-template.html`.
- **Clearer extraction** — sharpen `skill/references/extraction-prompt.md` and `skill/SKILL.md`.
- **Docs and translations** — install steps that were wrong or unclear for you are worth fixing.
- **Bug fixes** — broken scripts, wrong metric math, typos.

## Three non-negotiables

A change that breaks one of these will almost certainly not be merged.

1. **No data storage.** Every read and write must be delegated to a platform the user already owns (Feishu, DingTalk, a local file…). This project must not ship a database, and must not hold a single row of user data.
2. **No secrets.** No token, endpoint, app id or account may be hardcoded in any file.
3. **Dashboards stay zero-dependency.** The generated HTML must not reference any external framework, font or charting library. Icons and charts are hand-written inline SVG — no emoji.

## How to contribute

1. Fork the repo.
2. Create a branch: `git checkout -b my-improvement`.
3. Make your change. Keep it to one concern.
4. Commit with a clear message.
5. Open a Pull Request describing what and why. A screenshot of a rendered dashboard is very welcome.

## Changing fields or metric definitions — read this first

The 22 fields in `schema.md` and the metric definitions in `analysis-rules.md` are a **contract with every library that already exists**. Change them carelessly and existing users silently mis-read or mis-count.

- **Adding a field** — fine, but it needs a default, and libraries created earlier must still work when the value is empty.
- **Renaming a field** — do not change the English standard name. The localised label can change; the English name is the only anchor.
- **Changing a metric** (for example what goes in the denominator of hit rate) — you must also update `analysis-rules.md` and say *why*. Metrics that drift make a user's miss list meaningless.

## Working on the scripts

- **Standard library only.** `render_dashboard.py` is currently dependency-free — keep it that way.
- `init_sheet.py` needs `openpyxl` to write Excel. That is the **only** optional dependency allowed, and the fallback path (emit CSV when openpyxl is missing) must stay.
- Before you commit, run `python scripts/render_dashboard.py --demo --out demo.html`, open it, and confirm **all eight blocks render and the console is clean**.

## Never commit these

`references/current-library.md` is your local file — it records *where your own library is*, including its token. It is already in `.gitignore`; **do not force-add it.** The same goes for any local cloud config: no tokens, no endpoints, no account ids.

Questions or ideas? Open an issue. First-time contributors and small PRs are very welcome.

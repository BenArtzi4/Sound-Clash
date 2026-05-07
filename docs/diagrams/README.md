# Sound Clash — Diagrams

Visual companions to the architecture docs. Each diagram exists in two forms:

- **`*.md`** — Mermaid source embedded in Markdown. Renders inline on GitHub, in VSCode (Markdown Preview Mermaid plugin), and on most static-site renderers. Use this in code reviews and PRs.
- **`*.html`** — standalone HTML that loads Mermaid from a CDN. Open in a browser when you want a full-screen view, or send the file to someone who can't open the GitHub UI.

| File | Shows |
|---|---|
| [`internal.md`](internal.md) / [`internal.html`](internal.html) | What's inside the running game: browser ↔ FastAPI ↔ Supabase, the buzzer hot path, the auth split |
| [`external.md`](external.md) / [`external.html`](external.html) | The third-party services that surround the game: hosting, CI/CD, error tracking, dependency bots, DNS |

## Why two formats

The `.md` files are the source of truth — they're text, version-controlled, and edits land in the same PR as the code change that motivated them. The `.html` files are conveniences for situations where Mermaid-in-Markdown isn't an option (sharing with non-developers, presenting on a projector, opening offline). Both files render the **same** Mermaid source — keep them in sync when editing.

## Updating a diagram

1. Edit the `mermaid` block in the `.md` file.
2. Open the corresponding `.html` file and copy the same Mermaid source into the `<pre class="mermaid">` block.
3. Open the `.html` locally in a browser to verify the diagram renders.
4. Commit both files in the same change.

## Where the HTML versions live

The whole `docs/` directory is published via GitHub Pages from `main`. The HTML diagrams render at:

- `https://benartzi4.github.io/Sound-Clash/diagrams/internal.html`
- `https://benartzi4.github.io/Sound-Clash/diagrams/external.html`

The `.md` versions still render natively on GitHub at `github.com/BenArtzi4/Sound-Clash/blob/main/docs/diagrams/internal.md` — that's the source of truth and what code reviews comment on. The published HTML is a convenience for sharing, presenting, or browsing offline (`open docs/diagrams/internal.html` in a browser works without any server).

# Claude Code rules for Sound-Clash

## Git workflow

- **Never commit, push, or work directly on `main`.** Create a branch first for every change, no matter how small.
- **Push freely.** Pushing branches and force-pushing your own feature branches is fine without asking.
- **Open PRs freely.** Use `gh pr create` without asking for permission.
- **Never merge a PR.** Merging is the user's decision. Do not run `gh pr merge`, do not click "merge" via API, do not squash/rebase-merge from the CLI. Open the PR and stop.
- **Never force-push to `main`** under any circumstance.
- **Never delete branches** (local or remote) without explicit permission.
- **Never modify `.github/workflows/`** (CI config) without flagging it first — CI changes affect everyone.
- **Never close or comment on PRs/issues** the user didn't ask you to touch.

## Commit messages

- **One line maximum.** Subject only. No body, no bullets, no extra paragraphs.
- **No AI attribution anywhere.** Do not add `Co-Authored-By: Claude ...` trailers. Do not write "Generated with Claude Code", "🤖", or similar in commit messages, PR titles, or PR bodies. The repo should look human-authored.
- Pass commits inline: `git commit -m "short subject"`.

## PR descriptions

- The default `## Summary` + `## Test plan` template is fine.
- No AI footer, no emoji that signals AI authorship.

## Branch naming

- Use `feature/<short-name>` for new features and `fix/<short-name>` for bug fixes. Keeps the branch list scannable.

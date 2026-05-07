# Security Policy

## Reporting a vulnerability

**Please don't open a public GitHub issue for security bugs.**

Email **benartzi4@gmail.com** with `[SECURITY] Sound Clash` in the subject. Include:

- A description of the issue
- Steps to reproduce
- The version (commit SHA or tag) where you observed it
- Your assessment of the impact

I'll acknowledge within 7 days and provide a target fix timeline within 14 days. Researchers acting in good faith will be credited (or kept anonymous on request) once the issue is fixed.

## Supported versions

| Version | Supported |
|---|---|
| latest `main` | ✅ |
| anything else | ❌ fix forward in `main` |

This is a small project; there are no LTS branches.

## Threat model

The system has a deliberately small attack surface (no PII, no payments, no user accounts, ephemeral data). The full threat model is in [`docs/security-rls.md`](docs/security-rls.md) §4. Headline concerns:

- Service-role key leakage (the only true secret)
- Game-code enumeration (low impact; a known limitation)
- DoS on free-tier infrastructure
- XSS via team-name input

## What's NOT in scope

- Vulnerabilities in third-party services we depend on (Supabase, Render, Cloudflare). Report those upstream.
- Bugs that require physical access to the host's device.
- Reports about missing best practices that don't lead to an exploit (e.g., "you should use header X"). Open an issue or PR for those.

## Disclosure policy

Coordinated disclosure preferred. I'll work with the reporter on a public disclosure timeline once a fix is available, typically 30–90 days after the report.

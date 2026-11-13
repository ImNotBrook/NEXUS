# NEXUS Skill Intelligence

## Purpose

Skill Intelligence is the governed catalogue for external trading, quantitative research and software-engineering methods. It separates discovery from trust and trust from execution.

## Current implementation

- Typed metadata records capture the GitHub repository, version, declared licence, last commit time, stars, open issues, capabilities, test/documentation claims, security-review state and provenance.
- New records are quarantined unless their metadata meets the catalogue's review-readiness checks.
- Approval eligibility requires an allowlisted licence (MIT, Apache-2.0, BSD-2-Clause or BSD-3-Clause), a repository commit within the preceding 365 days, non-negative repository counters, unique capabilities, verified tests and documentation, a completed security review and provenance.
- Human approval requires a named reviewer, rationale and timestamp. Approval creates a separate versioned record; it does not overwrite the discovered record.
- IndexedDB persistence is local to the device and append-only by record ID.
- The catalogue does not download, import, evaluate or execute repository code.

## Trust boundaries

1. GitHub metadata and repository contents are untrusted input.
2. Repository claims (including tests, licence and security posture) must be independently checked before setting review fields.
3. Unknown or non-allowlisted licences remain quarantined. This is a project policy, not a legal opinion.
4. A repository's popularity or recent activity does not prove trading edge, correctness or security.
5. Approval means accepted as a reviewed knowledge/source candidate only. It does not mean strategy approval, production readiness or permission to place orders.
6. Trading safeguards, risk limits and execution permissions cannot be modified by skill discovery or self-improvement.

## Deliberate limitations

The current subsystem is a registry and governance foundation. It does not yet discover repositories automatically, clone code, run sandbox tests, install skills, update prompts or invoke an LLM. Those capabilities require separate threat modelling, isolation and explicit governance. No external repository code is trusted or executed.

## Review checklist

- Confirm canonical source repository and exact version/commit.
- Inspect the licence file and compatibility; do not infer a licence from a README badge.
- Inspect recent commit history, release cadence and unresolved issues.
- Verify tests exist and run them in an isolated environment before any future code adoption.
- Inspect dependencies, install scripts, network access, credential access and obfuscated/dynamic code.
- Verify documentation describes actual behaviour.
- Record provenance and security findings.
- Require a human decision; keep the skill non-executable.

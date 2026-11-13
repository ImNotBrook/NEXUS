# Open-source research and reuse audit

Checked 2026-11-14. Counts and repository activity change over time; re-check before adopting any dependency.

| Repository | Stars at check | Last pushed | License | Decision |
|---|---:|---|---|---|
| [freqtrade/freqtrade](https://github.com/freqtrade/freqtrade) | ~56.8k | 2026-11-12 | GPL-3.0 | Study FreqAI retraining, feature engineering and backtesting design. Do not copy code into the MIT NEXUS repository without a deliberate licensing decision. Python service and dependency footprint are not suitable for the first Android-only PWA. |
| [kernc/backtesting.py](https://github.com/kernc/backtesting.py) | ~9.2k | 2026-08-05 | AGPL-3.0 | Reference its event-driven backtest concepts and reporting. Do not embed its code in NEXUS; AGPL obligations are incompatible with casual reuse in this MIT project. |
| [polakowo/vectorbt](https://github.com/polakowo/vectorbt) | ~9.8k | 2026-11-11 | Fair-Code badge / API metadata NOASSERTION | Useful research reference, but do not assume permissive open-source terms. Its own README distinguishes the community edition from VectorBT PRO. No dependency adopted. |
| [marketcalls/vectorbt-backtesting-skills](https://github.com/marketcalls/vectorbt-backtesting-skills) | 224 | 2026-07-12 | No root LICENSE file found | Relevant skill-pack structure and market-specific cost/robustness topics. No code or skill text copied because the repository's reuse licence could not be verified. |
| [anthropics/skills](https://github.com/anthropics/skills) | ~194k | 2026-11-06 | README says many individual skills are Apache-2.0; no root LICENSE found | Reference the folder-based SKILL.md format and frontmatter convention. Do not assume every file is Apache-licensed or copy skill content without checking its specific notice. |
| [harbor-framework/harbor](https://github.com/harbor-framework/harbor) | ~7.0k | 2026-11-13 | Apache-2.0 | Potential future agent evaluation harness reference. Not adopted now: Docker and external model/environment providers conflict with the phone-only, zero-cost first phase. |

## Reuse decision

NEXUS's active agent skills are original project-authored instructions under .agents/skills. The skills use a small frontmatter format with a unique name and trigger description, then explicit workflow, safety rules and output requirements.

External repositories are research references, not unreviewed code sources. Before adopting a dependency, re-check the exact licence file, release activity, issue backlog, dependency graph, platform fit and operating cost. A permissive licence does not by itself make a dependency operationally suitable.

# Free AI provider research and integration

Updated: 2026-11-14

## Decision

NEXUS uses a provider-neutral, sequential failover adapter for strategy-research proposals. It accepts only credentials issued to the NEXUS owner and stored as GitHub Actions secrets. It does not scrape, collect, publish, or reuse API keys from GitHub repositories.

The discovery catalogues are useful for finding providers, not for proving that a provider is free or safe to use. Every provider must be checked against its own current pricing, rate-limit, eligibility and data-use documentation before it is enabled.

## GitHub directories reviewed

| Repository | Licence | Activity observed | Use |
|---|---|---|---|
| [pacocartones/free-llm-api-hub](https://github.com/pacocartones/free-llm-api-hub) | MIT | 121 stars, 52 forks, 79 open issues; pushed 2026-11-13 | Preferred machine-readable discovery source. Its dataset separates ongoing tiers from trial credits and records verification dates, source URLs, card/phone requirements and data policy. |
| [open-free-llm-api/awesome-freellm-apis](https://github.com/open-free-llm-api/awesome-freellm-apis) | MIT | 5,593 stars, 878 forks, 4 open issues; pushed 2026-11-13 | Broad secondary catalogue with 500+ listed model entries and provider setup examples. Treat its model counts as catalogue claims, not a guarantee of current availability. |
| [cheahjs/free-llm-api-resources](https://github.com/cheahjs/free-llm-api-resources) | Check upstream before reuse | Curated list discovered through search | Secondary discovery list; explicitly excludes reverse-engineered chatbot access and other illegitimate services. |

The preferred dataset was version 2.11.0, generated 2026-11-13, and contained 68 provider records when inspected. It is MIT-licensed. Its maintainer distinguishes verified core claims from community-sourced entries that still need confirmation.

## Providers suitable for the initial $0-first pool

These are candidates, not a promise of unlimited or permanent capacity. Limits can change. Confirm the account's own console before relying on a quota.

| Provider | Free access found | Key constraints | NEXUS status |
|---|---|---|---|
| Groq | Free open-model inference; e.g. GPT-OSS 120B | Official docs list 30 RPM, 1,000 RPD, 8K TPM and 200K TPD for GPT-OSS 120B/20B and Qwen 3.8 27B. Phone verification may be required; no card required in the reviewed directory. | Supported; first default. |
| Google Gemini API | Free AI Studio quota for selected Gemini models, including Gemini 2.5 Flash and Flash-Lite | Per-model limits vary and are displayed in AI Studio. Google says content submitted through unpaid services may be used to improve its products. Do not send secrets or private account data. | Supported; default fallback. |
| Z.ai / GLM | GLM-4.7-Flash and other Flash models listed at $0 | Public rate limits are not stated clearly; inspect the account console and terms. | Supported; default fallback. |
| Cloudflare Workers AI | 10,000 Neurons/day on the Workers Free plan | Some models require a paid plan. The default model is selected from the free-model catalogue; requests stop when the free allocation is exhausted. Requires an account ID and API token. | Supported; default fallback. |
| NVIDIA NIM | Free hosted prototyping endpoints for Developer Program members | Phone verification; rate limits and model availability vary; provider terms describe prototyping/development access rather than an unrestricted production tier. | Supported only when explicitly added to provider order; not a default provider. |

### Providers deliberately not in the default route

- **OpenRouter:** free models exist, but the reviewed limits were 50 requests/day until a $10 lifetime top-up; the higher quota requires spending. NEXUS must not top up.
- **Cohere:** evaluation/trial access; the reviewed terms mark commercial use as not allowed.
- **Mistral Free mode:** evaluation/prototyping access, phone verification and prompt-training terms; not selected as a production research dependency.
- **SambaNova:** a free tier is listed, but the reviewed directory did not confirm card and phone requirements. Do not enable until account eligibility is checked.
- **Cerebras:** public sources conflicted on whether current free access is a durable tier or a time-limited credit requiring a payment method. Excluded until reconciled with the live account and official terms.
- **Hugging Face Inference Providers:** the reviewed free-user allowance was zero monthly inference credits.
- **GitHub Models:** the reviewed source reported the inference API was retired on 2026-07-30.
- **AI Horde:** public crowdsourced queueing is not a predictable, low-latency research dependency.

## NEXUS provider routing

The automated research workflow supports these optional credentials:

| GitHub Actions secret | Provider |
|---|---|
| `GROQ_API_KEY` | Groq |
| `GEMINI_API_KEY` | Google Gemini |
| `ZAI_API_KEY` | Z.ai |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI |
| `NVIDIA_API_KEY` | NVIDIA NIM (prototype-only; opt in explicitly) |

Additional repository variables:

| Variable | Purpose |
|---|---|
| `NEXUS_AI_PROVIDER_ORDER` | Optional comma-separated provider order. Default: `groq,gemini,zai,cloudflare`. Add `nvidia` only if its prototype-only restrictions are acceptable. |
| `GROQ_MODEL`, `GEMINI_MODEL`, `ZAI_MODEL`, `CLOUDFLARE_AI_MODEL`, `NVIDIA_MODEL` | Optional model overrides. Defaults are defined in the adapter. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID; not an API credential. |

Add keys only under GitHub repository Settings → Secrets and variables → Actions. Never paste keys into ChatGPT, source files, issue comments, logs or the public paper-ledger branch. Never add a payment method or activate a paid plan to obtain a key.

Routing is sequential. NEXUS tries the first configured provider, validates the response against the existing bounded strategy-proposal parser, then stops on success. HTTP 429, provider errors, network errors and invalid output move to the next configured provider. If all configured providers fail, deterministic research continues. Reports record provider IDs and safe failure categories only; credentials and raw provider response bodies are not written to artifacts.

## Research-only boundary

AI output remains restricted to parameter proposals for the existing SMA crossover, RSI mean-reversion and Donchian breakout templates. NEXUS does not execute model-generated code, accept generated orders, change risk controls, promote winners automatically or enable live trading. Every candidate still goes through the deterministic research/backtest pipeline. The paper-trading agent remains separately disabled until an exact configuration is approved.

The current implementation is not an autonomous self-learning strategy engine. It is multi-provider assistance for bounded hypothesis generation with deterministic fallback and human-governed evaluation.

## Sources

- [Groq official rate limits](https://console.groq.com/docs/rate-limits)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API pricing and unpaid-tier data use](https://ai.google.dev/gemini-api/docs/pricing)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [NVIDIA NIM developer access FAQ](https://docs.api.nvidia.com/nim/docs/product)
- [Free LLM API Hub dataset and methodology](https://github.com/pacocartones/free-llm-api-hub)
- [Awesome Free LLM APIs](https://github.com/open-free-llm-api/awesome-freellm-apis)

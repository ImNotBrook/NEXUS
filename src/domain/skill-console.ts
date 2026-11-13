import { SkillRegistryStore } from "../adapters/skill-registry-store";
import { getSeedSkillCandidates } from "./skill-catalogue";
import { approveSkill, createSkillRecord, rejectSkill, type SkillRecord } from "./skill-intelligence";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, value?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function field(label: string, input: HTMLInputElement | HTMLTextAreaElement): HTMLLabelElement {
  const wrapper = node("label", "skill-field", label);
  wrapper.append(input);
  return wrapper;
}

export function mountSkillConsole(container: HTMLElement): void {
  container.innerHTML = `
    <section class="panel skill-console" aria-labelledby="skill-console-title">
      <span class="panel-label">SKILL INTELLIGENCE</span>
      <h2 id="skill-console-title">External skill registry</h2>
      <p>Source-backed research references. Inspect the pinned revision before attesting to tests, documentation or security. Approval is a metadata decision only; external code is never installed or executed.</p>
      <div class="skill-summary" id="skill-summary" role="status">Loading local registry…</div>
      <div id="skill-list" class="skill-list" aria-live="polite"></div>
      <p class="small">Registry data is stored in this browser on this device. It is not synced or backed up. Rejected and approved records are append-only; the original discovery record remains unchanged.</p>
    </section>`;
  const list = container.querySelector<HTMLElement>("#skill-list");
  const summary = container.querySelector<HTMLElement>("#skill-summary");
  if (!list || !summary) return;
  const store = new SkillRegistryStore();

  const refresh = async (): Promise<void> => {
    try {
      const existing = await store.list(500);
      const known = new Set(existing.map((record) => record.id));
      for (const candidate of getSeedSkillCandidates()) {
        if (!known.has(candidate.id)) await store.register(candidate);
      }
      const records = await store.list(500);
      const latestBySource = new Map<string, SkillRecord>();
      for (const record of records) {
        const sourceId = record.id.split("@")[0];
        const previous = latestBySource.get(sourceId);
        if (!previous || (record.reviewedAt ?? record.discoveredAt) > (previous.reviewedAt ?? previous.discoveredAt)) {
          latestBySource.set(sourceId, record);
        }
      }
      const visible = [...latestBySource.values()].sort((a, b) => a.name.localeCompare(b.name));
      const quarantined = visible.filter((record) => record.status === "quarantined").length;
      const approved = visible.filter((record) => record.status === "approved").length;
      const rejected = visible.filter((record) => record.status === "rejected").length;
      summary.textContent = `${visible.length} candidates · ${quarantined} quarantined · ${approved} approved · ${rejected} rejected · execution disabled for all`;
      list.replaceChildren();

      for (const candidate of visible) {
        const card = node("article", "skill-card");
        const heading = node("div", "skill-card-heading");
        const title = node("h3", "", candidate.name);
        const status = node("span", "skill-status", candidate.status.toUpperCase());
        status.dataset.status = candidate.status;
        heading.append(title, status);
        card.append(heading);
        card.append(node("p", "skill-description", candidate.description));

        const meta = node("div", "skill-meta");
        for (const [label, value] of [
          ["LICENCE", candidate.license],
          ["PINNED REVISION", candidate.version],
          ["STARS", candidate.stars.toLocaleString()],
          ["OPEN ISSUES", String(candidate.openIssues)],
          ["LAST COMMIT", new Date(candidate.lastCommitAt).toISOString().slice(0, 10)],
        ]) {
          const item = node("div", "skill-meta-item");
          item.append(node("span", "", label), node("strong", "", value));
          meta.append(item);
        }
        card.append(meta);
        const capabilities = node("p", "skill-capabilities", "CAPABILITIES · " + candidate.capabilities.join(" · "));
        card.append(capabilities);
        const repoLink = node("a", "skill-repo-link", "Inspect source repository ↗");
        repoLink.href = candidate.repositoryUrl + "/tree/" + candidate.version;
        repoLink.target = "_blank";
        repoLink.rel = "noopener noreferrer";
        card.append(repoLink);
        card.append(node("p", "small", "Tests: " + (candidate.hasTests ? "verified" : "not verified") +
          " · Docs: " + (candidate.hasDocumentation ? "verified" : "not verified") +
          " · Security: " + (candidate.securityReviewed ? "reviewed" : "not reviewed") +
          " · Executable: NO"));

        if (candidate.status === "quarantined" || candidate.status === "review-required") {
          const form = node("form", "skill-review-form");
          const reviewer = node("input");
          reviewer.name = "reviewer";
          reviewer.required = true;
          reviewer.minLength = 2;
          reviewer.placeholder = "Reviewer identity";
          const rationale = node("textarea");
          rationale.name = "rationale";
          rationale.required = true;
          rationale.minLength = 10;
          rationale.rows = 2;
          rationale.placeholder = "Review rationale (minimum 10 characters)";
          const checks = node("div", "skill-review-checks");
          const tests = node("input"); tests.type = "checkbox"; tests.name = "tests";
          const docs = node("input"); docs.type = "checkbox"; docs.name = "docs";
          const security = node("input"); security.type = "checkbox"; security.name = "security";
          const checkLabel = (input: HTMLInputElement, text: string): HTMLLabelElement => {
            const label = node("label", "skill-check", text); label.prepend(input); return label;
          };
          checks.append(
            checkLabel(tests, "I inspected and verified the pinned revision's automated tests"),
            checkLabel(docs, "I inspected and verified the repository documentation"),
            checkLabel(security, "I completed a security and dependency review"),
          );
          form.append(field("Reviewer", reviewer), field("Rationale", rationale), checks);
          const actions = node("div", "skill-review-actions");
          const approve = node("button", "skill-approve", "Approve after review");
          approve.type = "submit";
          const reject = node("button", "skill-reject", "Reject candidate");
          reject.type = "button";
          actions.append(approve, reject);
          form.append(actions);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!tests.checked || !docs.checked || !security.checked) {
              summary.textContent = "Approval blocked: verify tests, documentation and security review first.";
              return;
            }
            approve.disabled = true;
            const reviewed = createSkillRecord({
              ...candidate, hasTests: true, hasDocumentation: true, securityReviewed: true,
            });
            try {
              const approved = approveSkill(reviewed, reviewer.value, rationale.value, Date.now());
              void store.register(approved).then(refresh).catch((error: unknown) => {
                summary.textContent = error instanceof Error ? error.message : "Could not save approval";
                approve.disabled = false;
              });
            } catch (error) {
              summary.textContent = error instanceof Error ? error.message : "Approval rejected";
              approve.disabled = false;
            }
          });
          reject.addEventListener("click", () => {
            if (reviewer.value.trim().length < 2 || rationale.value.trim().length < 10) {
              summary.textContent = "Rejection requires reviewer identity and a rationale of at least 10 characters.";
              return;
            }
            reject.disabled = true;
            try {
              const rejected = rejectSkill(candidate, reviewer.value, rationale.value, Date.now());
              void store.register(rejected).then(refresh).catch((error: unknown) => {
                summary.textContent = error instanceof Error ? error.message : "Could not save rejection";
                reject.disabled = false;
              });
            } catch (error) {
              summary.textContent = error instanceof Error ? error.message : "Rejection failed";
              reject.disabled = false;
            }
          });
          card.append(form);
        } else {
          card.append(node("p", "skill-review-outcome",
            candidate.status === "approved"
              ? "Human review approved by " + candidate.approvedBy + " · " + candidate.approvalRationale
              : "Rejected by " + candidate.rejectedBy + " · " + candidate.approvalRationale));
        }
        list.append(card);
      }
    } catch (error) {
      summary.textContent = error instanceof Error ? error.message : "Skill registry unavailable";
    }
  };
  void refresh();
}

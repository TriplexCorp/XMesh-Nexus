#!/usr/bin/env python3
from pathlib import Path

SHA="b71c0d0c641b5e0f6a60785586486b18dbb45db3"
PR=152
EXACT_RUN="41026817409"
POST_RUN="41028000453"
POST_BACKEND="41028000376"

checkpoint=(
    f"**Latest verified production rollout-plan acceptance checkpoint:** [`{SHA}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{SHA}), merge of [PR #{PR}](https://github.com/TriplexCorp/XMesh-Nexus/pull/{PR}). "
    f"Exact-head rollout-plan contract run `{EXACT_RUN}` and post-merge run `{POST_RUN}` completed **success**; post-merge Backend CI `{POST_BACKEND}` also completed **success**. "
    "The verifier requires an exact release candidate plus accepted P0-E security-review/physical-qualification evidence, a post-P0-E final canary, explicit topology/DNS/firewall/Nginx/PostgreSQL/key/observability/rollback dispositions and independent plan review. It never executes deployment changes. "
    "**This is rollout-plan acceptance tooling only: `productionActivation=false`, `strictPQEnabled=false`, legacy XMESH1 remains retained, and a real exact-candidate reviewed rollout plan cannot become eligible until P0-E and the final canary are complete.**\n\n"
)

for name in ("README.md","README.en.md"):
    p=Path(name); text=p.read_text()
    if "Latest verified production rollout-plan acceptance checkpoint" in text:
        raise SystemExit(f"{name}: rollout checkpoint already present")
    anchor="**Latest verified disposable release-canary rehearsal checkpoint:**"
    s=text.find(anchor)
    if s<0: raise SystemExit(f"{name}: missing canary anchor")
    e=text.find("\n\n",s)
    if e<0: raise SystemExit(f"{name}: malformed canary paragraph")
    e+=2
    text=text[:e]+checkpoint+text[e:]

    old=("The disposable release-canary rehearsal harness is COMPLETE as preparation only; the exact post-P0-E release candidate must rerun it before the final canary gate can be satisfied. "
         "Neither a handoff, an individual gate nor green CI authorizes production rollout.**")
    new=("The disposable release-canary rehearsal harness and production rollout-plan acceptance tooling are COMPLETE as preparation only; the exact post-P0-E release candidate must rerun the canary and then supply a separately reviewed real rollout/rollback plan before activation can be considered. "
         "Neither a handoff, an individual gate nor green CI authorizes production rollout.**")
    if text.count(old)!=1: raise SystemExit(f"{name}: status fragment count != 1")
    text=text.replace(old,new,1)

    docs_anchor="- [XSP-v2 P0-E ML-DSA-65 FIPS 204 ACVP vectors](docs/XSP_V2_P0E_MLDSA65_FIPS204_ACVP.md)\n"
    docs_line="- [XSP-v2 production rollout plan contract](docs/XSP_V2_PRODUCTION_ROLLOUT_PLAN.md)\n"
    if docs_line not in text:
        if text.count(docs_anchor)!=1: raise SystemExit(f"{name}: docs anchor count != 1")
        text=text.replace(docs_anchor,docs_anchor+docs_line,1)
    p.write_text(text)

p=Path("docs/ENTERPRISE_ROADMAP.md"); text=p.read_text()
if "Production rollout-plan acceptance / Nexus PR #152" in text:
    raise SystemExit("roadmap: rollout checkpoint already present")
anchor="- **Disposable release-canary rehearsal / Nexus PR #150:**"
s=text.find(anchor)
if s<0: raise SystemExit("roadmap: missing canary bullet")
e=text.find("\n",s)
if e<0: raise SystemExit("roadmap: malformed canary bullet")
e+=1
bullet=(
    f"- **Production rollout-plan acceptance / Nexus PR #152:** merge [`{SHA}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{SHA}) adds a non-executing fail-closed verifier for the separately reviewed exact-candidate topology/DNS/firewall/Nginx/PostgreSQL/key/observability/rollback plan. "
    f"Exact-head run `{EXACT_RUN}`, post-merge contract run `{POST_RUN}`, and post-merge Backend CI `{POST_BACKEND}` are **success**. The contract rejects plan eligibility unless P0-E, both external evidence domains, the final exact-candidate canary and independent plan review are all satisfied; this gate itself forces `productionActivation=false`, `strictPQEnabled=false` and legacy XMESH1 retained.\n"
)
text=text[:e]+bullet+text[e:]

old="| Production XSP-v2 rollout | **NOT AUTHORIZED** | P0-E + disposable canary + explicit production approval required |"
new=("| Production rollout-plan acceptance tooling | **COMPLETE — preparation only** | PR #152; fail-closed exact-candidate plan verifier exists, but a real reviewed plan remains ineligible until P0-E + final canary are complete |\n"
     "| Production XSP-v2 rollout | **NOT AUTHORIZED** | Close P0-E external blockers → exact candidate/re-freeze as needed → final canary → real independently reviewed rollout/rollback plan → separate explicit `strict-pq` activation approval |")
if text.count(old)!=1: raise SystemExit("roadmap: production row count != 1")
text=text.replace(old,new,1)

old_list="""Before production rollout:\n\n1. P0-D must remain complete with its fail-closed invariants intact;\n2. P0-E must be complete, including the external physical-power evidence and independent security review;\n3. after P0-E is complete, the exact release candidate must pass the disposable canary for install/upgrade/rollback/recovery/observability; PR #150 proves the harness is executable beforehand but does not satisfy this final-candidate gate;\n4. production topology/DNS/firewall/Nginx/DB/key changes require a separately reviewed rollout plan;\n5. `strict-pq` activation and legacy XMESH1 retirement require explicit approval and must never occur as an automatic fallback/migration side effect."""
new_list="""Before production rollout:\n\n1. P0-D must remain complete with its fail-closed invariants intact;\n2. P0-E must be complete, including the external physical-power evidence and independent security review;\n3. PR #150 provides the reusable disposable canary harness, but the exact post-P0-E release candidate must rerun it and satisfy the final canary gate;\n4. PR #152 provides the fail-closed rollout-plan verifier, but the real exact-candidate topology/DNS/firewall/Nginx/DB/key/observability/rollback plan must still receive separate independent review and become gate-eligible only after step 3;\n5. `strict-pq` activation requires a later separate explicit approval bound to that exact candidate/plan; legacy XMESH1 retirement remains a separate decision and neither action may occur as an automatic fallback/migration side effect."""
if text.count(old_list)!=1: raise SystemExit("roadmap: pre-rollout list count != 1")
text=text.replace(old_list,new_list,1)

security_line="- Bounded fuzz, NIST-vector, observability, review-handoff, reviewer-bundle and review-result validation gates do not replace independent security review.\n"
security_add="- PR #150 canary rehearsal and PR #152 rollout-plan validation are preparation gates only; neither can satisfy final release authorization before the external P0-E evidence is accepted.\n"
if security_add not in text:
    if text.count(security_line)!=1: raise SystemExit("roadmap: guardrail anchor count != 1")
    text=text.replace(security_line,security_line+security_add,1)

p.write_text(text)

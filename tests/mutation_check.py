"""
Deliberate-breakage check for the ClauseGuard money suite.

A suite that has never gone red is not evidence of anything. This script copies
the repo into a scratch dir, breaks one thing in the contract, runs the suite,
and records whether the break was caught. Every mutant below is a bug someone
could plausibly write: a double credit, a counter that stops moving, a dropped
authorization check.

Nothing here touches `contracts/clauseguard.py`. The mutation is applied to a
throwaway copy under /tmp, which is deleted whether or not the run succeeds.

    python3 tests/mutation_check.py     # exits non-zero if any mutant survives

Not collected by pytest (`python_files = test_*.py`), because it runs pytest
itself and nesting the two is a mess. Run it by hand after touching any money
path in the contract.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = "contracts/clauseguard.py"

# (name, what-should-catch-it, old, new)
MUTANTS = [
    (
        "settle credits the seller twice",
        "balance conservation",
        '        self._release(to_seller + to_buyer)\n        self._credit(deal["seller"], to_seller)\n        self._credit(deal["buyer"], to_buyer)',
        '        self._release(to_seller + to_buyer)\n        self._credit(deal["seller"], to_seller)\n        self._credit(deal["seller"], to_seller)\n        self._credit(deal["buyer"], to_buyer)',
    ),
    (
        "_credit forgets to bump total_credited",
        "the accounting invariant",
        "        self.payouts[payee] = u256(current + amount)\n        self.total_credited = u256(int(self.total_credited) + amount)",
        "        self.payouts[payee] = u256(current + amount)",
    ),
    (
        "_release forgets to decrement total_locked",
        "the accounting invariant",
        "            _fail(\"Accounting error: release exceeds locked funds\")\n        self.total_locked = u256(int(self.total_locked) - amount)",
        "            _fail(\"Accounting error: release exceeds locked funds\")",
    ),
    (
        "_retain drops the slashed half on the floor",
        "refund conservation",
        "        self.protocol_retained = u256(int(self.protocol_retained) + amount)",
        "        pass  # MUTANT: slashed wei never recorded",
    ),
    (
        "withdraw leaves the ledger entry in place",
        "double-withdraw tests",
        "        self.payouts[sender] = u256(0)\n        self.total_credited = u256(int(self.total_credited) - amount)",
        "        pass  # MUTANT: entry not zeroed",
    ),
    (
        "settle never persists the terminal status",
        "double-finalization tests",
        '            "buyer_collateral": "returned",\n            "credited_seller": str(to_seller),\n            "credited_buyer": str(to_buyer),\n        })\n        self.deals[deal_id] = json.dumps(deal)',
        '            "buyer_collateral": "returned",\n            "credited_seller": str(to_seller),\n            "credited_buyer": str(to_buyer),\n        })',
    ),
    (
        "settle_deal drops the party check (F2 regression)",
        "authorization tests",
        '        sender = str(gl.message.sender_address)\n        if sender != deal["seller"] and sender != deal["buyer"]:\n            _fail("Only deal parties can settle")',
        "        sender = str(gl.message.sender_address)",
    ),
    (
        "claim_refund drops the buyer-only check",
        "authorization tests",
        '        sender = str(gl.message.sender_address)\n        if sender != deal["buyer"]:\n            _fail("Only buyer can claim refund")',
        "        sender = str(gl.message.sender_address)",
    ),
    (
        "refund pays the buyer the whole seller bond",
        "the 50/50 slash tests",
        "        seller_to_buyer = seller_bond // 2",
        "        seller_to_buyer = seller_bond",
    ),
    (
        "fund_deal accepts zero value (N3 regression)",
        "funding-guard tests",
        '        value = int(gl.message.value)\n        if value <= 0:\n            _fail("Fund amount must be positive")',
        "        value = int(gl.message.value)",
    ),
    (
        "cancel_deal forgets to release the bond from locked",
        "cancel conservation",
        "        self._release(seller_bond)\n        self._credit(deal[\"seller\"], seller_bond)",
        "        self._credit(deal[\"seller\"], seller_bond)",
    ),
    (
        "propose_resolution executes on ONE signature (N8 regression)",
        "the two-signature tests",
        "        if not seller_choice or seller_choice != buyer_choice:\n            self.deals[deal_id] = json.dumps(deal)\n            return",
        "        if False:\n            self.deals[deal_id] = json.dumps(deal)\n            return",
    ),
    (
        "propose_resolution drops the party check",
        "resolution authorization tests",
        '        if not is_seller and not is_buyer:\n            _fail("Only deal parties can propose a resolution")',
        "        if not is_seller and not is_buyer:\n            is_buyer = True",
    ),
    (
        "propose_resolution accepts any outcome string",
        "the unknown-outcome test",
        '        if choice not in RESOLUTION_OUTCOMES:\n            _fail("Unknown resolution outcome")',
        "        pass  # MUTANT: outcome not validated",
    ),
    (
        "propose_resolution resolves a verified deal too",
        "the resolvable-status tests",
        '        if deal["status"] not in RESOLVABLE_STATUSES:\n            _fail("Deal is not in a resolvable state")',
        '        if deal["status"] in ("open",):\n            _fail("Deal is not in a resolvable state")',
    ),
    (
        "split loses the odd wei instead of giving it to the buyer",
        "the odd-wei rounding test",
        "        price_to_buyer = price - price_to_seller",
        "        price_to_buyer = price // 2",
    ),
    (
        "mutual release credits the price to both parties",
        "resolution conservation",
        '        self._release(price + seller_bond + buyer_bond)\n        self._credit(deal["seller"], to_seller)\n        self._credit(deal["buyer"], to_buyer)',
        '        self._release(price + seller_bond + buyer_bond)\n        self._credit(deal["seller"], to_seller)\n        self._credit(deal["buyer"], to_buyer + price)',
    ),
    (
        "_execute_resolution never writes the terminal status",
        "double-resolution tests",
        '        deal["status"] = "resolved"',
        '        pass  # MUTANT: status stays resolvable',
    ),
    (
        "mutual refund slashes the seller bond anyway",
        "the unslashed-bond test",
        "        to_seller = price_to_seller + seller_bond",
        "        to_seller = price_to_seller + seller_bond // 2",
    ),
    (
        "the verdict payload carries the model's prose again (N11 regression)",
        "the differently-worded-validators test",
        '                    "unmet_conditions": _pick_codes(\n                        parsed.get("unmet_conditions", []), UNMET_CONDITION_CODES\n                    ),',
        '                    "unmet_conditions": _pick_codes(\n                        parsed.get("unmet_conditions", []), UNMET_CONDITION_CODES\n                    ),\n                    "reasoning": str(parsed.get("reasoning", "")),',
    ),
    (
        "confidence is passed through uncoerced",
        "the confidence-casing test",
        '                    "confidence": _pick(\n                        parsed.get("confidence", "low"), CONFIDENCE_LEVELS, "low"\n                    ),',
        '                    "confidence": str(parsed.get("confidence", "low")),',
    ),
    (
        "_pick accepts whatever the model said",
        "the invented-confidence and invented-code tests",
        "    candidate = str(value).strip().lower()\n    if candidate in allowed:\n        return candidate\n    return default",
        "    return str(value).strip().lower()",
    ),
    (
        "_pick_codes leaves the order the model chose",
        "the unmet-order test",
        "    picked.sort()\n    return picked",
        "    return picked",
    ),
    (
        "_pick_codes keeps codes outside the vocabulary",
        "the unmet-filtering test",
        "        if code in allowed and code not in picked:",
        "        if code not in picked:",
    ),
    (
        "the deadline payload carries prose again",
        "the deadline-compares-only-codes test",
        '                    "reason_code": _pick(\n                        parsed.get("reason_code", ""), DEADLINE_REASON_CODES, fallback\n                    )',
        '                    "reason_code": _pick(\n                        parsed.get("reason_code", ""), DEADLINE_REASON_CODES, fallback\n                    ),\n                    "reasoning": str(parsed.get("reasoning", ""))',
    ),
]


def run_suite(workdir):
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests", "--ignore=tests/gltest",
         "--tb=no", "-rf", "-p", "no:cacheprovider"],
        cwd=workdir, capture_output=True, text=True,
    )
    tail = (proc.stdout + proc.stderr).strip().splitlines()
    summary = ""
    for line in reversed(tail):
        if re.search(r"\d+ (passed|failed|error)", line):
            summary = line.strip()
            break
    return proc.returncode, summary, proc.stdout + proc.stderr


def scratch():
    d = Path(tempfile.mkdtemp(prefix="cg-mutate-"))
    for item in ("contracts", "tests", "pytest.ini"):
        src = ROOT / item
        dst = d / item
        if src.is_dir():
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"))
        else:
            shutil.copy2(src, dst)
    return d


def main():
    print("=" * 74)
    print("BASELINE — unmutated contract, must be green")
    print("=" * 74)
    base = scratch()
    try:
        rc, summary, out = run_suite(base)
        print(f"  {summary or out[-400:]}")
        if rc != 0:
            print("\n  Baseline is RED. Fix the suite before mutating.")
            return 1
        print("  OK\n")
    finally:
        shutil.rmtree(base, ignore_errors=True)

    caught, missed = [], []
    for i, (name, expect, old, new) in enumerate(MUTANTS, 1):
        d = scratch()
        try:
            path = d / CONTRACT
            text = path.read_text()
            hits = text.count(old)
            if hits != 1:
                print(f"[{i:2}/{len(MUTANTS)}] {name}\n        SKIPPED — anchor matched {hits}x, not 1")
                missed.append((name, f"anchor matched {hits}x"))
                continue
            path.write_text(text.replace(old, new))
            rc, summary, out = run_suite(d)
            verdict = "CAUGHT " if rc != 0 else "SURVIVED"
            print(f"[{i:2}/{len(MUTANTS)}] {name}")
            print(f"        {verdict} — {summary}")
            print(f"        expected catcher: {expect}")
            if rc != 0:
                names = sorted(set(re.findall(r"^FAILED (\S+)", out, re.M)))
                for n in names[:6]:
                    print(f"          red: {n}")
                if len(names) > 6:
                    print(f"          ... and {len(names) - 6} more")
                caught.append(name)
            else:
                missed.append((name, "suite stayed green"))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    print("\n" + "=" * 74)
    print(f"RESULT: {len(caught)}/{len(MUTANTS)} mutants caught")
    print("=" * 74)
    for name, why in missed:
        print(f"  NOT CAUGHT: {name} ({why})")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())

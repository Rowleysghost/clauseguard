"""
State-machine tests for contracts/clauseguard.py, focused on milestone deals
plus a classic-flow regression. Run with:

    python3 tests/test_milestones.py

No dependencies beyond the stdlib — see gl_stub.py for how the GenVM surface
is faked.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gl_stub import Rollback, load_contract, new_contract

contract_mod, gl = load_contract()

SELLER = "0xseller"
BUYER = "0xbuyer"

APPROVED_HIGH = json.dumps({
    "conditions_met": True, "confidence": "high",
    "reasoning": "ok", "unmet_conditions": [],
})
REJECTED_HIGH = json.dumps({
    "conditions_met": False, "confidence": "high",
    "reasoning": "no", "unmet_conditions": ["x"],
})
REJECTED_LOW = json.dumps({
    "conditions_met": False, "confidence": "low",
    "reasoning": "unsure", "unmet_conditions": ["x"],
})


def as_sender(addr, value=0):
    gl.message.sender_address = addr
    gl.message.value = value


def set_verdict(verdict_json):
    gl.nondet.exec_prompt_result = verdict_json


def milestones_json(*shares, desc="Phase"):
    return json.dumps([
        {"description": f"{desc} {i + 1}", "share_bps": bps}
        for i, bps in enumerate(shares)
    ])


def make_deal(c, milestones="", collateral=0):
    as_sender(SELLER, value=collateral)
    return c.create_deal("Deliver the goods as agreed.", "10 GEN", "By 2026-12-31", "", 1, milestones)


def fund(c, deal_id, value):
    as_sender(BUYER, value=value)
    c.fund_deal(deal_id)


def get(c, deal_id):
    return json.loads(c.deals[deal_id])


def get_milestones(c, deal_id):
    return json.loads(get(c, deal_id)["milestones"])


def expect_rollback(fn, fragment):
    try:
        fn()
    except Rollback as e:
        assert fragment.lower() in str(e).lower(), f"wrong rollback: {e!r} (wanted {fragment!r})"
        return
    raise AssertionError(f"expected rollback containing {fragment!r}, none raised")


# ── create_deal validation ─────────────────────────────

def test_create_classic_unaffected():
    c = new_contract(contract_mod)
    deal_id = make_deal(c)
    assert get(c, deal_id)["milestones"] == ""


def test_create_rejects_bad_bps_sum():
    c = new_contract(contract_mod)
    expect_rollback(lambda: make_deal(c, milestones_json(5000, 4000)), "sum to exactly 10000")


def test_create_rejects_single_milestone():
    c = new_contract(contract_mod)
    expect_rollback(lambda: make_deal(c, milestones_json(10000)), "at least 2")


def test_create_rejects_too_many_milestones():
    c = new_contract(contract_mod)
    expect_rollback(lambda: make_deal(c, milestones_json(*([1000] * 11))), "too many milestones")


def test_create_rejects_zero_share():
    c = new_contract(contract_mod)
    expect_rollback(lambda: make_deal(c, milestones_json(10000, 0)), "positive")


def test_create_rejects_empty_description():
    c = new_contract(contract_mod)
    bad = json.dumps([
        {"description": "ok", "share_bps": 5000},
        {"description": "  ", "share_bps": 5000},
    ])
    expect_rollback(lambda: make_deal(c, bad), "description cannot be empty")


def test_create_rejects_non_array():
    c = new_contract(contract_mod)
    expect_rollback(lambda: make_deal(c, '{"description": "x"}'), "json array")


def test_create_rejects_oversized_blob():
    c = new_contract(contract_mod)
    blob = "[" + "x" * contract_mod.MAX_MILESTONES_BLOB_LEN + "]"
    expect_rollback(lambda: make_deal(c, blob), "blob too large")


# ── fund_deal amount freezing ──────────────────────────

def test_fund_amounts_sum_exactly_with_remainder():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(3333, 3333, 3334))
    funded = 1_000_003  # prime-ish to force rounding dust
    fund(c, deal_id, funded)
    ms = get_milestones(c, deal_id)
    amounts = [int(m["amount"]) for m in ms]
    assert amounts[0] == funded * 3333 // 10000
    assert amounts[1] == funded * 3333 // 10000
    assert sum(amounts) == funded, "last milestone must absorb the remainder"


def test_fund_with_collateral_splits_before_milestones():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000), collateral=100)
    fund(c, deal_id, 1101)  # 100 bond match + 1001 price
    deal = get(c, deal_id)
    assert deal["funded_amount"] == "1001"
    amounts = [int(m["amount"]) for m in get_milestones(c, deal_id)]
    assert amounts == [500, 501]


# ── classic methods reject milestone deals ─────────────

def test_classic_paths_guarded():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    fund(c, deal_id, 1000)
    as_sender(SELLER)
    expect_rollback(lambda: c.submit_evidence(deal_id, "other", "https://x.com", "d"),
                    "submit_milestone_evidence")
    expect_rollback(lambda: c.request_verification(deal_id), "request_milestone_verification")
    expect_rollback(lambda: c.settle_deal(deal_id), "settle_milestone")


def test_milestone_paths_reject_classic_deals():
    c = new_contract(contract_mod)
    deal_id = make_deal(c)
    fund(c, deal_id, 1000)
    as_sender(SELLER)
    expect_rollback(lambda: c.submit_milestone_evidence(deal_id, 0, "other", "https://x.com", "d"),
                    "not a milestone deal")
    expect_rollback(lambda: c.request_milestone_verification(deal_id, 0), "not a milestone deal")
    expect_rollback(lambda: c.settle_milestone(deal_id, 0), "not a milestone deal")


# ── sequential rule + release ──────────────────────────

def test_out_of_order_verification_rejected():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    fund(c, deal_id, 1000)
    as_sender(SELLER)
    expect_rollback(lambda: c.request_milestone_verification(deal_id, 1), "released first")
    expect_rollback(lambda: c.request_milestone_verification(deal_id, 2), "out of range")


def test_happy_path_to_settled():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(3000, 7000), collateral=50)
    fund(c, deal_id, 1050)
    set_verdict(APPROVED_HIGH)

    as_sender(SELLER)
    c.submit_milestone_evidence(deal_id, 0, "delivery_proof", "https://x.com/a", "phase 1 done")
    evidence = json.loads(get(c, deal_id)["evidence"])
    assert evidence[0]["milestone"] == "0"
    assert get(c, deal_id)["status"] == "funded", "evidence must not touch deal status"

    c.request_milestone_verification(deal_id, 0)
    assert get_milestones(c, deal_id)[0]["status"] == "verified"
    assert get(c, deal_id)["status"] == "funded"

    c.settle_milestone(deal_id, 0)
    assert get_milestones(c, deal_id)[0]["status"] == "released"
    assert get(c, deal_id)["status"] == "partially_settled"

    c.submit_milestone_evidence(deal_id, 1, "delivery_proof", "https://x.com/b", "phase 2 done")
    c.request_milestone_verification(deal_id, 1)
    c.settle_milestone(deal_id, 1)
    deal = get(c, deal_id)
    assert deal["status"] == "settled"
    settlement = json.loads(deal["settlement"])
    assert settlement["released"] == "all"
    assert settlement["seller_collateral"] == "returned"
    assert settlement["buyer_collateral"] == "returned"


def test_double_release_impossible():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    fund(c, deal_id, 1000)
    set_verdict(APPROVED_HIGH)
    as_sender(SELLER)
    c.submit_milestone_evidence(deal_id, 0, "other", "https://x.com", "d")
    c.request_milestone_verification(deal_id, 0)
    c.settle_milestone(deal_id, 0)
    expect_rollback(lambda: c.settle_milestone(deal_id, 0), "verified before release")


def test_settle_unverified_milestone_rejected():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    fund(c, deal_id, 1000)
    as_sender(SELLER)
    expect_rollback(lambda: c.settle_milestone(deal_id, 0), "verified before release")


def test_non_party_cannot_act():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    fund(c, deal_id, 1000)
    as_sender("0xrando")
    expect_rollback(lambda: c.submit_milestone_evidence(deal_id, 0, "other", "https://x.com", "d"),
                    "only deal parties")
    expect_rollback(lambda: c.request_milestone_verification(deal_id, 0), "only deal parties")
    expect_rollback(lambda: c.settle_milestone(deal_id, 0), "only deal parties")


# ── rejection, refund, pro-rata slash ──────────────────

def test_rejected_milestone_partial_refund_and_prorata_slash():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000), collateral=1001)
    fund(c, deal_id, 1001 + 2000)  # bond match + 2000 price
    as_sender(SELLER)
    set_verdict(APPROVED_HIGH)
    c.submit_milestone_evidence(deal_id, 0, "other", "https://x.com", "d")
    c.request_milestone_verification(deal_id, 0)
    c.settle_milestone(deal_id, 0)

    set_verdict(REJECTED_HIGH)
    c.submit_milestone_evidence(deal_id, 1, "other", "https://x.com/2", "d")
    c.request_milestone_verification(deal_id, 1)
    assert get(c, deal_id)["status"] == "rejected"
    # No more releases once rejected.
    expect_rollback(lambda: c.settle_milestone(deal_id, 1), "not in a releasable state")

    as_sender(BUYER)
    c.claim_refund(deal_id)
    deal = get(c, deal_id)
    assert deal["status"] == "refunded"
    s = json.loads(deal["settlement"])
    assert s["price_to"] == "split"
    assert s["released_to_seller"] == "1000"   # 5000 bps of 2000
    assert s["refunded_to_buyer"] == "1000"
    # slash_base = 1001 * 5000 // 10000 = 500; buyer 250, protocol 250, seller keeps 501
    assert s["seller_collateral_to_buyer"] == "250"
    assert s["seller_collateral_to_protocol"] == "250"
    assert s["seller_collateral_returned"] == "501"
    assert s["buyer_collateral"] == "returned"


def test_rejected_first_milestone_full_refund():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    fund(c, deal_id, 2000)
    as_sender(SELLER)
    set_verdict(REJECTED_HIGH)
    c.submit_milestone_evidence(deal_id, 0, "other", "https://x.com", "d")
    c.request_milestone_verification(deal_id, 0)
    as_sender(BUYER)
    c.claim_refund(deal_id)
    s = json.loads(get(c, deal_id)["settlement"])
    assert s["price_to"] == "buyer"
    assert s["refunded_to_buyer"] == "2000"
    assert s["released_to_seller"] == "0"


# ── disputes and attempt cap ───────────────────────────

def test_disputed_milestone_recovers_and_attempt_cap():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    fund(c, deal_id, 1000)
    as_sender(SELLER)
    c.submit_milestone_evidence(deal_id, 0, "other", "https://x.com", "d")

    set_verdict(REJECTED_LOW)
    c.request_milestone_verification(deal_id, 0)
    assert get(c, deal_id)["status"] == "disputed"
    assert get_milestones(c, deal_id)[0]["status"] == "disputed"

    # Disputed milestone re-verifies clean -> deal status restored.
    set_verdict(APPROVED_HIGH)
    c.request_milestone_verification(deal_id, 0)
    assert get(c, deal_id)["status"] == "funded"
    assert get_milestones(c, deal_id)[0]["status"] == "verified"
    assert get_milestones(c, deal_id)[0]["verification_attempts"] == "2"

    # Second milestone: exhaust the per-milestone attempt cap.
    c.settle_milestone(deal_id, 0)
    set_verdict(REJECTED_LOW)
    c.submit_milestone_evidence(deal_id, 1, "other", "https://x.com/2", "d")
    c.request_milestone_verification(deal_id, 1)
    c.request_milestone_verification(deal_id, 1)
    c.request_milestone_verification(deal_id, 1)
    expect_rollback(lambda: c.request_milestone_verification(deal_id, 1),
                    "maximum verification attempts")


def test_milestone_verification_scopes_evidence_and_prompt():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    fund(c, deal_id, 1000)
    as_sender(SELLER)
    c.submit_milestone_evidence(deal_id, 0, "other", "https://x.com/m0", "phase 1 proof")

    prompts = []

    def capture(prompt):
        prompts.append(prompt)
        return APPROVED_HIGH

    set_verdict(capture)
    c.request_milestone_verification(deal_id, 0)
    assert "MILESTONE UNDER REVIEW (milestone 1 of 2)" in prompts[0]
    assert "Phase 1" in prompts[0]

    c.settle_milestone(deal_id, 0)
    c.submit_milestone_evidence(deal_id, 1, "other", "https://x.com/m1", "phase 2 proof")
    c.request_milestone_verification(deal_id, 1)
    assert "milestone 2 of 2" in prompts[1]
    assert "https://x.com/m0" not in prompts[1], "milestone-0 evidence must not leak into milestone 1"


# ── counter-terms freeze after funding ─────────────────

def test_counter_terms_open_only_for_milestone_deals():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, milestones_json(5000, 5000))
    as_sender(BUYER)
    c.propose_counter_terms(deal_id, "Amended terms")  # open: allowed
    as_sender(SELLER)
    c.accept_counter_terms(deal_id)
    fund(c, deal_id, 1000)
    as_sender(BUYER)
    expect_rollback(lambda: c.propose_counter_terms(deal_id, "Post-fund amendment"),
                    "before funding")


# ── classic regression ─────────────────────────────────

def test_classic_flow_unchanged_end_to_end():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, collateral=100)
    fund(c, deal_id, 1100)
    as_sender(SELLER)

    prompts = []

    def capture(prompt):
        prompts.append(prompt)
        return APPROVED_HIGH

    set_verdict(capture)
    c.submit_evidence(deal_id, "delivery_proof", "https://x.com", "delivered")
    assert get(c, deal_id)["status"] == "evidence_submitted"
    c.request_verification(deal_id)
    assert "MILESTONE UNDER REVIEW" not in prompts[0], "classic prompt must not gain a milestone section"
    assert get(c, deal_id)["status"] == "verified"
    c.settle_deal(deal_id)
    deal = get(c, deal_id)
    assert deal["status"] == "settled"
    assert json.loads(deal["settlement"])["price_to"] == "seller"


def test_classic_refund_unchanged():
    c = new_contract(contract_mod)
    deal_id = make_deal(c, collateral=1001)
    fund(c, deal_id, 1001 + 2000)
    as_sender(SELLER)
    set_verdict(REJECTED_HIGH)
    c.submit_evidence(deal_id, "other", "https://x.com", "d")
    c.request_verification(deal_id)
    as_sender(BUYER)
    c.claim_refund(deal_id)
    s = json.loads(get(c, deal_id)["settlement"])
    assert s["price_to"] == "buyer"
    assert s["seller_collateral_to_buyer"] == "500"
    assert s["seller_collateral_to_protocol"] == "501"


def main():
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith("test_")]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS {name}")
        except Exception as e:  # noqa: BLE001 — report and keep going
            failures += 1
            print(f"  FAIL {name}: {e}")
    print(f"\n{len(tests) - failures}/{len(tests)} tests passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()

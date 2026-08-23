"""
What crosses the equivalence principle — N11.

`gl.eq_principle.strict_eq` compares the value a nondet block returns byte for
byte across the validator set. The old `verify_conditions` returned the model's
own 2–3 sentence explanation inside that value, so two validators reaching the
identical judgment about the identical evidence would still disagree on the
bytes, consensus would fail, and no verdict would be recorded at all.

The fix moves the whole payload onto closed vocabularies: a bool, a three-value
enum, and reason codes drawn from a fixed tuple, with anything off-vocabulary
coerced back on. The readable sentence is composed after consensus from the
agreed code, which is a dict lookup every validator performs identically.

These tests read `chain.compared()` — the stub logs every value handed to
`strict_eq`, which on chain is exactly the string validators compare. That's the
closest a single-validator harness gets to proving consensus is attainable:
it can't run a validator set, but it can prove the compared value contains
nothing that varies between one model run and the next.
"""

import json

from support import CONTRACT, GEN


def _ready(chain, price=GEN):
    """A funded deal with evidence on it, one call away from a verdict."""
    deal_id = chain.create_deal()
    chain.fund_deal(deal_id, price=price)
    chain.submit_evidence(deal_id)
    return deal_id


# ──────────────────────────────────────────────
# The compared value is closed-vocabulary
# ──────────────────────────────────────────────


def test_no_prose_reaches_the_compared_value(chain):
    deal_id = _ready(chain)
    chain.script_verdict(
        True,
        confidence="high",
        reasoning=(
            "The DHL page shows a Berlin signature on 4 April and the certificate "
            "of analysis lists 11.2% moisture, so both conditions hold."
        ),
    )
    chain.request_verification(deal_id)

    compared = chain.compared_json()
    assert set(compared) == {
        "conditions_met",
        "confidence",
        "reason_code",
        "unmet_conditions",
    }
    assert "DHL" not in chain.compared()
    assert compared["confidence"] in CONTRACT.CONFIDENCE_LEVELS
    assert compared["reason_code"] in CONTRACT.VERDICT_REASON_CODES
    assert all(
        code in CONTRACT.UNMET_CONDITION_CODES for code in compared["unmet_conditions"]
    )


def test_two_validators_wording_it_differently_compare_equal(chain):
    """
    The N11 reproducer, as close as one validator can get to it.

    Same judgment, two different explanations — which is what a non-zero
    temperature model hands two validators. Pre-fix these two strings differed
    and `strict_eq` had nothing to agree on.
    """
    first = _ready(chain)
    second = _ready(chain)

    chain.script_verdict(
        False, confidence="medium", reasoning="Moisture was 13.4%, above spec."
    )
    chain.request_verification(first)
    chain.script_verdict(
        False,
        confidence="medium",
        reasoning="The beans came in wet — 13.4% against a 12% ceiling.",
    )
    chain.request_verification(second)

    assert chain.compared(-2) == chain.compared(-1)


def test_the_same_unmet_set_in_a_different_order_compares_equal(chain):
    """Two validators can agree on a set and still emit it in either order."""
    first = _ready(chain)
    second = _ready(chain)

    chain.script_verdict(
        False, confidence="high", unmet=["terms_ambiguous", "evidence_unfetchable"]
    )
    chain.request_verification(first)
    chain.script_verdict(
        False, confidence="high", unmet=["evidence_unfetchable", "terms_ambiguous"]
    )
    chain.request_verification(second)

    assert chain.compared(-2) == chain.compared(-1)


# ──────────────────────────────────────────────
# Coercion, and which way it leans
# ──────────────────────────────────────────────


def test_confidence_casing_does_not_change_the_outcome(chain):
    deal_id = _ready(chain)
    chain.script_verdict(False, confidence="  HIGH ")
    chain.request_verification(deal_id)

    assert chain.compared_json()["confidence"] == "high"
    assert chain.status(deal_id) == "rejected"


def test_an_invented_confidence_level_disputes_rather_than_rejects(chain):
    """
    Coercion has a direction and it matters.

    An unreadable confidence lands on `low`, which means `disputed`: nobody's
    money moves and the parties can re-verify or resolve. Reading it as anything
    else means `rejected`, which refunds the buyer and burns half the seller's
    bond on the strength of a word the contract did not understand.
    """
    deal_id = _ready(chain)
    chain.script_verdict(False, confidence="fairly confident")
    chain.request_verification(deal_id)

    assert chain.compared_json()["confidence"] == "low"
    assert chain.status(deal_id) == "disputed"


def test_an_invented_reason_code_falls_back_into_the_vocabulary(chain):
    deal_id = _ready(chain)
    chain.script_verdict(False, confidence="high", reason_code="beans_were_wet")
    chain.request_verification(deal_id)

    assert chain.compared_json()["reason_code"] == "evidence_insufficient"


def test_a_missing_reason_code_follows_the_judgment(chain):
    deal_id = _ready(chain)
    chain.script_verdict(True, reason_code="")
    chain.request_verification(deal_id)

    assert chain.compared_json()["reason_code"] == "all_conditions_confirmed"
    assert chain.status(deal_id) == "verified"


def test_unmet_conditions_are_filtered_deduped_and_sorted(chain):
    deal_id = _ready(chain)
    chain.script_verdict(
        False,
        confidence="high",
        unmet=[
            "terms_ambiguous",
            "the beans were wet",
            "EVIDENCE_INSUFFICIENT",
            "evidence_insufficient",
            "deadline_passed",
        ],
    )
    chain.request_verification(deal_id)

    assert chain.compared_json()["unmet_conditions"] == [
        "deadline_passed",
        "evidence_insufficient",
        "terms_ambiguous",
    ]


def test_a_non_list_unmet_field_becomes_an_empty_list(chain):
    deal_id = _ready(chain)
    chain.script_raw(
        json.dumps(
            {
                "conditions_met": False,
                "confidence": "high",
                "reason_code": "evidence_insufficient",
                "unmet_conditions": "evidence_insufficient",  # a string, not a list
            }
        )
    )
    chain.request_verification(deal_id)

    assert chain.compared_json()["unmet_conditions"] == []


def test_unparseable_model_output_stays_in_the_vocabulary(chain):
    deal_id = _ready(chain)
    chain.script_raw("I'm afraid I can't determine that from the evidence given.")
    chain.request_verification(deal_id)

    assert chain.compared_json() == {
        "conditions_met": False,
        "confidence": "low",
        "reason_code": "verification_error",
        "unmet_conditions": ["verification_error"],
    }
    assert chain.status(deal_id) == "disputed"


# ──────────────────────────────────────────────
# Prose, written by the contract
# ──────────────────────────────────────────────


def test_verdict_details_carries_prose_the_contract_wrote(chain):
    deal_id = _ready(chain)
    chain.script_verdict(True, reasoning="Everything checks out, honestly.")
    chain.request_verification(deal_id)

    details = json.loads(chain.deal(deal_id)["verdict_details"])
    assert details["reason_code"] == "all_conditions_confirmed"
    assert details["reasoning"] == CONTRACT.REASON_TEXT["all_conditions_confirmed"]
    assert "honestly" not in details["reasoning"]
    # The frontend reads these three. Keep them present and shaped as before.
    assert details["conditions_met"] is True
    assert details["confidence"] == "high"
    assert details["unmet_conditions"] == []


def test_every_code_in_the_vocabulary_has_a_sentence():
    """A code with no REASON_TEXT entry renders as an empty verdict in the UI."""
    for code in CONTRACT.VERDICT_REASON_CODES + CONTRACT.DEADLINE_REASON_CODES:
        assert CONTRACT.REASON_TEXT.get(code), f"no sentence for {code}"


# ──────────────────────────────────────────────
# The deadline block, same treatment
# ──────────────────────────────────────────────


def test_the_deadline_check_compares_only_codes(chain):
    first = chain.deal_at_funded()
    second = chain.deal_at_funded()

    chain.script_deadline(False, reasoning="It is 4 April; the deadline is 20 April.")
    chain.check_deadline(first)
    chain.script_deadline(
        False, reasoning="Deadline is the 20th and today is the 4th, so not yet."
    )
    chain.check_deadline(second)

    compared = chain.compared_json()
    assert set(compared) == {"deadline_passed", "reason_code"}
    assert compared["reason_code"] in CONTRACT.DEADLINE_REASON_CODES
    assert chain.compared(-2) == chain.compared(-1)


def test_an_invented_deadline_code_falls_back(chain):
    deal_id = chain.deal_at_funded()
    chain.script_deadline(False, reason_code="probably_fine")
    chain.check_deadline(deal_id)

    assert chain.compared_json()["reason_code"] == "deadline_indeterminate"
    assert chain.status(deal_id) == "funded"


def test_an_expired_deadline_records_the_contract_sentence(chain):
    deal_id = chain.deal_at_funded(price=5 * GEN)
    chain.script_deadline(True, reasoning="Overdue by nine days.")
    chain.check_deadline(deal_id)

    assert chain.status(deal_id) == "rejected"
    details = json.loads(chain.deal(deal_id)["verdict_details"])
    assert details["reason_code"] == "deadline_passed"
    assert details["reasoning"] == CONTRACT.REASON_TEXT["deadline_passed"]
    assert details["unmet_conditions"] == ["deadline_passed"]


def test_unparseable_deadline_output_never_expires_a_deal(chain):
    """Fail closed: an unreadable answer must not move a deal to `rejected`."""
    deal_id = chain.deal_at_funded(price=5 * GEN)
    chain.script_raw("The time API returned an HTML error page.")
    chain.check_deadline(deal_id)

    assert chain.compared_json() == {
        "deadline_passed": False,
        "reason_code": "verification_error",
    }
    assert chain.status(deal_id) == "funded"
    assert chain.accounting()["total_locked"] == 5 * GEN

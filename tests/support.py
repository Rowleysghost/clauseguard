"""
Shared harness for the ClauseGuard contract tests.

Deliberately NOT named `conftest`. Both `tests/` and `tests/gltest/` have a
conftest, and pytest imports conftest files under the bare module name
`conftest` — so `from conftest import ...` in a test module resolves to
whichever one landed in `sys.modules` first. Under a plain `pytest tests` that
is `tests/gltest/conftest.py`, and every money module dies at collection with
`ImportError: cannot import name 'BUYER'`. A unique basename cannot collide.

The contract is loaded from `contracts/clauseguard.py` by path, unmodified —
the file under test is the file that ships. `tests/stubs/` goes on `sys.path`
first so its fake `genlayer` module satisfies the contract's imports.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
STUBS = Path(__file__).resolve().parent / "stubs"
CONTRACT_PATH = REPO_ROOT / "contracts" / "clauseguard.py"

# Ahead of everything, including site-packages: if a real `genlayer` is ever
# installed in the same environment it must not win.
if str(STUBS) not in sys.path:
    sys.path.insert(0, str(STUBS))

import genlayer as glstub  # noqa: E402  (must follow the sys.path edit)
from genlayer import Address, RUNTIME, Revert  # noqa: E402

GEN = 10**18

# Fixed accounts. Distinct leading bytes so a failed assertion is readable.
SELLER = Address("0x1111111111111111111111111111111111111111")
BUYER = Address("0x2222222222222222222222222222222222222222")
STRANGER = Address("0x3333333333333333333333333333333333333333")
SECOND_BUYER = Address("0x4444444444444444444444444444444444444444")

PARTIES = (SELLER, BUYER, STRANGER, SECOND_BUYER)


def _load_contract_class():
    """Import contracts/clauseguard.py by path and hand back the class."""
    if not CONTRACT_PATH.exists():
        raise FileNotFoundError(f"contract not found at {CONTRACT_PATH}")
    spec = importlib.util.spec_from_file_location("clauseguard_contract", CONTRACT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["clauseguard_contract"] = module
    spec.loader.exec_module(module)
    return module.ClauseGuard


ClauseGuardClass = _load_contract_class()

# The loaded module itself, so tests can assert against the contract's own
# vocabularies (CONFIDENCE_LEVELS, VERDICT_REASON_CODES, REASON_TEXT) instead of
# re-typing them here and drifting from the file that ships.
CONTRACT = sys.modules["clauseguard_contract"]


class Chain:
    """
    Thin, readable wrapper over the runtime. Tests talk to this, not to
    `RUNTIME` directly, so the call sites read like transactions.
    """

    def __init__(self, runtime):
        self.rt = runtime

    # ── plumbing ──

    def call(self, method, *args, sender, value=0, **kwargs):
        return self.rt.call(method, *args, sender=sender, value=value, **kwargs)

    def view(self, method, *args, **kwargs):
        return self.rt.view(method, *args, **kwargs)

    def balance(self, who):
        return self.rt.balance_of(who)

    @property
    def contract_address(self):
        return self.rt.contract_address

    def contract_balance(self):
        return self.rt.balance_of(self.rt.contract_address)

    # ── reads ──

    def deal(self, deal_id):
        return json.loads(self.view("get_deal", glstub.u256(deal_id)))

    def status(self, deal_id):
        return self.view("get_deal_status", glstub.u256(deal_id))

    def payout(self, who):
        return int(self.view("get_payout", Address(who)))

    def accounting(self):
        raw = json.loads(self.view("get_accounting"))
        return {k: int(v) for k, v in raw.items()}

    # ── deal lifecycle shorthands ──

    def create_deal(
        self,
        sender=SELLER,
        bond=0,
        terms="Deliver 10 widgets, blue, by the stated deadline.",
        price="1 GEN",
        deadline="7 days from funding",
        urls="https://example.com/tracking",
        min_sources=1,
    ):
        return int(
            self.call(
                "create_deal",
                terms,
                price,
                deadline,
                urls,
                glstub.u256(min_sources),
                sender=sender,
                value=bond,
            )
        )

    def fund_deal(self, deal_id, sender=BUYER, value=None, price=None, bond=0):
        """Pass `value` for the exact wei, or `price`+`bond` to have it summed."""
        if value is None:
            value = (price or 0) + bond
        return self.call("fund_deal", glstub.u256(deal_id), sender=sender, value=value)

    def settle(self, deal_id, sender=SELLER):
        return self.call("settle_deal", glstub.u256(deal_id), sender=sender)

    def refund(self, deal_id, sender=BUYER):
        return self.call("claim_refund", glstub.u256(deal_id), sender=sender)

    def cancel(self, deal_id, sender=SELLER):
        return self.call("cancel_deal", glstub.u256(deal_id), sender=sender)

    def withdraw(self, sender):
        return self.call("withdraw", sender=sender)

    def submit_evidence(
        self,
        deal_id,
        sender=SELLER,
        evidence_type="delivery_proof",
        url="https://example.com/proof",
        description="Tracking shows delivered.",
    ):
        return self.call(
            "submit_evidence",
            glstub.u256(deal_id),
            evidence_type,
            url,
            description,
            sender=sender,
        )

    def request_verification(self, deal_id, sender=SELLER):
        return self.call("request_verification", glstub.u256(deal_id), sender=sender)

    def check_deadline(self, deal_id, sender=SELLER):
        return self.call("check_deadline", glstub.u256(deal_id), sender=sender)

    def propose_counter_terms(self, deal_id, new_terms, sender=BUYER):
        return self.call(
            "propose_counter_terms", glstub.u256(deal_id), new_terms, sender=sender
        )

    def accept_counter_terms(self, deal_id, sender=SELLER):
        return self.call("accept_counter_terms", glstub.u256(deal_id), sender=sender)

    def propose_resolution(self, deal_id, outcome, sender=SELLER):
        return self.call(
            "propose_resolution", glstub.u256(deal_id), outcome, sender=sender
        )

    # ── scripted non-determinism ──

    def script_verdict(
        self,
        conditions_met,
        confidence="high",
        reasoning="scripted",
        reason_code=None,
        unmet=None,
    ):
        """
        Queue one raw LLM response for `request_verification`.

        `reasoning` is still sent, because a real model still writes prose
        whatever the prompt asks for. The contract is expected to drop it rather
        than let it into the compared value — that is N11, and
        `test_verdict_consensus.py` is where it's pinned.
        """
        if reason_code is None:
            reason_code = (
                "all_conditions_confirmed" if conditions_met
                else "evidence_insufficient"
            )
        if unmet is None:
            unmet = [] if conditions_met else ["evidence_insufficient"]
        self.rt.prompt_responses.append(
            json.dumps(
                {
                    "conditions_met": bool(conditions_met),
                    "confidence": confidence,
                    "reasoning": reasoning,
                    "reason_code": reason_code,
                    "unmet_conditions": unmet,
                }
            )
        )

    def script_raw(self, response: str):
        """Queue a response verbatim — malformed JSON, a bare sentence, anything."""
        self.rt.prompt_responses.append(response)

    def script_deadline(self, passed, reasoning="scripted", reason_code=None):
        if reason_code is None:
            reason_code = "deadline_passed" if passed else "deadline_not_reached"
        self.rt.prompt_responses.append(
            json.dumps(
                {
                    "deadline_passed": bool(passed),
                    "reasoning": reasoning,
                    "reason_code": reason_code,
                }
            )
        )

    def compared(self, index=-1):
        """
        The exact string a `strict_eq` block returned — what a real validator
        set would byte-compare. Defaults to the most recent one.
        """
        return self.rt.strict_eq_log[index]

    def compared_json(self, index=-1):
        return json.loads(self.compared(index))

    # ── composite: drive a deal to a given status ──

    def deal_at_verified(self, price=GEN, bond=0):
        deal_id = self.create_deal(bond=bond)
        self.fund_deal(deal_id, price=price, bond=bond)
        self.submit_evidence(deal_id)
        self.script_verdict(True)
        self.request_verification(deal_id)
        assert self.status(deal_id) == "verified"
        return deal_id

    def deal_at_rejected(self, price=GEN, bond=0):
        deal_id = self.create_deal(bond=bond)
        self.fund_deal(deal_id, price=price, bond=bond)
        self.submit_evidence(deal_id)
        self.script_verdict(False, confidence="high")
        self.request_verification(deal_id)
        assert self.status(deal_id) == "rejected"
        return deal_id

    def deal_at_funded(self, price=GEN, bond=0):
        """A deal nobody has submitted evidence for — N8's second half."""
        deal_id = self.create_deal(bond=bond)
        self.fund_deal(deal_id, price=price, bond=bond)
        assert self.status(deal_id) == "funded"
        return deal_id

    def deal_at_disputed(self, price=GEN, bond=0, exhaust=False):
        """
        Drive a deal to `disputed` with a low-confidence verdict.

        With `exhaust=True`, burn all MAX_VERIFICATION_ATTEMPTS so no further
        `request_verification` is possible — the exact state N8 describes, where
        the deal has no move left and no finalizer will touch it.
        """
        deal_id = self.create_deal(bond=bond)
        self.fund_deal(deal_id, price=price, bond=bond)
        self.submit_evidence(deal_id)
        attempts = 3 if exhaust else 1
        for _ in range(attempts):
            self.script_verdict(False, confidence="low")
            self.request_verification(deal_id)
        assert self.status(deal_id) == "disputed"
        return deal_id

    # ── the invariant ──

    def check_invariant(self):
        """
        `balance == locked + credited + retained`, plus a global conservation
        check: the harness never mints, so the sum over all accounts has to
        equal what was funded in, minus anything a dropped transfer stranded.
        """
        acct = self.accounting()
        expected = acct["total_locked"] + acct["total_credited"] + acct["protocol_retained"]
        actual = self.contract_balance()
        assert actual == expected, (
            f"balance invariant broken: contract holds {actual} wei but the "
            f"books say {expected} "
            f"(locked={acct['total_locked']}, credited={acct['total_credited']}, "
            f"retained={acct['protocol_retained']})"
        )
        assert acct["expected_balance"] == expected
        assert self.rt.total_supply() == self.rt.minted, (
            f"wei appeared or vanished: {self.rt.total_supply()} in circulation "
            f"vs {self.rt.minted} funded in"
        )


def assert_revert(match, fn, *args, **kwargs):
    """
    Run `fn` expecting a revert whose message contains `match`.

    Asserting on the message matters more here than usual: validators compare
    revert strings for strict equality, so a message change is a consensus
    change.
    """
    with pytest.raises(Revert) as excinfo:
        fn(*args, **kwargs)
    assert match.lower() in str(excinfo.value).lower(), (
        f"expected a revert mentioning {match!r}, got {excinfo.value!r}"
    )
    return excinfo.value

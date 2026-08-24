"""
Smoke tests against a live GenLayer Studio.

Deliberately narrow. The mocked suite proves the arithmetic; these prove the
contract deploys, that the payable methods accept value, and that `withdraw`
produces a transfer a real node will apply.

`request_verification` and `check_deadline` are left out on purpose: they crawl
the web and call an LLM, which is slow, costs credits, and cannot be asserted
deterministically. To reach a settled deal here you would need a scripted
verdict, and there is no way to script one on a real node.

See conftest.py in this directory for how to enable these.
"""

import json

import pytest
from gltest import create_accounts, default_account, get_contract_factory
from gltest.assertions import tx_execution_succeeded

GEN = 10**18


@pytest.fixture
def deployed():
    factory = get_contract_factory("ClauseGuard")
    return factory.deploy(args=[], account=default_account)


def test_deploys_with_empty_books(deployed):
    assert int(deployed.get_deal_count(args=[])) == 0

    acct = json.loads(deployed.get_accounting(args=[]))
    assert acct == {
        "total_locked": "0",
        "total_credited": "0",
        "protocol_retained": "0",
        "expected_balance": "0",
    }


def test_create_deal_with_a_bond_locks_value(deployed):
    receipt = deployed.create_deal(
        args=[
            "Deliver 10 blue widgets by the deadline.",
            "1 GEN",
            "7 days from funding",
            "https://example.com/tracking",
            1,
        ],
        value=2 * GEN,
    )
    assert tx_execution_succeeded(receipt)

    assert int(deployed.get_deal_count(args=[])) == 1
    deal = json.loads(deployed.get_deal(args=[1]))
    assert deal["status"] == "open"
    assert deal["collateral_amount"] == str(2 * GEN)

    acct = json.loads(deployed.get_accounting(args=[]))
    assert acct["total_locked"] == str(2 * GEN)


def test_buyer_funds_and_the_bond_is_split_out(deployed):
    buyer = create_accounts(1)[0]

    deployed.create_deal(
        args=[
            "Deliver 10 blue widgets by the deadline.",
            "5 GEN",
            "7 days from funding",
            "https://example.com/tracking",
            1,
        ],
        value=2 * GEN,
    )

    as_buyer = deployed.connect(buyer)
    receipt = as_buyer.fund_deal(args=[1], value=7 * GEN)
    assert tx_execution_succeeded(receipt)

    deal = json.loads(deployed.get_deal(args=[1]))
    assert deal["status"] == "funded"
    assert deal["funded_amount"] == str(5 * GEN)
    assert deal["buyer_collateral"] == str(2 * GEN)

    acct = json.loads(deployed.get_accounting(args=[]))
    assert acct["total_locked"] == str(9 * GEN)


def test_cancel_then_withdraw_moves_real_value(deployed, native_balance):
    """
    The one path that reaches `withdraw` without needing an LLM verdict:
    create with a bond, cancel, pull the bond back.
    """
    deployed.create_deal(
        args=[
            "Deliver 10 blue widgets by the deadline.",
            "1 GEN",
            "7 days from funding",
            "https://example.com/tracking",
            1,
        ],
        value=2 * GEN,
    )

    assert tx_execution_succeeded(deployed.cancel_deal(args=[1]))
    assert deployed.get_deal_status(args=[1]) == "cancelled"
    assert deployed.get_payout(args=[str(default_account.address)]) == str(2 * GEN)

    contract_before = native_balance(deployed.address)
    seller_before = native_balance(default_account.address)

    assert tx_execution_succeeded(deployed.withdraw(args=[]))

    assert deployed.get_payout(args=[str(default_account.address)]) == "0"
    # Gas makes the seller's delta inexact, so assert the direction and the
    # contract side, which is exact.
    assert native_balance(deployed.address) == contract_before - 2 * GEN
    assert native_balance(default_account.address) > seller_before

    acct = json.loads(deployed.get_accounting(args=[]))
    assert acct == {
        "total_locked": "0",
        "total_credited": "0",
        "protocol_retained": "0",
        "expected_balance": "0",
    }


def test_withdraw_with_nothing_owed_fails(deployed):
    stranger = create_accounts(1)[0]
    receipt = deployed.connect(stranger).withdraw(args=[])
    assert not tx_execution_succeeded(receipt)

"""
Pytest wiring for the ClauseGuard contract tests.

Fixtures and hooks only. The chain harness, the accounts, and `assert_revert`
live in `tests/support.py` — see the note there for why they are not in this
file.
"""

from __future__ import annotations

import pytest

from support import GEN, PARTIES, RUNTIME, SELLER, Chain, ClauseGuardClass


@pytest.fixture
def chain():
    """A fresh chain with a deployed contract and four funded accounts."""
    RUNTIME.reset()
    for who in PARTIES:
        RUNTIME.fund_account(who, 1000 * GEN)
    RUNTIME.deploy(ClauseGuardClass, sender=SELLER)
    return Chain(RUNTIME)


@pytest.fixture(autouse=True)
def _invariant_after_every_test(request):
    """
    After every test that used the chain, assert the books balance.

    This is the point of the whole suite: a test about authorization also
    proves nothing leaked, whether its author thought about money or not.
    Skipped when the test already failed, so the real failure isn't buried.
    """
    yield
    if "chain" not in request.fixturenames:
        return
    if request.node.get_closest_marker("no_invariant") is not None:
        return
    if getattr(request.node, "rep_call", None) is not None and request.node.rep_call.failed:
        return
    if RUNTIME.contract is None:
        return
    Chain(RUNTIME).check_invariant()


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Expose each phase's result so the fixture above can see a failure."""
    outcome = yield
    report = outcome.get_result()
    setattr(item, "rep_" + report.when, report)


def pytest_runtest_setup(item):
    item.rep_setup = None
    item.rep_call = None

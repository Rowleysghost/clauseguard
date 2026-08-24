"""
gltest smoke tests: opt-in, and not run in this change.

These talk to a real GenLayer Studio over JSON-RPC. They need Docker and the
`genlayer-test` package, so they are skipped unless both are present AND
`CLAUSEGUARD_GLTEST=1` is set — otherwise a routine `pytest tests` would hang
for minutes waiting on transaction receipts.

Honest status: the API here was written against the installed `genlayer-test`
0.1.2 source (`gltest.get_contract_factory`, `ContractFactory.deploy`, the
schema-built `Contract` methods, `tx_execution_succeeded`), so the calls should
be right. Nothing in this directory has been executed. Expect the first real run
to need adjustment, particularly around account funding, which Studio handles
differently from a public network.
"""

import os

import pytest

collect_ignore = []

try:  # noqa: SIM105
    import gltest  # noqa: F401
except ImportError:
    collect_ignore = ["test_money_smoke.py"]

if os.environ.get("CLAUSEGUARD_GLTEST") != "1":
    collect_ignore = ["test_money_smoke.py"]


@pytest.fixture(scope="session")
def provider():
    from gltest.glchain.client import get_gl_provider

    return get_gl_provider()


@pytest.fixture(scope="session")
def native_balance(provider):
    """
    Read a native balance over raw JSON-RPC.

    `genlayer_py` exposes no balance helper, so this goes straight at
    `eth_getBalance` through the client's provider.
    """

    def _balance(address) -> int:
        raw = provider.make_request("eth_getBalance", [str(address), "latest"])
        result = raw["result"] if isinstance(raw, dict) else raw
        return int(result, 16) if isinstance(result, str) else int(result)

    return _balance

"""
Stdlib-only stub of the `genlayer` module so contracts/clauseguard.py can be
imported and its state machine unit-tested without a GenVM. Nondeterministic
pieces are canned: `web.render` returns fixed text, `exec_prompt` returns
whatever the test sets (a JSON string or a callable receiving the prompt),
and `strict_eq` simply invokes the closure.

Usage:
    from gl_stub import load_contract, Rollback
    clauseguard, gl = load_contract()
    c = clauseguard.ClauseGuard()
"""

import importlib.util
import sys
import types
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parent.parent / "contracts" / "clauseguard.py"


class Rollback(Exception):
    """Raised by the stubbed gl.rollback — the GenVM aborts the tx here."""


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


class _Message:
    sender_address = "0xseller"
    value = 0


class _EqPrinciple:
    @staticmethod
    def strict_eq(fn):
        return fn()


class _Web:
    render_result = "stubbed page content"

    @classmethod
    def render(cls, url, mode="text"):
        return cls.render_result


class _Nondet:
    web = _Web
    # A JSON string, or a callable taking the prompt and returning one.
    exec_prompt_result = "{}"

    @classmethod
    def exec_prompt(cls, prompt):
        result = cls.exec_prompt_result
        return result(prompt) if callable(result) else result


class _TreeMap(dict):
    def __class_getitem__(cls, item):
        return cls


def _make_genlayer_module():
    mod = types.ModuleType("genlayer")
    gl = types.SimpleNamespace()
    gl.Contract = type("Contract", (), {})
    gl.public = _Public
    gl.message = _Message
    gl.eq_principle = _EqPrinciple
    gl.nondet = _Nondet

    def rollback(msg):
        raise Rollback(msg)

    gl.rollback = rollback

    mod.gl = gl
    mod.u256 = int
    mod.Address = str
    mod.TreeMap = _TreeMap
    mod.__all__ = ["gl", "u256", "Address", "TreeMap"]
    return mod


def load_contract():
    """Install the fake genlayer module and import the contract fresh."""
    genlayer = _make_genlayer_module()
    sys.modules["genlayer"] = genlayer
    sys.modules.pop("clauseguard", None)
    spec = importlib.util.spec_from_file_location("clauseguard", CONTRACT_PATH)
    contract_mod = importlib.util.module_from_spec(spec)
    sys.modules["clauseguard"] = contract_mod
    spec.loader.exec_module(contract_mod)
    return contract_mod, genlayer.gl


def new_contract(contract_mod):
    """Instantiate ClauseGuard with dict-backed storage maps."""
    c = contract_mod.ClauseGuard()
    # The real GenVM materializes the annotated storage maps; here we back
    # them with plain dicts (the stub TreeMap).
    c.deals = _TreeMap()
    c.user_deals = _TreeMap()
    return c

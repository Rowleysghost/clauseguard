"""
A fake `genlayer` module, standing in for the GenVM Python stdlib so
`contracts/clauseguard.py` can be imported and driven by pytest.

The contract file under test is never modified or copied. `conftest.py` puts
this directory at the front of `sys.path`, so the contract's `from genlayer
import *` resolves here instead of to the real runtime (which only exists
inside GenVM and can't be pip-installed).

Everything here was written against the v0.2.x stdlib, which is what the
`# { "Depends": "py-genlayer:1jb45aa8..." }` header at the top of the contract
pins. Notable behaviours copied deliberately:

* `gl.public.write` / `gl.public.write.payable` / `gl.public.view` tag the
  function, and the runtime here refuses value sent to an untagged method.
* `gl.vm.UserError` is the revert mechanism. The real runner catches it at the
  entry point and turns it into a rollback carrying the message string.
* `emit_transfer` takes `value` as a KEYWORD-ONLY argument, raises `ValueError`
  on a non-positive amount, and does not send synchronously — it queues a
  message for consensus to apply later. See `Runtime.call` for how that's
  modelled.
* `TreeMap.__getitem__` raises bare `KeyError`; `.get()` and `in` both work.
* Writing a negative number to a `u256` storage slot raises `OverflowError`,
  because the real storage layer serialises with `int.to_bytes(..., signed=False)`.

Two places where this stub knowingly differs from the chain, both of which
matter when reading test results:

1. `str(Address)` returns lowercase hex. The real one returns EIP-55
   checksummed hex, which needs keccak. Safe here only because the contract
   compares address strings it produced itself, never a caller-supplied one.
2. Rejecting value sent to a non-payable method is the node's behaviour, not
   the contract's. It's modelled here because the `payable` flag in the
   contract schema exists for exactly that purpose, but it was not verified
   against the node source.
"""

from __future__ import annotations

import copy
import re
import typing

__all__ = (
    "gl",
    "u256",
    "u32",
    "u64",
    "u8",
    "i256",
    "bigint",
    "Address",
    "TreeMap",
    "DynArray",
    "Runtime",
    "Revert",
    "RUNTIME",
)


# ──────────────────────────────────────────────
# Scalar aliases
# ──────────────────────────────────────────────
# The real ones are `typing.NewType(..., int)` with no runtime checking
# whatsoever. Enforcement happens at the storage boundary, not the call.

u8 = typing.NewType("u8", int)
u32 = typing.NewType("u32", int)
u64 = typing.NewType("u64", int)
u256 = typing.NewType("u256", int)
i256 = typing.NewType("i256", int)
bigint = typing.NewType("bigint", int)

_UNSIGNED = {u8: 8, u32: 32, u64: 64, u256: 256}

_HEX_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


# ──────────────────────────────────────────────
# Address
# ──────────────────────────────────────────────


class Address:
    """
    A 20-byte account address. Hashable and ordered, so it works as a TreeMap
    key exactly like the real one.
    """

    __slots__ = ("_hex",)

    def __init__(self, val):
        if isinstance(val, Address):
            self._hex = val._hex
        elif isinstance(val, (bytes, bytearray, memoryview)):
            raw = bytes(val)
            if len(raw) != 20:
                raise ValueError(f"address must be 20 bytes, got {len(raw)}")
            self._hex = "0x" + raw.hex()
        elif isinstance(val, str):
            if not _HEX_ADDRESS.match(val):
                raise ValueError(f"not a hex address: {val!r}")
            self._hex = val.lower()
        else:
            raise TypeError(f"cannot build an Address from {type(val).__name__}")

    @property
    def as_hex(self) -> str:
        return self._hex

    @property
    def as_bytes(self) -> bytes:
        return bytes.fromhex(self._hex[2:])

    def __str__(self) -> str:
        return self._hex

    def __repr__(self) -> str:
        return f'Address("{self._hex}")'

    def __eq__(self, other) -> bool:
        return isinstance(other, Address) and other._hex == self._hex

    def __hash__(self) -> int:
        return hash(self._hex)

    def __lt__(self, other) -> bool:
        return self._hex < Address(other)._hex

    def __le__(self, other) -> bool:
        return self._hex <= Address(other)._hex

    def __gt__(self, other) -> bool:
        return self._hex > Address(other)._hex

    def __ge__(self, other) -> bool:
        return self._hex >= Address(other)._hex


# ──────────────────────────────────────────────
# Storage collections
# ──────────────────────────────────────────────

K = typing.TypeVar("K")
V = typing.TypeVar("V")


def _check_unsigned(kind, value):
    """Mimic the storage layer's `to_bytes(..., signed=False)` failure mode."""
    bits = _UNSIGNED.get(kind)
    if bits is None:
        return
    if not isinstance(value, int) or isinstance(value, bool):
        return
    if value < 0:
        raise OverflowError(f"can't convert negative int to unsigned ({value})")
    if value >= 1 << bits:
        raise OverflowError(f"int too big to convert to u{bits} ({value})")


class TreeMap(typing.Generic[K, V]):
    """Ordered map. Misses raise bare `KeyError`, as on chain."""

    def __init__(self, value_kind=None):
        self._data: dict = {}
        self._value_kind = value_kind

    def __getitem__(self, key):
        if key not in self._data:
            raise KeyError()
        return self._data[key]

    def __setitem__(self, key, value):
        _check_unsigned(self._value_kind, value)
        self._data[key] = value

    def __delitem__(self, key):
        del self._data[key]

    def __contains__(self, key) -> bool:
        return key in self._data

    def __len__(self) -> int:
        return len(self._data)

    def __iter__(self):
        return iter(sorted(self._data.keys()))

    def get(self, key, default=None):
        return self._data.get(key, default)

    def keys(self):
        return list(self)

    def items(self):
        return [(k, self._data[k]) for k in self]

    def values(self):
        return [self._data[k] for k in self]


class DynArray(typing.Generic[V], list):
    """Present for completeness; the contract keeps its lists inside JSON."""


# ──────────────────────────────────────────────
# Reverts
# ──────────────────────────────────────────────


class Revert(Exception):
    """
    What the harness raises out of a reverted call.

    On chain a `gl.vm.UserError` is converted to a rollback carrying its
    message, and the transaction's whole state delta is discarded. Tests assert
    on `.message`.
    """

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class UserError(Revert):
    """`gl.vm.UserError` — the contract's own revert path via `_fail()`."""


class _VM:
    UserError = UserError


# ──────────────────────────────────────────────
# Message
# ──────────────────────────────────────────────


class MessageType(typing.NamedTuple):
    contract_address: Address
    sender_address: Address
    origin_address: Address
    value: int
    chain_id: int


# ──────────────────────────────────────────────
# Decorators
# ──────────────────────────────────────────────

_KIND_ATTR = "_gl_kind"
_PAYABLE_ATTR = "_gl_payable"


def _tag(fn, kind: str, payable: bool):
    setattr(fn, _KIND_ATTR, kind)
    setattr(fn, _PAYABLE_ATTR, payable)
    return fn


class _Write:
    def __call__(self, fn):
        return _tag(fn, "write", False)

    def payable(self, fn):
        return _tag(fn, "write", True)


class _Public:
    write = _Write()

    def view(self, fn):
        return _tag(fn, "view", False)


class _Private:
    def __call__(self, fn):
        return fn


# ──────────────────────────────────────────────
# Non-determinism, scripted
# ──────────────────────────────────────────────


class _Web:
    def render(self, url: str, mode: str = "text") -> str:
        return RUNTIME._web(url, mode)


class _Nondet:
    web = _Web()

    def exec_prompt(self, prompt: str, **kwargs) -> str:
        return RUNTIME._prompt(prompt)


class _EqPrinciple:
    def strict_eq(self, fn):
        """
        On chain the leader runs `fn`, validators re-run it, and the results
        must match byte-for-byte. Locally there's one validator, so just run it —
        and log what came back, because that string is exactly what a real
        validator set would compare. Tests read the log to prove nothing
        non-deterministic crossed the boundary; see test_verdict_consensus.py.
        """
        result = fn()
        RUNTIME.strict_eq_log.append(result)
        return result

    def prompt_comparative(self, fn, criteria: str):
        return fn()

    def prompt_non_comparative(self, fn, *, task: str, criteria: str):
        return fn()


# ──────────────────────────────────────────────
# Value transfer
# ──────────────────────────────────────────────


class _ContractProxy:
    """What `gl.get_contract_at(addr)` hands back."""

    def __init__(self, address: Address):
        self._address = address

    @property
    def balance(self) -> int:
        return RUNTIME.balance_of(self._address)

    def emit_transfer(self, *, value: int, on: str = "finalized") -> None:
        # v0.2.x really does keep `value` keyword-only here, and really does
        # raise before touching consensus on a non-positive amount.
        if value <= 0:
            raise ValueError("value must be greater than 0 for emit_transfer")
        RUNTIME._emit_transfer(self._address, int(value), on)


# ──────────────────────────────────────────────
# Contract base
# ──────────────────────────────────────────────


def _field_kinds(cls) -> dict:
    """
    Read the storage layout off the class annotations, the same information
    the real runtime uses to lay out slots.
    """
    kinds: dict = {}
    for klass in reversed(cls.__mro__):
        for name, ann in getattr(klass, "__annotations__", {}).items():
            if name.startswith("_"):
                continue
            kinds[name] = ann
    return kinds


def _default_for(ann):
    """A freshly-deployed slot's value."""
    origin = typing.get_origin(ann)
    if origin is TreeMap or ann is TreeMap:
        args = typing.get_args(ann)
        return TreeMap(value_kind=args[1] if len(args) > 1 else None)
    if origin is DynArray or ann is DynArray:
        return DynArray()
    if isinstance(ann, str):
        # Only reachable under lazily-evaluated annotations. Text match is
        # enough: this contract's storage types are all spelled out literally.
        if ann.startswith("TreeMap"):
            return TreeMap(value_kind=u256 if ann.rstrip().endswith("u256]") else None)
        if ann.startswith("DynArray"):
            return DynArray()
        if ann.startswith(("u8", "u32", "u64", "u256", "i256", "bigint", "int")):
            return 0
        if ann == "str":
            return ""
        return None
    if ann in _UNSIGNED or ann in (i256, bigint, int):
        return 0
    if ann is str:
        return ""
    if ann is bool:
        return False
    return None


class Contract:
    """
    Stand-in for `gl.Contract`. Storage slots come from class annotations and
    are materialised before `__init__` runs, which is why the contract can
    write to `self.deals` without ever creating it.
    """

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        cls._gl_fields = _field_kinds(cls)

    def __new__(cls, *args, **kwargs):
        obj = super().__new__(cls)
        for name, ann in cls._gl_fields.items():
            object.__setattr__(obj, name, _default_for(ann))
        return obj

    def __setattr__(self, name, value):
        _check_unsigned(type(self)._gl_fields.get(name), value)
        object.__setattr__(self, name, value)

    @property
    def balance(self) -> int:
        return RUNTIME.balance_of(RUNTIME.contract_address)


# ──────────────────────────────────────────────
# The `gl` namespace
# ──────────────────────────────────────────────


class _GL:
    Contract = Contract
    public = _Public()
    private = _Private()
    vm = _VM()
    nondet = _Nondet()
    eq_principle = _EqPrinciple()
    MessageType = MessageType

    @property
    def message(self) -> MessageType:
        msg = RUNTIME.current_message
        if msg is None:
            raise RuntimeError("gl.message read outside of a call")
        return msg

    @staticmethod
    def get_contract_at(address: Address) -> _ContractProxy:
        return _ContractProxy(Address(address))

    @staticmethod
    def trace(*objs, sep: str = " "):
        pass


gl = _GL()


# ──────────────────────────────────────────────
# The harness
# ──────────────────────────────────────────────


class Runtime:
    """
    A single-validator chain: balances, one deployed contract, and the
    transactional semantics that make a revert actually undo things.
    """

    CONTRACT_ADDRESS = Address("0x" + "cc" * 20)
    CHAIN_ID = 61999

    def __init__(self):
        self.reset()

    def reset(self):
        self.balances: dict = {}
        self.minted: int = 0
        self.contract = None
        self.contract_address = Runtime.CONTRACT_ADDRESS
        self.current_message: MessageType | None = None

        # Scripted non-determinism.
        self.web_responses: dict = {}
        self.web_default = "[no scripted response]"
        self.prompt_responses: list = []
        self.prompt_default = (
            '{"conditions_met": false, "confidence": "low",'
            ' "reasoning": "no scripted verdict",'
            ' "reason_code": "verification_error", "unmet_conditions": []}'
        )
        self.prompts_seen: list = []

        # Every value returned out of a `gl.eq_principle.strict_eq` block, in
        # call order. On chain these bytes are what validators compare, so a
        # test can assert consensus is attainable without a validator set.
        self.strict_eq_log: list = []

        # Transfer-failure injection. Two distinct modes, because on chain
        # they are two genuinely different events:
        #
        #   raise_on_emit_to  — the emit call itself throws inside the
        #       transaction, so the whole call reverts. Models a synchronous
        #       send primitive, and also the real `ValueError` path.
        #   drop_transfer_to  — the emit succeeds and the transaction commits,
        #       but consensus never applies the transfer. The wei strands in
        #       the contract. This is the shape a deferred-transfer failure
        #       actually has, and no contract-side check can prevent it.
        self.raise_on_emit_to: set = set()
        self.drop_transfer_to: set = set()
        self.stranded: int = 0

        self._pending: list = []
        self.transfer_log: list = []

    # ── accounts ──

    def fund_account(self, address: Address, wei: int):
        addr = Address(address)
        self.balances[addr] = self.balances.get(addr, 0) + int(wei)
        self.minted += int(wei)

    def balance_of(self, address) -> int:
        return self.balances.get(Address(address), 0)

    def total_supply(self) -> int:
        """Every wei the harness knows about. Must never change on its own."""
        return sum(self.balances.values())

    # ── deployment ──

    def deploy(self, contract_cls, *args, sender: Address, **kwargs):
        self.contract = contract_cls.__new__(contract_cls)
        self.current_message = MessageType(
            contract_address=self.contract_address,
            sender_address=Address(sender),
            origin_address=Address(sender),
            value=0,
            chain_id=Runtime.CHAIN_ID,
        )
        try:
            contract_cls.__init__(self.contract, *args, **kwargs)
        finally:
            self.current_message = None
        self.balances.setdefault(self.contract_address, 0)
        return self.contract

    # ── calls ──

    def call(self, method_name: str, *args, sender: Address, value: int = 0, **kwargs):
        """
        Run one transaction.

        Value is debited from the sender and credited to the contract before the
        body runs, matching the chain. Any exception restores the pre-call
        snapshot of both storage and balances, which is what a rollback means.
        Emitted transfers are applied only after the body returns cleanly,
        because `emit_transfer` defers to consensus.
        """
        if self.contract is None:
            raise RuntimeError("no contract deployed")

        sender = Address(sender)
        value = int(value)
        fn = getattr(type(self.contract), method_name, None)
        if fn is None:
            raise AttributeError(f"contract has no method {method_name!r}")

        kind = getattr(fn, _KIND_ATTR, None)
        if kind is None:
            raise AttributeError(f"{method_name!r} is not a public entry point")
        payable = getattr(fn, _PAYABLE_ATTR, False)

        if value < 0:
            raise ValueError("value cannot be negative")
        if value > 0:
            if not payable:
                # Node-side rejection, not contract logic. Nothing is debited.
                raise Revert(f"method {method_name!r} is not payable")
            if self.balance_of(sender) < value:
                raise Revert("insufficient balance to attach value")

        snapshot = self._snapshot()
        self._pending = []

        if value > 0:
            self.balances[sender] = self.balance_of(sender) - value
            self.balances[self.contract_address] = (
                self.balance_of(self.contract_address) + value
            )

        self.current_message = MessageType(
            contract_address=self.contract_address,
            sender_address=sender,
            origin_address=sender,
            value=value,
            chain_id=Runtime.CHAIN_ID,
        )

        try:
            result = fn(self.contract, *args, **kwargs)
        except Revert:
            self._restore(snapshot)
            raise
        except Exception as exc:
            self._restore(snapshot)
            raise Revert(f"{type(exc).__name__}: {exc}") from exc
        finally:
            self.current_message = None
            pending, self._pending = self._pending, []

        # Committed. Now consensus applies whatever the call queued.
        for to, amount, on in pending:
            self.transfer_log.append((to, amount, on))
            if to in self.drop_transfer_to:
                self.stranded += amount
                continue
            self.balances[self.contract_address] = (
                self.balance_of(self.contract_address) - amount
            )
            self.balances[to] = self.balance_of(to) + amount

        return result

    def view(self, method_name: str, *args, sender: Address | None = None, **kwargs):
        """Read-only call. No snapshot needed; nothing may change."""
        caller = Address(sender) if sender is not None else self.contract_address
        fn = getattr(type(self.contract), method_name)
        self.current_message = MessageType(
            contract_address=self.contract_address,
            sender_address=caller,
            origin_address=caller,
            value=0,
            chain_id=Runtime.CHAIN_ID,
        )
        try:
            return fn(self.contract, *args, **kwargs)
        finally:
            self.current_message = None

    # ── internals the `gl` namespace reaches into ──

    def _emit_transfer(self, to: Address, amount: int, on: str):
        if to in self.raise_on_emit_to:
            raise RuntimeError(f"transfer to {to} failed")
        self._pending.append((to, amount, on))

    def _web(self, url: str, mode: str) -> str:
        if url in self.web_responses:
            response = self.web_responses[url]
            if isinstance(response, Exception):
                raise response
            return response
        return self.web_default

    def _prompt(self, prompt: str) -> str:
        self.prompts_seen.append(prompt)
        if self.prompt_responses:
            return self.prompt_responses.pop(0)
        return self.prompt_default

    # ── snapshots ──

    def _snapshot(self):
        return (copy.deepcopy(self.contract.__dict__), dict(self.balances))

    def _restore(self, snapshot):
        storage, balances = snapshot
        self.contract.__dict__.clear()
        self.contract.__dict__.update(storage)
        self.balances.clear()
        self.balances.update(balances)


RUNTIME = Runtime()

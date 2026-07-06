"""Adapter registry: maps source_id -> adapter class.

Adding a source = add a contract YAML + an adapter class + one line here.
The engine never special-cases a source anywhere else.
"""

from __future__ import annotations

from adapters.base import SourceAdapter
from adapters.bls.laus import BlsLausAdapter
from adapters.census.acs import CensusAcsAdapter
from adapters.fema.nri import FemaNriAdapter
from engine.contracts import (
    SourceContract,
    VariableContract,
    load_source_contracts,
    load_variable_contracts,
)

ADAPTERS: dict[str, type[SourceAdapter]] = {
    BlsLausAdapter.source_id: BlsLausAdapter,
    CensusAcsAdapter.source_id: CensusAcsAdapter,
    FemaNriAdapter.source_id: FemaNriAdapter,
}


def build_adapter(
    source_id: str,
    contracts: dict[str, SourceContract] | None = None,
    variables: dict[str, VariableContract] | None = None,
) -> SourceAdapter:
    contracts = contracts or load_source_contracts()
    variables = variables or load_variable_contracts()
    if source_id not in contracts:
        raise KeyError(f"no source contract for '{source_id}' under contracts/sources/")
    if source_id not in ADAPTERS:
        raise KeyError(f"no adapter registered for '{source_id}' (adapters/registry.py)")
    contract = contracts[source_id]
    source_vars = {
        b.variable_id: variables[b.variable_id]
        for b in contract.variables
        if b.variable_id in variables
    }
    return ADAPTERS[source_id](contract, source_vars)

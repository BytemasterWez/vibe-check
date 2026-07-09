from .contracts_finder import ContractsFinderConnector
from .find_a_tender import FindATenderConnector

CONNECTORS = {
    ContractsFinderConnector.name: ContractsFinderConnector,
    FindATenderConnector.name: FindATenderConnector,
}

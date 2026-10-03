import ast
from pathlib import Path

import pytest

DOMAIN_DIR = Path(__file__).parents[2] / "app" / "domain"
GRAPH_AND_ROUTING_MODULES = ["graph.py", "routing.py", "routing_strategies.py", "cross_section.py", "street_grouping.py", "block_identity.py", "traced_boundary.py", "local_projection.py", "covered_areas.py"]
FORBIDDEN_PREFIXES = ("sqlalchemy", "geoalchemy2", "app.persistence", "app.ingestion", "app.routing")


def _imported_module_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


@pytest.mark.parametrize("filename", GRAPH_AND_ROUTING_MODULES)
def test_graph_and_routing_domain_modules_stay_pure(filename):
    path = DOMAIN_DIR / filename
    imported = _imported_module_names(path)

    offending = {name for name in imported if name.startswith(FORBIDDEN_PREFIXES)}

    assert not offending, f"{filename} imports non-domain modules: {offending}"

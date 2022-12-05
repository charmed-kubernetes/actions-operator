from subprocess import run

import pytest
import yaml


def verify_enabled(addon_list: list, desired_addons: set):
    for addon in addon_list:
        name = addon["name"]
        status = addon["status"]
        if name in desired_addons:
            assert status == "enabled", f"For addon {name}"


@pytest.mark.abort_on_fail
async def test_addons(addons: str):
    """Tests whether desired addons are enabled.
    To enable this test add `--addons "ingress dns rbac..."` in your
    call to pytest.
    """
    # Split on spaces
    addons = addons.split()
    addons = set(addons)
    result = run(
        ["sudo", "microk8s", "status", "--format", "yaml"], capture_output=True
    )
    status = yaml.safe_load(result.stdout)
    assert status is not None, f"microk8s status = {result}"
    status = status["addons"]
    verify_enabled(status, addons)

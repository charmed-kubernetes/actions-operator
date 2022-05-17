from subprocess import run
import os
import pytest


@pytest.mark.abort_on_fail
async def test_build(ops_test):
    home_dir = os.environ.get("HOME") or "/tmp"
    run(
        [
            "git",
            "clone",
            "https://github.com/juju-solutions/charm-ubuntu.git",
            f"{home_dir}/charm-ubuntu",
        ]
    )
    await ops_test.build_charm(f"{home_dir}/charm-ubuntu")

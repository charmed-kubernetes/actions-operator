from subprocess import run
import pytest


@pytest.mark.abort_on_fail
async def test_build(ops_test):
    run(
        [
            "git",
            "clone",
            "https://github.com/juju-solutions/charm-ubuntu.git",
            "/home/ubuntu/charm-ubuntu",
        ]
    )
    await ops_test.build_charm("/home/ubuntu/charm-ubuntu")

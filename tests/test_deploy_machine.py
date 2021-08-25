import pytest


@pytest.mark.abort_on_fail
async def test_build(ops_test):
    await ops_test.model.deploy("cs:ubuntu")
    await ops_test.model.wait_for_idle()

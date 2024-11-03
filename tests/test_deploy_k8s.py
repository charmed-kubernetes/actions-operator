import pytest
from subprocess import check_output

from pytest_operator.plugin import OpsTest

@pytest.mark.abort_on_fail
async def test_charm_deploy(ops_test : OpsTest):
    await ops_test.model.deploy("ch:coredns", trust=True)
    await ops_test.model.wait_for_idle()


@pytest.mark.usefixtures("ops_test")
async def test_kubectl():
    # Confirms that kubectl has access to a functional kubeconfig @ $HOME/.kube/config
    out = check_output(["kubectl", "get", "pods", "-A"], text=True)
    assert "kube-system" in out, "should see some kube-system pods"
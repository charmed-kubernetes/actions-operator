import pytest
from subprocess import check_output


@pytest.mark.abort_on_fail
async def test_build(ops_test):
    await ops_test.model.deploy("ch:minio")
    await ops_test.model.wait_for_idle()


@pytest.mark.usefixtures("ops_test")
async def test_kubectl():
    # Confirms that kubectl has access to a functional kubeconfig @ $HOME/.kube/config
    out = check_output(["kubectl", "get", "pods", "-A"], text=True)
    assert "kube-system" in out, "should see some kube-system pods"
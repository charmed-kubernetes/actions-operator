#!/bin/bash

microk8s status --wait-ready
microk8s enable storage dns rbac
# workarounds for https://bugs.launchpad.net/juju/+bug/1937282
microk8s kubectl -n kube-system rollout status deployment/coredns
microk8s kubectl -n kube-system rollout status deployment/hostpath-provisioner
microk8s kubectl create serviceaccount test-sa
for i in {0..12}; do
    if ! microk8s kubectl get secrets | grep -q test-sa-token-; then
        if [[ $i == 12 ]]; then
            echo "Timed out waiting for test SA token"
            exit 1
        fi
        echo "Waiting for test SA token..."
        sleep 10
    else
        break
    fi
done
echo "Found test SA token; removing"
microk8s kubectl delete serviceaccount test-sa

#!/bin/bash

controller_name="$1"
cmd="microk8s kubectl get -n controller-$controller_name pod/controller-0 -o jsonpath='{.metadata.annotations.controller\\.juju\\.is/id}'"

for i in {0..12}; do
    if [[ -z "$cmd" ]]; then
        if [[ $i == 12 ]]; then
            echo "Timed out waiting for controller"
            exit 1
        fi
        echo "Waiting for controller..."
        sleep 10
    fi
done
echo "Controller ready"

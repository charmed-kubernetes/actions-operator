#!/bin/bash

for i in {0..12}; do
    annotation="$(microk8s kubectl get -n "controller-$1" pod/controller-0 -o jsonpath='{.metadata.annotations.controller\.juju\.is/id}')"
    if [[ -z "$annotation" ]]; then
        if [[ $i == 12 ]]; then
            echo "Timed out waiting for controller"
            exit 1
        fi
        echo "Waiting for controller..."
        sleep 10
    else
        break
    fi
done
echo "Controller ready"
microk8s kubectl describe -n "controller-$1" pod/controller-0

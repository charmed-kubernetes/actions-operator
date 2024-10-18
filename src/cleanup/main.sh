#!/bin/bash
set -eu

function _get_input() {
    local __resultvar=$1
    local key=$2
    local default_value=${3:-''}
    local value=$(echo "$INPUT_JSON" | grep -oP '"'"$key"'"\s*:\s*"\K[^"]+')
    value=${value:-$default_value}
    eval $__resultvar="'$value'"
}

function destroy_controller() {
    local controller=$1
    local juju_channel="";
    _get_input juju_channel "juju-channel"

    echo "Removing controller ${controller}..."
    if [[ "${juju_channel}" == 2.9* ]]; then
        juju destroy-controller -y ${controller} --destroy-all-models --destroy-storage
    else
        juju destroy-controller ${controller} --no-prompt --destroy-all-models --destroy-storage
    fi
}

function find_and_upload_juju_crashdump() {
    local crashdump_files=$(find . -name "juju-crashdump-*.tar.xz")

    if [ -z "${crashdump_files}" ]; then
        echo "No juju-crashdump files found."
    else
        for file in ${crashdump_files}; do
            echo "Found crashdump file: ${file}"
            upload_artifact $file
        done
    fi
}

function upload_artifact() {
    local file=$1
    local artifact_name=$(basename $file)

    echo "Uploading artifact not yet implemented: ${artifact_name}"
    echo "::set-output name=artifact::${artifact_name}"
    echo "::set-output name=artifact_path::${file}"
}

function run() {
    local controller=${STATE_CONTROLLER_NAME:-""}
    local provider=""
    _get_input provider "provider"

    echo "Cleaning up ${controller} on ${provider}..."

    if [ -n "${controller}" ]; then
        if [ "${provider}" != "microk8s" ] && [ "${provider}" != "lxd" ]; then
            destroy_controller ${controller}
        fi

        echo "::group::uploading juju-crashdump"
        find_and_upload_juju_crashdump
        echo "::endgroup::"
    fi
}

run
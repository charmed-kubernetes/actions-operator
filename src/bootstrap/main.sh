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

# waitSnapdSeed: wait for snapd to be seeded.
# Optional argument: timeout in seconds, defaults to 60.
function wait_snapd_seed() (
  echo "::group::Waiting for snapd seed..."
  waitSecs="${1:-60}"
  timeout "${waitSecs}" sudo snap wait system seed.loaded
  echo "::endgroup::"
)

function prepare_lxd(){
    echo "::group::Preparing lxd..."
    local lxd_channel=""
    _get_input lxd_channel "lxd-channel"
    
    local current_lxd_channel="$(snap list lxd | grep lxd | awk '{ print $4 }' || true)"
    if [ "${current_lxd_channel}" != "${lxd_channel}" ]; then
        # rather than purge, stop lxd if it's running
        echo "Stopping lxd before refreshing to $lxd_channel with concierge..."
        sudo snap stop lxd || true
    else
        echo "lxd is already at the desired channel: $lxd_channel"
    fi
    echo "::endgroup::"
}

function install_concierge() {
    # The following will eventually just be snap install concierge
    local concierge_channel=""
    _get_input concierge_version "concierge-channel" "latest/stable"

    echo "::group::Installing concierge ${concierge_channel}..."
    sudo snap install concierge --channel="${concierge_channel}" --classic
    echo "::endgroup::"
}

function install_tox_if_needed() {
    local version=""
    _get_input version "tox-version"
    echo "::group::Installing tox..."

    if command -v tox &> /dev/null; then
        echo "Tox is already installed"
        tox --version
    elif command -v pip &> /dev/null; then
        echo "Installing tox with pip..."
        TOX_VERSION_ARG=$([ -n "$version" ] && echo "==$version" || echo "")
        pip install tox$TOX_VERSION_ARG
        echo "::endgroup::"
    else
        echo "Installing tox with apt..."
        sudo apt-get update
        sudo apt-get install python3-tox
    fi
    echo "::endgroup::"
}

function plan_concierge() {
    local provider=""
    local channel=""
    local lxd_channel=""
    local charm_channel=""
    local charmcraft_channel=""
    local juju_channel=""
    local jq_channel=""
    local juju_bundle_channel=""
    local juju_crashdump_channel=""
    local microk8s_addons=""

    _get_input provider "provider"
    _get_input channel "channel"
    _get_input lxd_channel "lxd-channel"
    _get_input charm_channel "charm-channel"
    _get_input charmcraft_channel "charmcraft-channel"
    _get_input juju_channel "juju-channel"
    _get_input jq_channel "jq-channel" "latest/stable"
    _get_input juju_bundle_channel "juju-bundle-channel" "latest/stable"
    _get_input juju_crashdump_channel "juju-crashdump-channel" "latest/stable"
    _get_input microk8s_addons "microk8s-addons"
    if [ ${provider} == "lxd" ]; then lxd_channel=${channel:-$lxd_channel}; fi

    cat <<EOF > concierge.yaml
juju:
  channel: ${juju_channel}
  model-defaults:
    test-mode: true
    automatically-retry-hooks: false
    logging-config: "<root>=DEBUG"
    
providers:
  lxd:
    enable: true
    bootstrap: $( [ "${provider}" == "lxd" ] && echo "true" || echo "false" )
    channel: ${lxd_channel}
EOF
    if [ ${provider} == "microk8s" ]; then
        # Convert space-separated list to JSON array
        microk8s_addons_json=$(echo "$microk8s_addons" | awk '{printf "["; for(i=1;i<=NF;i++) printf "\"%s\"%s", $i, (i<NF?",":""); printf "]"}')
        cat <<EOF >> concierge.yaml
  microk8s:
    enable: true
    bootstrap: true
    channel: ${channel}
    addons: ${microk8s_addons_json}
EOF
    fi
    cat <<EOF >> concierge.yaml
host:
  snaps:
    - charm/${charm_channel}
    - charmcraft/${charmcraft_channel}
    - jq/${jq_channel}
    - juju-bundle/${juju_bundle_channel}
    - juju-crashdump/${juju_crashdump_channel}
    - kubectl
EOF

    echo "::group::Concierge (concierge.yaml):"
    cat concierge.yaml
    echo "::endgroup::"
}

function prepare_concierge() {
    echo "::group::Running concierge..."
    sudo -E concierge prepare --trace -v
    echo "Concierge run complete."

    local CONTROLLER_NAME=$(juju controllers --format json | jq -r '.["current-controller"]')
    echo "CONTROLLER_NAME=${CONTROLLER_NAME}" | tee -a "${GITHUB_ENV}" "${GITHUB_STATE}"
    echo "::endgroup::"
}

function run() {
    wait_snapd_seed
    prepare_lxd
    install_concierge
    install_tox_if_needed
    plan_concierge
    prepare_concierge
}

run
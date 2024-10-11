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
function _wait_snapd_seed() (
  waitSecs="${1:-60}"
  if timeout "${waitSecs}" sudo snap wait system seed.loaded; then
    return 0 # Success.
  fi
  echo "snapd not seeded after ${waitSecs}s"
  return 1 # Failed.
)

function prepare_snapd(){
    echo "::group::Preparing snapd..."
    _wait_snapd_seed
    set -x
    sudo snap list
    sudo snap install snapd && sudo snap refresh snapd
    sudo snap remove --purge lxd || true
    set +x
    echo "::endgroup::"
}

function install_concierge() {
    # The following will eventually just be snap install concierge
    local concierge_version=""
    _get_input concierge_version "concierge-version" "latest"

    echo "::group::Installing concierge ${concierge_version}..."
    export PATH=$PATH:$HOME/go/bin
    sudo snap install go --classic
    go install github.com/jnsgruk/concierge@${concierge_version}
    echo "::endgroup::"
}


function install_tox_if_needed() {
    local version=""
    _get_input version "tox-version"
    echo "Ensuring tox installed..."

    if command -v tox &> /dev/null; then
        echo "tox is already installed"
        tox --version
    elif command -v pip &> /dev/null; then
        echo "::group::Installing tox with pip..."
        TOX_VERSION_ARG=$([ -n "$version" ] && echo "==$version" || echo "")
        pip install tox$TOX_VERSION_ARG
        echo "::endgroup::"
    else
        echo "::group::Installing tox with apt..."
        sudo apt-get update
        sudo apt-get install python3-tox
        echo "::endgroup::"
    fi
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

    echo "::group::Concierge (environment):"
    printenv | sort | grep -i concierge
    echo "::endgroup::"

    echo "::group::Running concierge..."
    set -x
    sudo -E $HOME/go/bin/concierge prepare --trace -v
    set +x
    echo "::endgroup::"

    echo "Concierge run complete."
    local CONTROLLER_NAME=$(juju controllers --format json | jq -r '.["current-controller"]')
    echo "CONTROLLER_NAME=${CONTROLLER_NAME}" | tee -a "${GITHUB_ENV}" "${GITHUB_STATE}"
}

function run() {
    prepare_snapd
    install_concierge
    install_tox_if_needed
    plan_concierge
}

run
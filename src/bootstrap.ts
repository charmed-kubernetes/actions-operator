import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'

// MAIN TASKS
async function wait_snapd_seed() {
  const waitSecs = 60
  core.startGroup('Waiting for snapd seed...')
  await exec.exec('timeout', [
    `${waitSecs}s`,
    'sudo',
    'snap',
    'wait',
    'system',
    'seed.loaded'
  ])
  core.endGroup()
}

async function prepare_lxd() {
  core.startGroup('Preparing LXD...')
  const lxd_channel = core.getInput('lxd-channel')
  var current_lxd_channel = ''
  await exec
    .getExecOutput('snap', ['list', 'lxd'], { ignoreReturnCode: true })
    .then(result => {
      const lines = result.stdout.split('\n')
      if (lines.length > 1 && lines[1].includes('lxd')) {
        current_lxd_channel = lines[1].split(/\s+/)[3]
      }
    })
  if (current_lxd_channel && current_lxd_channel !== lxd_channel) {
    // rather than purge, stop lxd if its running
    core.info(`Stop LXD before refresh from ${current_lxd_channel}...`)
    await exec.getExecOutput('sudo', ['snap', 'stop', 'lxd'], {
      ignoreReturnCode: true
    })
  }
  core.endGroup()
}

async function install_concierge() {
  const concierge_channel =
    core.getInput('concierge-channel') || 'latest/stable'
  core.startGroup(`Installing Concierge from ${concierge_channel}...`)
  await exec.exec(
    `sudo snap install concierge --channel=${concierge_channel} --classic`
  )
  core.endGroup()
}

async function install_tox_if_needed() {
  const version = core.getInput('tox-version')
  core.startGroup('Prepare tox')

  const { exitCode } = await exec.getExecOutput('which', ['tox'], {
    ignoreReturnCode: true
  })
  if (exitCode === 0) {
    core.info('tox is already installed')
  } else {
    const { exitCode } = await exec.getExecOutput('which', ['pip'], {
      ignoreReturnCode: true
    })
    if (exitCode === 0) {
      core.info('Installing tox with pip...')
      await exec.exec(`pip install tox${version ? `==${version}` : ''}`)
    } else {
      core.info('Installing tox with apt...')
      await exec.exec(
        'sudo apt-get update && sudo apt-get install -y python3-tox'
      )
    }
  }

  core.endGroup()
}

function plan_concierge() {
  const provider = core.getInput('provider')
  const channel = core.getInput('channel')
  var lxd_channel = core.getInput('lxd-channel')
  if (provider === 'lxd' && channel) {
    lxd_channel = channel
  }
  const microk8s =
    provider !== 'microk8s'
      ? {}
      : {
          enable: true,
          bootstrap: true,
          channel: channel,
          addons: core.getInput('microk8s-addons').split(/\s+/)
        }

  var conciergePlan = {
    juju: {
      channel: core.getInput('juju-channel'),
      'model-defaults': {
        'test-mode': true,
        'automatically-retry-hooks': false,
        'logging-config': '<root>=DEBUG'
      }
    },
    providers: {
      lxd: {
        enable: true,
        channel: lxd_channel,
        bootstrap: provider === 'lxd'
      },
      microk8s
    },
    host: {
      snaps: {
        charm: {
          channel: core.getInput('charm-channel')
        },
        charmcraft: {
          channel: core.getInput('charmcraft-channel')
        },
        jq: {
          channel: core.getInput('jq-channel') || 'latest/stable'
        },
        'juju-bundle': {
          channel: core.getInput('juju-bundle-channel') || 'latest/stable'
        },
        'juju-crashdump': {
          channel: core.getInput('juju-crashdump-channel') || 'latest/stable'
        }
      }
    }
  }

  core.startGroup('Concierge JSON')
  const asJson = JSON.stringify(conciergePlan, null, 2)
  core.info(asJson)
  fs.writeFileSync('concierge.yaml', asJson, { encoding: 'utf8' })
  core.endGroup()
}

async function prepare_concierge() {
  core.startGroup('Running Concierge...')
  await exec.exec('sudo -E concierge prepare --trace -v')
  const { stdout } = await exec.getExecOutput('juju', [
    'show-controller',
    '--format',
    'json'
  ])
  const controllers = JSON.parse(stdout)
  core.saveState('CONTROLLER_NAME', controllers['current-controller'])
  core.endGroup()
}

export async function run(): Promise<void> {
  await wait_snapd_seed()
  await prepare_lxd()
  await install_concierge()
  await install_tox_if_needed()
  await plan_concierge()
  await prepare_concierge()
}

run()

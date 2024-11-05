import { DefaultArtifactClient } from '@actions/artifact'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'

const artifact = new DefaultArtifactClient()

// POST TASKS
async function destroy_controller(controller: string) {
  const juju_channel = core.getInput('juju-channel')
  core.info(`Removing controller ${controller}...`)
  const forced = juju_channel.startsWith('2.9') ? '-y' : '--no-prompt'

  await exec.exec(
    `juju destroy-controller ${forced} ${controller} --destroy-all-models --destroy-storage`
  )
}

async function find_juju_crashdump(): Promise<string[]> {
  const globber = await glob.create('**/juju-crashdump-*.tar.xz')
  return globber.glob()
}

async function upload_artifact(files: string[]) {
  const result = await artifact.uploadArtifact('juju-crashdump', files, '.')
  core.info(`artifact ${result.id} (${result.size}) was uploaded`)
}

export async function run(): Promise<void> {
  const controller = core.getState('CONTROLLER_NAME')
  const provider = core.getInput('provider')

  try {
    if (controller) {
      core.info(`Cleaning up ${controller} on ${provider}...`)
      if (!['microk8s', 'lxd'].includes(provider)) {
        await destroy_controller(controller)
      }
    }

    core.startGroup('Uploading juju-crashdump')
    const crash_dumps: string[] = await find_juju_crashdump()
    if (crash_dumps.length > 0) {
      core.info(`found juju-crashdump: ${crash_dumps}`)
      await upload_artifact(crash_dumps)
    } else {
      core.info('no juju-crashdump was found')
    }
    core.endGroup()
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

run()

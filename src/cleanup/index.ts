import {DefaultArtifactClient} from '@actions/artifact';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import {randomBytes} from 'crypto';

declare let process : {
    env: {
        [key: string]: string
    }
}

async function find_juju_crashdump(): Promise<string[]> {
    const globber = await glob.create('**/juju-crashdump-*.tar.xz');
    return globber.glob();
}

async function unique_number(): Promise<string> {
    const dataBuffer = randomBytes(16);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function upload_artifact(files: string[]) {
    const artifact_client = new DefaultArtifactClient()
    let artifact_name = core.getInput("juju-crashdump-artifact-name");
    if (!artifact_name) {
        artifact_name = `juju-crashdump-${await unique_number()}`;
    }
    core.info(`uploading artifact ${artifact_name}`);
    const {id, size} = await artifact_client.uploadArtifact(artifact_name, files, ".");
    core.info(`artifact ${id} (${size}) was uploaded`);
}

async function destroy_controller(controller_name: string) {
    const juju_channel = core.getInput("juju-channel");
    if ( juju_channel.includes("2.9") ) {
        await exec.exec(`juju destroy-controller -y ${controller_name} --destroy-all-models --destroy-storage`);
    } else {
        await exec.exec(`juju destroy-controller ${controller_name} --no-prompt --destroy-all-models --destroy-storage`);
    }
}

async function run() {
    const controller_name = process.env["CONTROLLER_NAME"];
    const provider = core.getInput("provider");

    try {
        if (controller_name) {
            core.addPath('/snap/bin');
            if (!["microk8s", "lxd"].includes(provider)) {
                await destroy_controller(controller_name);
            }
            if (provider === "microstack") {
                await exec.exec("rm -rf /tmp/simplestreams");
                await exec.exec("openstack image delete focal");
                await exec.exec("juju remove-credential microstack admin --client");
                await exec.exec("juju remove-cloud microstack --client");
            }
        }

        core.startGroup("uploading juju-crashdump");
        const crash_dumps: string[] = await find_juju_crashdump();
        if (crash_dumps.length > 0) {
            core.info(`found juju-crashdump: ${crash_dumps}`);
            await upload_artifact(crash_dumps);
        } else {
            core.info("no juju-crashdump was found")
        }
        core.endGroup();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch(error: any) {
        core.setFailed(error.message);
    }
}


run();

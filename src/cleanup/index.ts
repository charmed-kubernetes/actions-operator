import * as core from '@actions/core';
import * as exec from '@actions/exec';

declare var process : {
    env: {
        [key: string]: string
    }
}

async function run() {
    const controller_name = process.env["CONTROLLER_NAME"];
    try {
        if (controller_name) {
            core.addPath('/snap/bin');
            await exec.exec(`juju destroy-controller -y ${controller_name} --destroy-all-models --destroy-storage`)
        }
    } catch(error) {
        core.setFailed(error.message);
    }
}


run();

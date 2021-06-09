import * as core from '@actions/core';
import * as exec from '@actions/exec';

declare var process : {
    env: {
        [key: string]: string
    }
}

async function run() {
    const controller_name = process.env["CONTROLLER_NAME"];
    const provider = core.getInput("provider");
    try {
        if (controller_name) {
            core.addPath('/snap/bin');
            await exec.exec(`juju destroy-controller -y ${controller_name} --destroy-all-models --destroy-storage`);
            if (provider === "microstack") {
                await exec.exec("rm -rf /tmp/simplestreams");
                await exec.exec("openstack image delete focal");
                await exec.exec("juju remove-credential microstack admin --client");
                await exec.exec("juju remove-cloud microstack --client");
            }
        }
    } catch(error) {
        core.setFailed(error.message);
    }
}


run();

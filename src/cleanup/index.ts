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
            if (provider === "microk8s") {
                // Sometimes K8s takes a really long time to acknowledge to Juju that a resource has been
                // cleaned up and thus Juju gets stuck on destroying the controller. Forcibly clean up any
                // models without waiting for acknowledgement from K8s to avoid a timeout while cleaning up.
                await exec.exec('sg microk8s -c "juju models --format=json | jq -r \'.models[].\\"short-name\\"\' | grep -v controller | xargs juju destroy-model --destroy-storage --force --no-wait -y"');
            }
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

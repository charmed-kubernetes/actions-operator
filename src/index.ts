import * as core from '@actions/core';
import * as exec from '@actions/exec';

declare var process : {
    env: {
        [key: string]: string
    }
}

async function run() {
    const GITHUB_SHA = process.env["GITHUB_SHA"].slice(0, 5)

    var known_providers: string[] = ["aws", "azure", "google", "lxd"]
    const provider = core.getInput("provider");
    const bootstrap_options = `github-pr-${GITHUB_SHA} --model-default test-mode=true --model-default image-stream=daily --model-default automatically-retry-hooks=false --model-default logging-config="<root>=DEBUG"`
    try {
        core.addPath('/snap/bin');
        await exec.exec("pip3 install tox");
        if(known_providers.includes(provider)) {
            if (provider === "lxd") {
                await exec.exec("sudo apt-get remove -qy lxd lxd-client");
                await exec.exec("sudo snap install core");
                await exec.exec("sudo snap install lxd");
                await exec.exec("sudo lxd waitready");
                await exec.exec("sudo lxd init --auto");
                await exec.exec("sudo chmod a+wr /var/snap/lxd/common/lxd/unix.socket");
                await exec.exec("lxc network set lxdbr0 ipv6.address none");
                await exec.exec("sudo snap install juju --classic");
                await exec.exec(`juju bootstrap localhost/localhost ${bootstrap_options}`);
            }

            if (provider === "aws") {
                await exec.exec(`juju bootstrap aws/us-east-1 ${bootstrap_options}`);
            }
        } else {
            core.setFailed(`Unknown provider: ${provider}`);
        }
    } catch(error) {
        core.setFailed(error.message);
    }
}

run();

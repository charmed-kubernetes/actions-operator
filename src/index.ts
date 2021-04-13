import * as core from '@actions/core';
import * as exec from '@actions/exec';

declare var process : {
    env: {
        [key: string]: string
    }
}

async function run() {
    const GITHUB_SHA = process.env["GITHUB_SHA"].slice(0, 5)

    let known_providers = new Map([
        ["aws", "aws/us-east-1"],
        ["lxd", "localhost/localhost"],
        ["microk8s", "microk8s"]
    ])
    const provider = core.getInput("provider");
    const bootstrap_options = `github-pr-${GITHUB_SHA} --bootstrap-constraints "cores=2 mem=4G" --model-default test-mode=true --model-default image-stream=daily --model-default automatically-retry-hooks=false --model-default logging-config="<root>=DEBUG"`
    try {
        core.addPath('/snap/bin');
        await exec.exec("pip3 install tox");
        if(known_providers.has(provider)) {
            let bootstrap_command = `juju bootstrap --debug --verbose ${known_providers.get(provider)} ${bootstrap_options}`
            if (provider === "lxd") {
                await exec.exec("sudo apt-get remove -qy lxd lxd-client");
                await exec.exec("sudo snap install core");
                await exec.exec("sudo snap install lxd");
                await exec.exec("sudo lxd waitready");
                await exec.exec("sudo lxd init --auto");
                await exec.exec("sudo chmod a+wr /var/snap/lxd/common/lxd/unix.socket");
                await exec.exec("lxc network set lxdbr0 ipv6.address none");
                await exec.exec("sudo snap install juju --classic");
            } else if (provider === "microk8s") { 
	              await exec.exec("sudo snap install microk8s --classic")
	              await exec.exec("sudo snap install juju --classic")
	              await exec.exec('bash', ['-c', 'sudo usermod -a -G microk8s $USER'])
	              await exec.exec('sg microk8s -c "microk8s status --wait-ready"')
	              await exec.exec('sg microk8s -c "microk8s enable storage dns"')
                bootstrap_command = `sg microk8s -c "${bootstrap_command}"`
            }

            await exec.exec(bootstrap_command)
        } else {
            core.setFailed(`Unknown provider: ${provider}`);
        }
    } catch(error) {
        core.setFailed(error.message);
    }
}

run();
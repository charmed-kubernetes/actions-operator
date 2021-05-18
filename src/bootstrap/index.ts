import * as core from '@actions/core';
import * as exec from '@actions/exec';

declare var process : {
    env: {
        [key: string]: string
    }
}

async function run() {
    const HOME = process.env["HOME"]
    const GITHUB_SHA = process.env["GITHUB_SHA"].slice(0, 5)

    const provider = core.getInput("provider");
    const credentials_yaml = core.getInput("credentials-yaml");
    const clouds_yaml = core.getInput("clouds-yaml");
    const extra_bootstrap_options = core.getInput("bootstrap-options");
    const controller_name = `github-pr-${GITHUB_SHA}`;
    const bootstrap_options = `${controller_name} --bootstrap-constraints "cores=2 mem=4G" --model-default test-mode=true --model-default image-stream=daily --model-default automatically-retry-hooks=false --model-default logging-config="<root>=DEBUG" ${extra_bootstrap_options}`;
    try {
        core.addPath('/snap/bin');
        core.startGroup("Install tox")
        await exec.exec("sudo apt-get update -yqq");
        await exec.exec("sudo apt-get install -yqq python3-pip");
        await exec.exec("pip3 install tox");
        core.endGroup()
        await exec.exec("sudo snap install jq");
        let bootstrap_command = `juju bootstrap --debug --verbose ${provider} ${bootstrap_options}`
        if (provider === "lxd") {
	    const options: exec.ExecOptions = {}
	    options.ignoreReturnCode = true;
            await exec.exec("sudo apt-get remove -qy lxd lxd-client", [], options);
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
        } else if (credentials_yaml != "") {
	    const options: exec.ExecOptions = {}
	    options.silent = true;
            const juju_dir = `${HOME}/.local/share/juju`;
            await exec.exec("sudo snap install juju --classic");
            await exec.exec(`mkdir -p ${juju_dir}`)
            await exec.exec("bash", ["-c", `echo "${credentials_yaml}" | base64 -d > ${juju_dir}/credentials.yaml`], options);
            if (clouds_yaml != "" ) {
                await exec.exec("bash", ["-c", `echo "${clouds_yaml}" | base64 -d > ${juju_dir}/clouds.yaml`], options);
            }
        } else {
            core.setFailed(`Custom provider set without credentials: ${provider}`);
            return
        }

        await exec.exec(bootstrap_command);
        core.exportVariable('CONTROLLER_NAME', controller_name);
    } catch(error) {
        core.setFailed(error.message);
    }
}

run();

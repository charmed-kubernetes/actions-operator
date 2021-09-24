import * as core from '@actions/core';
import * as exec from '@actions/exec';

declare var process : {
    env: {
        [key: string]: string
    }
}

const ignoreFail: exec.ExecOptions = {"ignoreReturnCode": true}

async function exec_as_microk8s(cmd, options = {}) {
    return await exec.exec('sg', ['microk8s', '-c', cmd], options);
}

async function microk8s_init() {
    // microk8s needs some additional things done to ensure it's ready for Juju.
    await exec_as_microk8s("microk8s status --wait-ready");
    await exec_as_microk8s("microk8s enable storage dns rbac");
    // workarounds for https://bugs.launchpad.net/juju/+bug/1937282
    await exec_as_microk8s("microk8s kubectl -n kube-system rollout status deployment/coredns");
    await exec_as_microk8s("microk8s kubectl -n kube-system rollout status deployment/hostpath-provisioner");
    await exec_as_microk8s("microk8s kubectl create serviceaccount test-sa");
    let rc = 0;
    console.log("Waiting for test SA token...");
    for(let i = 0; i < 12; i++) {
        rc = await exec_as_microk8s("microk8s kubectl get secrets | grep -q test-sa-token-", ignoreFail);
        if(rc == 0) {
            break;
        }
        if(i == 12) {
            core.setFailed("Timed out waiting for test SA token");
            return false;
        }
        // sleep 10s
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
    console.log("Found test SA token; removing");
    await exec_as_microk8s("microk8s kubectl delete serviceaccount test-sa");
    return true;
}

async function run() {
    const HOME = process.env["HOME"]
    const GITHUB_SHA = process.env["GITHUB_SHA"].slice(0, 5)

    const provider = core.getInput("provider");
    const channel = core.getInput("channel");
    const credentials_yaml = core.getInput("credentials-yaml");
    const clouds_yaml = core.getInput("clouds-yaml");
    const extra_bootstrap_options = core.getInput("bootstrap-options");
    const controller_name = `github-pr-${GITHUB_SHA}`;
    const bootstrap_options = `${controller_name} --bootstrap-constraints "cores=2 mem=4G" --model-default test-mode=true --model-default image-stream=daily --model-default automatically-retry-hooks=false --model-default logging-config="<root>=DEBUG" ${extra_bootstrap_options}`;
    try {
        core.addPath('/snap/bin');
        core.startGroup("Install core snap");
        // This can prevent a udev issue when installing other snaps.
        await exec.exec("sudo snap install core");
        core.endGroup();
        // LXD is now a pre-req for building any charm with charmcraft
        core.startGroup("Install LXD");
        await exec.exec("sudo apt-get remove -qy lxd lxd-client", [], ignoreFail);
        await exec.exec("sudo snap install lxd");
        core.endGroup();
        core.startGroup("Initialize LXD");
        await exec.exec("sudo lxd waitready");
        await exec.exec("sudo lxd init --auto");
        await exec.exec("sudo chmod a+wr /var/snap/lxd/common/lxd/unix.socket");
        await exec.exec("lxc network set lxdbr0 ipv6.address none");
        await exec.exec('bash', ['-c', 'sudo usermod -a -G lxd $USER']);
        core.endGroup();
        core.startGroup("Install tox");
        await exec.exec("sudo apt-get update -yqq");
        await exec.exec("sudo apt-get install -yqq python3-pip");
        await exec.exec("sudo --preserve-env=http_proxy,https_proxy,no_proxy pip3 install tox");
        core.endGroup();
        core.startGroup("Install Juju");
        await exec.exec("sudo snap install juju --classic");
        core.endGroup();
        core.startGroup("Install tools");
        await exec.exec("sudo snap install jq");
        await exec.exec("sudo snap install charm --classic");
        await exec.exec("sudo snap install charmcraft --classic");
        core.endGroup();
        let bootstrap_command = `juju bootstrap --debug --verbose ${provider} ${bootstrap_options}`
        if (provider === "lxd") {
	    if (channel !== null){
		await exec.exec(`sudo snap refresh lxd --channel=${channel}`);
	    }
        } else if (provider === "microk8s") {
            core.startGroup("Install microk8s");
	    if (channel !== null){
		await exec.exec(`sudo snap install microk8s --classic --channel=${channel}`);
	    } else {
            	await exec.exec("sudo snap install microk8s --classic");
	    }
            core.endGroup();
            core.startGroup("Initialize microk8s");
            await exec.exec('bash', ['-c', 'sudo usermod -a -G microk8s $USER']);
            if(!await microk8s_init()) {
                return;
            }
            bootstrap_command = `sg microk8s -c '${bootstrap_command}'`
            core.endGroup();
        } else if (provider === "microstack") {
            core.startGroup("Install MicroStack");
            let os_series = "focal";
            let os_region = "microstack";
	    if (channel !== null){
            	await exec.exec(`sudo snap install microstack --beta --devmode --channel=${channel}`);
	    } else {
            	await exec.exec("sudo snap install microstack --beta --devmode");
	    }
            await exec.exec("sudo snap alias microstack.openstack openstack");
            core.endGroup();
            core.startGroup("Initialize MicroStack");
            await exec.exec("sudo microstack init --auto --control");
            // note (rgildein): enable ipv4 ip forwarding is necessary for machine to have internet access
            //                  https://bugs.launchpad.net/microstack/+bug/1812415
            await exec.exec("sudo sysctl net.ipv4.ip_forward=1");
            await exec.exec("bash", ["-c", `curl http://cloud-images.ubuntu.com/${os_series}/current/${os_series}-server-cloudimg-amd64.img | openstack image create --public --container-format=bare --disk-format=qcow2 ${os_series}`]);
            await exec.exec("mkdir -p /tmp/simplestreams");
            await exec.exec("bash", ["-c", `juju metadata generate-image -d /tmp/simplestreams -s ${os_series} -i "$(openstack image show ${os_series} -f value -c id)" -r ${os_region} -u http://10.20.20.1:5000/v3`]);
            await exec.exec("bash", ["-c", "echo '{clouds: {microstack: {type: openstack, auth-types: [access-key,userpass], regions: {microstack: {endpoint: http://10.20.20.1:5000/v3}}}}}' > /tmp/clouds.json"]);
            await exec.exec("juju add-cloud microstack --client -f /tmp/clouds.json");
            await exec.exec("bash", ["-c", 'source /var/snap/microstack/common/etc/microstack.rc && echo "{credentials: {microstack: {admin: {auth-type: userpass, username: $OS_USERNAME, password: $OS_PASSWORD, project-domain-name: $OS_PROJECT_DOMAIN_NAME, tenant-name: $OS_PROJECT_NAME, user-domain-name: $OS_USER_DOMAIN_NAME, version: \'$OS_IDENTITY_API_VERSION\'}}}}" > /tmp/credentials.json']);
            await exec.exec("juju add-credential microstack --client -f /tmp/credentials.json");
            core.endGroup();
            // note (rgildein): remove image-stream=daily
            bootstrap_command = bootstrap_command.replace(" --model-default image-stream=daily", "");
            bootstrap_command = `${bootstrap_command} --bootstrap-series=${os_series} --metadata-source=/tmp/simplestreams --model-default network=test --model-default external-network=external --bootstrap-constraints=\"allocate-public-ip=true\"`
        } else if (credentials_yaml != "") {
	    const options: exec.ExecOptions = {}
	    options.silent = true;
            const juju_dir = `${HOME}/.local/share/juju`;
            await exec.exec("mkdir", ["-p", juju_dir], options);
            await exec.exec("bash", ["-c", `echo "${credentials_yaml}" | base64 -d > ${juju_dir}/credentials.yaml`], options);
            if (clouds_yaml != "" ) {
                await exec.exec("bash", ["-c", `echo "${clouds_yaml}" | base64 -d > ${juju_dir}/clouds.yaml`], options);
            }
        } else {
            core.setFailed(`Custom provider set without credentials: ${provider}`);
            return
        }

        core.startGroup("Bootstrap controller");
        await exec.exec(bootstrap_command);
        core.endGroup();
        if (provider === "microk8s") {
            core.startGroup("Post-bootstrap");
            // microk8s is the only provider that doesn't add a (non-controller) model during bootstrap.
            // Tests using pytest-operator will create their own model, but for those that don't, we
            // shouldn't leave them with the controller potentially conflicting with things they add
            // to the model.
            await exec_as_microk8s("juju add-model testing")
            core.endGroup();
        }
        core.exportVariable('CONTROLLER_NAME', controller_name);
    } catch(error) {
        core.setFailed(error.message);
    }
}

run();

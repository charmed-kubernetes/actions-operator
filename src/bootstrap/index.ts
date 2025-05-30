import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as os from 'os';
import semver from 'semver';
import dedent from 'ts-dedent';
import { retryAsyncDecorator } from 'ts-retry/lib/cjs/retry/utils';

const SYSTEM_PIP_PATH = "/usr/bin/pip"

declare let process : {
    env: {
        [key: string]: string
    }
}

const ignoreFail: exec.ExecOptions = {"ignoreReturnCode": true}
const user = os.userInfo().username

const checkOutput = async (cmd: string, args?: string[], options?: exec.ExecOptions) => {
    let stdout_buf = '';
    options = options || {};
    options.listeners = {
        stdout: (data: Buffer) => { stdout_buf += data.toString() }
    };
    await exec.exec(cmd, args, options);
    return stdout_buf
}

const os_release = async () => {
    // Read os-release file into an object
    const output = await checkOutput('cat', ['/etc/os-release']);
    const data: { [name:string]: string} = {};
    output.split('\n').forEach(function(line){
        const [key, value] = line.split("=", 2);
        data[key] = value
    })
    return data
}

const snap_version = async (snap_name: string) => {
    // Get the version of a snap
    const output = await checkOutput("snap", ["list", snap_name, "--color=never"]);
    const lines = output.split('\n');
    if (lines.length < 2) {
        throw new Error(`snap ${snap_name} not found`)
    }
    const snap_line = lines[1].split(/\s+/);
    if (snap_line.length < 2) {
        throw new Error(`snap ${snap_name} version not found`)
    }
    return snap_line[1]
}

const microk8sKubeConfig = async () => {
    // Get kubeconfig from microk8s
    let kubeconfig = ""
    const options = {
        silent: true,
        listeners: {
            stdout: (data: Buffer) => { kubeconfig += data.toString() }
        }
    };
    await exec_as_microk8s("microk8s config", options);
    fs.writeFileSync(`${os.homedir()}/.kube/config`, kubeconfig, {encoding: 'utf8'});
}

const docker_lxd_clash = async () => {
    // Work-around clash between docker and lxd on jammy
    // https://github.com/docker/for-linux/issues/1034
    await exec.exec(`sudo iptables -F FORWARD`)
    await exec.exec(`sudo iptables -P FORWARD ACCEPT`)
}

function get_microk8s_group() {
    const microk8s_group = core.getInput("microk8s-group");
    if ([null, ""].includes(microk8s_group)) {
        // The group was not supplied (defaults to ""), pick a sensible value depending on strictness
        const channel = core.getInput("channel");
        if (channel.includes('strict')) {
            return "snap_microk8s"
        } else {
            return "microk8s"
        }
    } else {
        // User specified a group name so return it
        return microk8s_group
    }
}


async function exec_as_microk8s(cmd: string, options = {}) {
    const group = get_microk8s_group();
    return await exec.exec(`sudo -g ${group} -E ${cmd}`, [], options);
}

async function retry_until_rc(cmd: string, expected_rc=0, maxRetries=12, timeout=10000) {
    for (let i = 0; i < maxRetries; i++) {
        const rc = await exec_as_microk8s(cmd, ignoreFail);
        if (rc == expected_rc) {
            return true;
        }
        core.info(`Command ${cmd} failed with return code ${rc}. Will retry after ${timeout}ms`);

        await new Promise(resolve => setTimeout(resolve, timeout));
    }
    core.error(`Command ${cmd} failed ${maxRetries} times, giving up`);
    return false;
}

async function microk8s_init(channel, addons, container_registry_url:string) {
    // microk8s needs some additional things done to ensure it's ready for Juju.
    // Add container registry configuration if given.
    if (container_registry_url) {
        const versionMatch = channel.match(/\d+\.\d+/g);
        if (versionMatch && parseFloat(versionMatch[0]) <= 1.22) {
            const templateFile = "/var/snap/microk8s/current/args/containerd-template.toml";
            let template = "";
            await exec.exec("sudo", ["cat", templateFile], {
                    listeners: {
                        stdout: (data) => { template += data.toString() }
                    }
                }
            )
            await exec.exec(
              "sudo", ["tee", templateFile],
              {input: Buffer.from(template.replace("https://registry-1.docker.io", container_registry_url))}
            );
        } else {
            let hostname;
            let port;
            try {
                const url = new URL(container_registry_url);
                hostname = url.hostname;
                port = url.port;
            } catch (err) {
                core.setFailed(`Failed to parse URL of container registry for microk8s: ${err}`);
                return false;
            }
            const content = dedent`
            server = "${container_registry_url}"

            [host."${hostname}:${port}"]
            capabilities = ["pull", "resolve"]

            `;
            await exec.exec(
              "sudo", ["tee", "/var/snap/microk8s/current/args/certs.d/docker.io/hosts.toml"],
              {input: Buffer.from(content)}
            );
        }
        await exec.exec("sudo", ["microk8s", "stop"])
        await exec.exec("sudo", ["microk8s", "start"])
    }

    // Add the given addons if any were given.
    await exec_as_microk8s("microk8s status --wait-ready --timeout=600");
    if (addons) {
        await exec.exec(`sudo microk8s enable ${addons}`);
    }

    // get microk8s version
    const mk8s_ver = await snap_version("microk8s")

    // workarounds for https://bugs.launchpad.net/juju/+bug/1937282
    if (! await retry_until_rc("microk8s kubectl -n kube-system rollout status deployment/coredns")) {
        core.setFailed("Timed out waiting for CoreDNS");
        return false;
    };
    if (! await retry_until_rc("microk8s kubectl -n kube-system rollout status deployment/hostpath-provisioner")) {
        core.setFailed("Timed out waiting for Storage");
        return false;
    };
    if (semver.lt(mk8s_ver, '1.24.0')) {
        await exec_as_microk8s("microk8s kubectl create serviceaccount test-sa");
        if (! await retry_until_rc("bash -c 'microk8s kubectl get secrets | grep -q test-sa-token-'")) {
            core.setFailed("Timed out waiting for test SA token");
            return false;
        };
        core.info("Found test SA token; removing");
        await exec_as_microk8s("microk8s kubectl delete serviceaccount test-sa");
    }

    await retry_until_rc("microk8s kubectl auth can-i create pods")
    return true;
}


const _retryable_exec = (command: string, initial: number = 10, maxTry: number = 5) => {
    // returns an async method capable of running the prog with sudo
    const fn = async (cmd_arg:string, args?: string[], options?: exec.ExecOptions): Promise<number> => {
        // Run a command with sudo yielding the awaited Promise result
        return await exec.exec(`sudo ${command} ${cmd_arg}`, args, options);
    };
    // exponential backoff using initial=10, maxTry=5
    //    10ms
    //    100ms
    //    1s
    //    10s
    //    100s
    const backoff = (param) => param.lastDelay !== undefined ? param.lastDelay * initial : initial;
    return retryAsyncDecorator(fn, {delay: backoff, maxTry: maxTry});
};
const snap = _retryable_exec("snap");
const apt_get = _retryable_exec("apt-get");

async function snap_install(name: string, channel: string="", classic: boolean=true) {
    const args = new Array<string>("install", name, `--channel=${channel}`);
    if (classic) {args.push("--classic")}
    await snap(args.join(" "))
}

function fixed_revision_args(app:string, channel:string, arch:string): string{
    if (!channel) {
        // Securely pin snap versions by arch
        // snap versions are determined via API request to snapstore
        // https://api.snapcraft.io/v2/snaps/info/<SNAP>?architecture=<ARCH>&fields=revision
        const pinning = {
            amd64:   {"juju-bundle": 25, jq: 6, "juju-crashdump": 271},
            arm64:   {"juju-bundle": 25, jq: 8, "juju-crashdump": 272},
            s390x:   {                   jq: 9, "juju-crashdump": 247},
            ppc64el: {                   jq: 4, "juju-crashdump": 217},
        };
        const arch_pins = pinning[arch.trim()]
        if ( arch_pins === undefined) {
            core.error(`Unsupported architecture ${arch}`);
            return "";
        }
        if ( arch_pins[app] === undefined) {
            core.error(`Unsupported app ${app} for architecture ${arch}`);
            return "";
        }
        return `--revision=${arch_pins[app]}`
    }
    return `--channel=${channel}`
}


async function install_tox(tox_version: string = "") {
    // Install tox if it's not already installed
    const hasTox = await exec.exec("which tox", [], ignoreFail);
    if (hasTox == 0) {
        core.info("tox is already installed");
        exec.exec("tox --version");
        return;
    }
    const version = tox_version ? `==${tox_version}` : "";
    const pip_path = (await checkOutput("which", ["pip"], ignoreFail)).trim();
    const is_sys_pip = pip_path === SYSTEM_PIP_PATH;
    // Avoid installing on system managed Python which may break system dependencies.
    if (pip_path && !is_sys_pip) {
        core.info(`externally managed pip is available, installing tox${version}`)
        await exec.exec(`pip install tox${version}`)
        return
    }
    const hasPipx = await exec.exec("which pipx", [], ignoreFail);
    if (hasPipx === 0) {
        core.info(`pipx is available, installing tox${version}`)
        await exec.exec(`pipx install tox${version}`)
        return;
    }
    core.info("Neither pip, pipx nor tox are available, install pipx via apt then tox");
    await apt_get("update -yqq");
    await apt_get("install -yqq pipx");
    await exec.exec("pipx ensurepath");
    await exec.exec("sudo pipx ensurepath");
    await exec.exec(`pipx install tox${version}`);
}


async function run() {
    const HOME = process.env["HOME"]
    const GITHUB_SHA = process.env["GITHUB_SHA"].slice(0, 5)

    const provider = core.getInput("provider");
    const channel = core.getInput("channel");
    const credentials_yaml = core.getInput("credentials-yaml");
    const clouds_yaml = core.getInput("clouds-yaml");
    const extra_bootstrap_options = core.getInput("bootstrap-options");
    const controller_name = `github-pr-${GITHUB_SHA}-${provider}`;
    const bootstrap_options = `${controller_name} --model-default test-mode=true --model-default automatically-retry-hooks=false --model-default logging-config="<root>=DEBUG" ${extra_bootstrap_options}`;
    const charm_channel = core.getInput("charm-channel");
    const charmcraft_channel = core.getInput("charmcraft-channel");
    const juju_channel = core.getInput("juju-channel");
    const juju_bundle_channel = core.getInput("juju-bundle-channel");
    const juju_crashdump_channel = core.getInput("juju-crashdump-channel")
    const tox_version = core.getInput("tox-version");

    const lxd_channel = (provider === "lxd" && channel) ? channel : core.getInput("lxd-channel");

    const microk8s_group = get_microk8s_group();
    let bootstrap_constraints = core.getInput("bootstrap-constraints");
    const microk8s_addons = core.getInput("microk8s-addons")
    const container_registry_url = core.getInput("container-registry-url") || process.env["CONTAINER_REGISTRY_URL"]
    let group = "";
    try {
        core.addPath('/snap/bin');
        core.startGroup("Install core snap");
        // This can prevent a udev issue when installing other snaps.
        await snap("install core");
        core.endGroup();
        // LXD is now a pre-req for building any charm with charmcraft
        core.startGroup("Install LXD");
        await apt_get("remove -qy lxd lxd-client", [], ignoreFail);
        // Informational
        await snap("list lxd", [], ignoreFail);
        // Install LXD -- If it's installed, rc=0 and a warning about using snap refresh appears
        await snap(`install lxd --channel=${lxd_channel}`);
        // Refresh LXD to the desired channel
        await snap(`refresh lxd --channel=${lxd_channel}`);
        core.endGroup();
        core.startGroup("Initialize LXD");
        await exec.exec("sudo lxd waitready");
        await exec.exec("sudo lxd init --auto");
        await exec.exec("sudo chmod a+wr /var/snap/lxd/common/lxd/unix.socket");
        await exec.exec("lxc network set lxdbr0 ipv6.address none");
        await exec.exec(`sudo usermod -a -G lxd ${user}`);
        core.endGroup();
        core.startGroup("Install tox");
        await install_tox(tox_version);
        core.endGroup();
        core.startGroup("Install Juju");
        await snap_install("juju", juju_channel, juju_channel.includes("2.9"));
        core.endGroup();
        core.startGroup("Install tools");
        await snap(`install charm --classic --channel=${charm_channel}`);
        await snap(`install charmcraft --classic --channel=${charmcraft_channel}`);

        let arch = "";
        const dpkg = _retryable_exec("dpkg");
        const dpkg_output = {listeners:{stdout: (data: Buffer) => {arch += data.toString();}}};
        await dpkg("--print-architecture", [], dpkg_output)

        let args = "";
        if ((args = fixed_revision_args("jq", "", arch)).length > 0) {
            await snap(`install jq ${args}`);
        }
        if ((args = fixed_revision_args("juju-bundle", juju_bundle_channel, arch)).length > 0) {
            await snap(`install juju-bundle --classic ${args}`);
        }
        if ((args = fixed_revision_args("juju-crashdump", juju_crashdump_channel, arch)).length > 0) {
            await snap(`install juju-crashdump --classic ${args}`);
        }

        const release = await os_release();
        const version_id = semver.coerce(release["VERSION_ID"], {loose: true});
        if (version_id && version_id.compare('22.4.0') >= 0) {
            await docker_lxd_clash();
        }

        core.endGroup();
        // If using a strictly confined Juju, it wont be able to create the juju directory itself
        // Prevent issues by creating it manually ahead of bootstrap
        const options: exec.ExecOptions = {}
        options.silent = true;
        const juju_dir = `${HOME}/.local/share/juju`;
        await exec.exec("mkdir", ["-p", juju_dir]);
        let bootstrap_command = `juju bootstrap --debug --verbose ${provider} ${bootstrap_options}`
        if (provider === "lxd") {
            core.startGroup("Preparing LXD Provider");
            group = "lxd";
            core.endGroup();
        } else if (provider === "microk8s") {
            core.startGroup("Install microk8s");
            if ([null, ""].includes(channel) == false){
                await snap(`install microk8s --classic --channel=${channel}`);
            } else {
                await snap("install microk8s --classic");
            }
            core.endGroup();
            core.startGroup("Initialize microk8s");
            await exec.exec(`sudo usermod -a -G ${microk8s_group} ${user}`);
            if(!await microk8s_init(channel, microk8s_addons, container_registry_url)) {
                return;
            }
            group = microk8s_group;
            bootstrap_constraints = "";
            core.endGroup();
        } else if (provider === "microstack") {
            core.startGroup("Install MicroStack");
            const os_series = "focal";
            const os_region = "microstack";
    	    if ([null, ""].includes(channel) == false){
            	await snap(`install microstack --beta --devmode --channel=${channel}`);
	        } else {
            	await snap("install microstack --beta --devmode");
	        }
            await snap("alias microstack.openstack openstack");
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
            bootstrap_command = `${bootstrap_command} --bootstrap-series=${os_series} --metadata-source=/tmp/simplestreams --model-default network=test --model-default external-network=external`
            bootstrap_constraints = `${bootstrap_constraints} allocate-public-ip=true`
        } else if (credentials_yaml != "") {
            core.startGroup(`Preparing Provider ${provider} credentials`);
            await exec.exec("bash", ["-c", `echo "${credentials_yaml}" | base64 -d > ${juju_dir}/credentials.yaml`], options);
            if (clouds_yaml != "" ) {
                await exec.exec("bash", ["-c", `echo "${clouds_yaml}" | base64 -d > ${juju_dir}/clouds.yaml`], options);
            }
            core.endGroup();
        } else {
            core.setFailed(`Custom provider set without credentials: ${provider}`);
            return
        }

        core.startGroup("Bootstrap controller");
        bootstrap_command = `${bootstrap_command} --bootstrap-constraints="${bootstrap_constraints}"`
        if (group !== "") {
            await exec.exec(`sudo -g ${group} -E ${bootstrap_command}`);
        } else {
            await exec.exec(bootstrap_command);
        }
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
        core.startGroup("Install kubectl");
        await snap("install kubectl --classic");
        await exec.exec("mkdir", ["-p", `${HOME}/.kube`]);
        if (provider === "microk8s") {
            await microk8sKubeConfig();
        }
        core.endGroup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch(error: any) {
        core.setFailed(error.message);
    }
}

run();

import * as core from '@actions/core';
import * as exec from '@actions/exec';

async function run() {
    const provider = core.getInput("provider");
    try {
        core.addPath('/snap/bin');
        await exec.exec("pip3 install tox");
        if (provider === "lxd") {
            await exec.exec("sudo apt-get remove -qy lxd lxd-client");
            await exec.exec("sudo snap install core");
            await exec.exec("sudo snap install lxd");
            await exec.exec("sudo lxd waitready");
            await exec.exec("sudo lxd init --auto");
            await exec.exec("sudo chmod a+wr /var/snap/lxd/common/lxd/unix.socket");
            await exec.exec("lxc network set lxdbr0 ipv6.address none");
            await exec.exec("sudo snap install juju --classic");
            await exec.exec("juju bootstrap localhost/localhost");
	} else if (provider === "microk8s") { 
	    await exec.exec("sudo snap install microk8s --classic")
	    await exec.exec("sudo snap install juju --classic")
	    await exec.exec('bash', ['-c', 'sudo usermod -a -G microk8s $USER'])
	    await exec.exec('sg microk8s -c "microk8s status --wait-ready"')
	    await exec.exec('sg microk8s -c "microk8s enable storage dns"')
	    await exec.exec('sg microk8s -c "juju bootstrap microk8s micro"')
        } else {
            core.setFailed(`Unknown provider: ${provider}`);
        }
    } catch(error) {
        core.setFailed(error.message);
    }
}

function parseBoolean(s: string): boolean {
    // YAML 1.0 compatible boolean values
    switch (s) {
        case 'y':
        case 'Y':
        case 'yes':
        case 'Yes':
        case 'YES':
        case 'true':
        case 'True':
        case 'TRUE':
            return true;
        case 'n':
        case 'N':
        case 'no':
        case 'No':
        case 'NO':
        case 'false':
        case 'False':
        case 'FALSE':
            return false;
    }
    throw `invalid boolean value: ${s}`;
}

run();

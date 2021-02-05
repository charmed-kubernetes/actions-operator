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

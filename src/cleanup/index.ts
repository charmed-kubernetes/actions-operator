import * as core from '@actions/core';
import * as exec from '@actions/exec';

declare var process : {
    env: {
        [key: string]: string
    }
}

async function run() {
    const GITHUB_SHA = process.env["GITHUB_SHA"].slice(0, 5)
    const provider = core.getInput("provider");
    try {
        core.addPath('/snap/bin');
        await exec.exec(`juju destroy-controller -y github-pr-${GITHUB_SHA} --destroy-all-models --destroy-storage`)
    } catch(error) {
        core.setFailed(error.message);
    }
}


run();

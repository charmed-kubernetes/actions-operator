import * as artifact from '@actions/artifact';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';

declare var process : {
    env: {
        [key: string]: string
    }
}

async function find_juju_crashdump(): Promise<string[]> {
    const globber = await glob.create('**/juju-crashdump-*.tar.xz');
    return globber.glob();
}

async function upload_artifact(files: string[]) {
    const artifact_client = await artifact.create();
    const result = await artifact_client.uploadArtifact(
        "juju-crashdump", files, ".", {continueOnError: true}
    );
    core.info(`artifact ${result.artifactName} (${result.size}) was uploaded`);
}

async function run() {
    const controller_name = process.env["CONTROLLER_NAME"];
    const provider = core.getInput("provider");

    try {
        if (controller_name) {
            core.addPath('/snap/bin');
            if (provider !== "microk8s") {
                await exec.exec(`juju destroy-controller -y ${controller_name} --destroy-all-models --destroy-storage`);
            }
            if (provider === "microstack") {
                await exec.exec("rm -rf /tmp/simplestreams");
                await exec.exec("openstack image delete focal");
                await exec.exec("juju remove-credential microstack admin --client");
                await exec.exec("juju remove-cloud microstack --client");
            }
        }

        core.startGroup("uploading juju-crashdump");
        const crash_dumps: string[] = await find_juju_crashdump();
        if (crash_dumps.length > 0) {
            core.info(`found juju-crashdump: ${crash_dumps}`);
            await upload_artifact(crash_dumps);
        } else {
            core.info("no juju-crashdump was found")
        }
        core.endGroup();

    } catch(error) {
        core.setFailed(error.message);
    }
}


run();

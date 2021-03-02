"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const GITHUB_SHA = process.env["GITHUB_SHA"].slice(0, 5);
        let known_providers = new Map([
            ["aws", "aws/us-east-1"],
            ["lxd", "localhost/localhost"]
        ]);
        const provider = core.getInput("provider");
        const bootstrap_options = `github-pr-${GITHUB_SHA} --bootstrap-constraints "cores=2 mem=4G" --model-default test-mode=true --model-default image-stream=daily --model-default automatically-retry-hooks=false --model-default logging-config="<root>=DEBUG"`;
        try {
            core.addPath('/snap/bin');
            yield exec.exec("pip3 install tox");
            if (known_providers.has(provider)) {
                if (provider === "lxd") {
                    yield exec.exec("sudo apt-get remove -qy lxd lxd-client");
                    yield exec.exec("sudo snap install core");
                    yield exec.exec("sudo snap install lxd");
                    yield exec.exec("sudo lxd waitready");
                    yield exec.exec("sudo lxd init --auto");
                    yield exec.exec("sudo chmod a+wr /var/snap/lxd/common/lxd/unix.socket");
                    yield exec.exec("lxc network set lxdbr0 ipv6.address none");
                    yield exec.exec("sudo snap install juju --classic");
                }
                yield exec.exec(`juju bootstrap --debug --verbose ${known_providers.get(provider)} ${bootstrap_options}`);
            }
            else {
                core.setFailed(`Unknown provider: ${provider}`);
            }
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
run();

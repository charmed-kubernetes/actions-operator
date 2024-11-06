# actions-operator

Action for easily testing Operator Charms with Juju.

## Usage

Simply include the action as a step in your Workflow:

```yaml
- name: Setup operator environment
  uses: charmed-kubernetes/actions-operator@main
```

This will give your job an environment with the following:

- Tox installed
- Juju installed
- A LXD (default) controller bootstrapped

In addition to LXD, the action also supports Microk8s out-of-the-box. You can
also use any other provider by passing in a `credentials.yaml` file (for public
clouds) or both `credentials.yaml` and `clouds.yaml` files (for custom clouds),
using GitHub Secrets. If your custom cloud requires additional bootstrap config,
you can provide that as well. For example:

```yaml
jobs:
  test-on-microk8s:
    runs-on: ubuntu-latest
    name: Test on Microk8s
    steps:
      - name: Setup operator environment
        uses: charmed-kubernetes/actions-operator@main
        with:
          provider: microk8s

  test-on-aws:
    runs-on: ubuntu-latest
    name: Test on AWS
    steps:
      - name: Setup operator environment
        uses: charmed-kubernetes/actions-operator@main
        with:
          provider: aws
          credentials-yaml: ${{ secrets.CREDENTIALS_YAML }}

  test-on-maas:
    runs-on: ubuntu-latest
    name: Test on MAAS
    steps:
      - name: Setup operator environment
        uses: charmed-kubernetes/actions-operator@main
        with:
          provider: maas
          credentials-yaml: ${{ secrets.CREDENTIALS_YAML }}
          clouds-yaml: ${{ secrets.CLOUDS_YAML }}
          bootstrap-options: "--model-default datastore=my-datastore"
```

## microk8s provider

Using the microk8s provider some default add-ons will be enabled - specifically
dns, storage and rbac. You can override these defaults with the following:

```yaml
add-on-test:
  runs-on: ubuntu-latest
  name: Testing custom addons
  steps:
    - name: Setup operator environment
      uses: charmed-kubernetes/actions-operator@main
      with:
        provider: microk8s
        microk8s-addons: "storage dns rbac registry"
```

Currently, if specific addons are defined, a minimum set of addons (the defaults) `dns, storage, rbac` must be enabled for the action to work properly..

## pytest-operator

It is recommended that you combine this with [pytest-operator][] to easily
manage models, interacting with juju, charm building, bundle parameterization,
and other features for testing Operator Charms.

## Multiple controllers

You can bootstrap multiple controllers. Each controller will be named after
the provider used to bootstrap it (e.g. `github-pr-ad8d9-microk8s`). This means
that you can currently bootstrap only one controller of each kind.

pytest-operator will pick up the last controller bootstrapped. To switch
between controllers, you could save the `CONTROLLER_NAME` envvar that is set by
this action after each bootstrap. See the example below for more details.

Note: there is a [known issue](https://bugs.launchpad.net/juju/+bug/2003582)
deploying lxd next to microk8s on Juju 2.9 (this works with Juju 3).

```yaml
multi-controller-tests:
  name: microk8s-and-lxd-test
  runs-on: ubuntu-latest
  steps:
    - name: Setup k8s controller
      uses: charmed-kubernetes/actions-operator@main
      with:
        juju-channel: 3.0/stable
        provider: microk8s
        channel: 1.26-strict/stable
    - name: Save k8s controller name
      id: k8s-controller
      # The `CONTROLLER_NAME` envvar is set by this actions
      run: echo "name=$CONTROLLER_NAME" >> $GITHUB_OUTPUT
    - name: Setup lxd controller
      uses: charmed-kubernetes/actions-operator@main
      with:
        juju-channel: 3.0/stable
        provider: lxd
    - name: Save lxd controller name
      id: lxd-controller
      # The `CONTROLLER_NAME` envvar is set by this action
      run: echo "name=$CONTROLLER_NAME" >> $GITHUB_OUTPUT
    - name: Run integration tests
      run: ...
      env:
        K8S_CONTROLLER: ${{ steps.k8s-controller.outputs.name }}
        LXD_CONTROLLER: ${{ steps.lxd-controller.outputs.name }}
```

[pytest-operator]: https://github.com/charmed-kubernetes/pytest-operator

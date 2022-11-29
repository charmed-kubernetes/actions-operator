# actions-operator

Action for easily testing Operator Charms with Juju.

## Usage

Simply include the action as a step in your Workflow:

```yaml
- name: Setup operator environment
  uses: charmed-kubernetes/actions-operator@main
```

This will give your job an environment with the following:

  * Tox installed
  * Juju installed
  * A LXD (default) controller bootstrapped

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
An empty string in place of the addons, such as `microk8s-addons: ""`, will 
result in no add-ons being enabled.

## pytest-operator

It is recommended that you combine this with [pytest-operator][] to easily
manage models, interacting with juju, charm building, bundle parameterization,
and other features for testing Operator Charms.


[pytest-operator]: https://github.com/charmed-kubernetes/pytest-operator

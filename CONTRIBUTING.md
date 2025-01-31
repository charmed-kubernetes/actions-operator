# Contributor Guide

This GitHub Action is open source ([Apache License 2.0](./LICENSE)) and we
actively seek any community contributions for code, suggestions and
documentation.  This page details a few notes, workflows and suggestions for
how to make contributions most effective and help us all build a better workflow -
please give them a read before working on any contributions.

## Licensing

This action has been created under the [Apache License 2.0](./LICENSE), which
will cover any contributions you may make to this project. Please familiarise
yourself with the terms of the license.

Additionally, this charm uses the Harmony CLA agreement.  It’s the easiest way
for you to give us permission to use your contributions.  In effect, you’re
giving us a license, but you still own the copyright — so you retain the right
to modify your code and use it in other projects. Please [sign the CLA
here](https://ubuntu.com/legal/contributors/agreement) before making any
contributions.

## Code of Conduct

We have adopted the Ubuntu code of Conduct. You can read this in full
[here](https://ubuntu.com/community/code-of-conduct).

## Building the Action

Building using npm:

```
sudo snap install node --channel 20/stable              # installs npm
npm install                                             # install / update dependencies
npm run build                                           # Run the build
```

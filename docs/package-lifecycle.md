# Package lifecycle

Pi installs this repository as a managed Git package:

```bash
pi install git:github.com/jhs88/pi-tooling
```

On the initial install, Pi clones the repository below its package root and runs `npm install --omit=dev`. Runtime dependencies therefore live beside the extension and resolve normally.

When the remote commit changes, both of these commands reset the managed checkout to the new commit and rerun the production dependency install:

```bash
pi update --extensions
pi update --all
```

An unchanged managed checkout is not rebuilt. To repair a manually deleted or corrupted checkout, remove and reinstall the package:

```bash
pi remove git:github.com/jhs88/pi-tooling
pi install git:github.com/jhs88/pi-tooling
```

Do not copy the source into `~/.pi/agent/extensions`; files discovered there are not managed packages, so Pi does not install dependencies declared by nested manifests.

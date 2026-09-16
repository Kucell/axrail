# npm Publication Runbook

Status: publication mechanics implemented; **no publish workflow has been triggered by this work**.

Axrail uses two npm publication modes because npm Trusted Publishing and staged publishing require a package to already exist in the registry.

## Security model

```text
First-ever package publication
  → protected GitHub Environment
  → short-lived bootstrap npm token
  → publish verified tarballs with provenance
  → revoke bootstrap token immediately

Subsequent releases
  → GitHub OIDC Trusted Publisher
  → stage-only permission
  → protected GitHub Environment
  → npm stage publish
  → maintainer review + 2FA approval on npm
  → finalize Git tag / GitHub Release
```

The verified tarballs produced before approval are the same files used for publication. The publish jobs do not rebuild packages after approval.

## Required npm prerequisites

Before the first public release:

1. Ensure the npm account/organization controls the `@axrail` scope and can create all 15 public package names.
2. Enable 2FA on the maintainer npm account.
3. Create a short-lived granular npm token suitable for the one-time first publication. Store it only as the `NPM_TOKEN` secret on the `npm-release-bootstrap` GitHub Environment. Revoke it immediately after the bootstrap release finishes.

Trusted Publishing cannot be configured for a package that does not yet exist in the npm registry. Therefore the bootstrap workflow is intentionally separate and should never be used again after all 15 packages exist.

## Required GitHub Environments

Create these environments under repository **Settings → Environments**:

### `npm-release-bootstrap`

Used only by `.github/workflows/release-bootstrap.yml`.

Recommended protection:

- required reviewer(s);
- prevent self-review when the maintainer model supports it;
- only the default branch or explicitly allowed release refs;
- environment secret `NPM_TOKEN` containing only the temporary bootstrap token.

### `npm-release`

Used by `.github/workflows/release-stage.yml`.

Recommended protection:

- required reviewer(s);
- prevent self-review where practical;
- no long-lived npm token;
- OIDC only (`id-token: write`).

### `github-release`

Used by `.github/workflows/release-finalize.yml`.

Recommended protection:

- required reviewer(s);
- restrict to approved release refs/branches;
- no npm credentials.

## First release: bootstrap

Run **Bootstrap First npm Release** only after all architecture/build gates are green.

Inputs for RC1:

```text
version = 0.1.0-rc.1
confirm = PUBLISH-FIRST-RELEASE
```

The workflow:

1. verifies the requested lockstep version;
2. runs frozen install, check, build/tests and `pack:smoke`;
3. retains the exact verified tarballs as an Actions artifact;
4. waits on the `npm-release-bootstrap` Environment;
5. downloads those exact tarballs;
6. authenticates with the temporary environment `NPM_TOKEN`;
7. publishes all 15 packages in dependency order with `--access public --tag rc --provenance`.

After a successful bootstrap:

- revoke/delete the bootstrap npm token;
- remove the `NPM_TOKEN` environment secret;
- do not use the bootstrap workflow for future versions.

## Configure Trusted Publishers after bootstrap

For each of the 15 published packages, configure npm Trusted Publishing with:

```text
Provider: GitHub Actions
GitHub owner: Kucell
Repository: axrail
Workflow filename: release-stage.yml
Environment: npm-release
Allowed action: stage publish only
```

Use the package's npm settings page or `npm trust github` after the package exists.

For maximum security, configure package publishing access to require 2FA and disallow traditional token publishing once Trusted Publishing has been verified.

## Subsequent releases: trusted staged publishing

Run **Stage npm Release** with an explicit version and dist-tag.

Examples:

```text
RC:    version=0.1.0-rc.2  dist_tag=rc
Final: version=0.1.0       dist_tag=latest
```

The workflow runs the complete verification gate, uploads the verified tarballs, then waits on the `npm-release` Environment. The staging job uses GitHub OIDC and does not require a long-lived npm token.

Each package is submitted with `npm stage publish`. A staged package is not public. A maintainer must review and approve the staged package on npmjs.com (or through npm CLI) with 2FA before it becomes public.

## Finalize the GitHub Release

Only after all 15 npm packages are visible at the intended version, run **Finalize GitHub Release**.

Inputs:

```text
version = exact published version
commit_sha = exact verified source commit
confirm = FINALIZE-RELEASE
```

The workflow:

1. checks out the exact commit;
2. verifies its root version;
3. verifies the commit is part of `main`;
4. verifies all 15 `@axrail/*` packages are public at the requested version;
5. verifies a release-notes file exists at `docs/release/notes/v<version>.md`;
6. creates an annotated `v<version>` tag;
7. creates the GitHub Release from that immutable tag.

RC versions are marked as GitHub prereleases.

## Failure handling

Publishing a package version is immutable. Never overwrite or reuse a published version.

If bootstrap publishing partially succeeds, do not retry already-published package/version pairs blindly. Inspect registry state, finish only the missing packages if safe, record the incident in `axrail-agent`, and use a new RC version if artifact identity can no longer be demonstrated consistently.

If staged publishing fails, staged versions may be reviewed/rejected through npm before attempting a corrected new version.

## Supply-chain requirements

- Third-party GitHub Actions in release workflows are pinned to immutable commit SHAs.
- Credentialed jobs use protected GitHub Environments.
- Trusted Publishing uses OIDC rather than long-lived npm tokens after bootstrap.
- Public-package provenance is enabled from GitHub-hosted runners.
- The GitHub Release is finalized only after npm registry visibility is independently verified.

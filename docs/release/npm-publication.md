# npm Publication Runbook

Status: **`0.1.0-rc.1` bootstrap publication completed successfully for all 15 supported public packages; remaining work is bootstrap credential cleanup, Trusted Publisher migration, and GitHub Release finalization.**

Axrail uses two npm publication modes because npm Trusted Publishing and staged publishing require a package to already exist in the registry.

## Security model

```text
First-ever package publication — completed for 0.1.0-rc.1
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

## `0.1.0-rc.1` bootstrap publication — COMPLETE

The one-time **Bootstrap First npm Release** workflow completed successfully:

```text
Actions run: 35174115348
version:     0.1.0-rc.1
source SHA:  e4758656c20f6cb90b05eb3429c79010667a2f7d
dist-tag:    rc
packages:    15/15
provenance:  enabled
```

The workflow:

1. verified the requested lockstep version;
2. ran frozen install, checks, build/tests and package smoke verification;
3. retained the exact verified tarballs as an Actions artifact;
4. passed the protected `npm-release-bootstrap` Environment;
5. required `RELEASE_GUARD=enabled`;
6. downloaded those exact tarballs;
7. authenticated using the temporary Environment `NPM_TOKEN`;
8. published all 15 packages in dependency order with `--access public --tag rc --provenance`.

The publication produced GitHub Actions provenance and Sigstore transparency-log entries. The bootstrap workflow intentionally did **not** create a Git tag or GitHub Release.

Do not use `release-bootstrap.yml` for future versions now that all 15 package names exist in npm.

## Immediate post-bootstrap cleanup

The following actions are account-level and must be explicitly verified by a maintainer:

1. Revoke/delete the temporary bootstrap npm token.
2. Remove the `NPM_TOKEN` secret from the `npm-release-bootstrap` GitHub Environment.
3. Keep `release-bootstrap.yml` as historical/emergency documentation only; future normal releases use the Trusted Publishing path.

## Required GitHub Environments

### `npm-release-bootstrap`

Used only by `.github/workflows/release-bootstrap.yml` for the already-completed first publication.

The Environment should no longer contain a live npm write token after bootstrap cleanup.

### `npm-release`

Used by `.github/workflows/release-stage.yml`.

Recommended protection:

- required reviewer(s);
- prevent self-review where practical;
- Environment variable `RELEASE_GUARD=enabled`;
- no long-lived npm token;
- OIDC only (`id-token: write`).

### `github-release`

Used by `.github/workflows/release-finalize.yml`.

Recommended protection:

- required reviewer(s);
- restrict to approved release refs/branches;
- Environment variable `RELEASE_GUARD=enabled`;
- no npm credentials.

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

Use each package's npm settings page or the supported npm CLI flow after confirming the package exists.

After Trusted Publishing is verified, configure package publishing access to require 2FA and disallow traditional token publishing where supported.

## Subsequent releases: trusted staged publishing

Run **Stage npm Release** with an explicit version and dist-tag.

Examples:

```text
RC:    version=0.1.0-rc.2  dist_tag=rc
Final: version=0.1.0       dist_tag=latest
```

The workflow runs the complete verification gate, uploads the verified tarballs, then waits on the `npm-release` Environment. The staging job requires `RELEASE_GUARD=enabled`, uses GitHub OIDC, and does not require a long-lived npm token.

Each package is submitted with `npm stage publish`. A staged package is not public. A maintainer must review and approve the staged package on npm with 2FA before it becomes public.

## Finalize the `0.1.0-rc.1` GitHub Release

Only after bootstrap credential cleanup and Trusted Publisher configuration have been verified, run **Finalize GitHub Release** with the exact already-published source commit:

```text
version = 0.1.0-rc.1
commit_sha = e4758656c20f6cb90b05eb3429c79010667a2f7d
confirm = FINALIZE-RELEASE
```

The workflow:

1. waits on the protected `github-release` Environment;
2. requires `RELEASE_GUARD=enabled`;
3. checks out the exact commit;
4. verifies its root version;
5. verifies the commit is part of `main`;
6. verifies all 15 `@axrail/*` packages are public at the requested version;
7. verifies a release-notes file exists at `docs/release/notes/v<version>.md`;
8. creates an annotated `v<version>` tag;
9. creates the GitHub Release from that immutable tag.

RC versions are marked as GitHub prereleases.

For RC1, **do not substitute a later documentation commit for the provenance commit**. The correct commit remains:

```text
e4758656c20f6cb90b05eb3429c79010667a2f7d
```

## Failure handling

Published npm package versions are immutable. Never overwrite or reuse a published version.

If a future staged publication fails, review or reject the staged versions before attempting a corrected new version. If artifact identity can no longer be demonstrated consistently, use a new RC version rather than reusing an existing version number.

## Supply-chain requirements

- Third-party GitHub Actions in release workflows are pinned to immutable commit SHAs.
- Side-effecting release jobs require both a protected GitHub Environment and `RELEASE_GUARD=enabled`.
- Trusted Publishing uses OIDC rather than long-lived npm tokens after bootstrap.
- Public-package provenance is enabled from GitHub-hosted runners.
- The GitHub Release is finalized only after npm registry visibility is independently verified.

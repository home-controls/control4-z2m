# Pull requests are source-only; releases and release candidates are cut on purpose

Until 0.4.1, every pull request that changed `src/` committed its rebuilt `dist/` and raised `package.json`'s
version, and its merge published a release. So every fix shipped alone and at once, as a full release: there was
no way to batch several fixes, or to put a build on real installs before calling it a release. The version check
also ignored a pre-release tag, so `0.4.2-rc.1` and `0.4.2` counted as the same version.

So a pull request is now one of two kinds (`tools/release-check.mjs`, run by CI on every pull request and push to
`main`):
- **Source-only:** it changes `src/`, tests and docs, and leaves `dist/` and the version alone. CI builds before
  the tests, so the bundle the tests load is the change's own, not the last release's.
- **A release:** it raises the version and commits `dist/` as a fresh build of `src/`, nothing else. A version with
  a pre-release tag (`0.4.2-rc.1`) is a release candidate: CI publishes it as a GitHub pre-release, which the
  latest-release link skips. Versions are ordered as semver orders them: `0.4.2-rc.1` < `0.4.2-rc.2` < `0.4.2`.
- **A full release follows its own candidate**, and only while `src/` is unchanged since that candidate's tag:
  it ships the code that was tested, rebuilt with the final version. Anything else is a new candidate.

`npm run release -- rc` and `npm run release -- final` (`tools/release.mjs`) cut those pull requests.

## Consequences

- `main`'s `dist/` is always the last release (candidate or full), so anyone copying it from a checkout gets a
  released build. It lags `src/` between releases.
- `npm run check` rebuilds `dist/`, so a contributor drops it before committing; CI fails a pull request that
  changes `dist/` without raising the version, and says how to drop it.
- Testing an unreleased change on a real install means building it locally and copying both files, as before; the
  build id in its status then matches no release.
- Every release, even an urgent fix, goes through a candidate first; promoting one is a second small pull request.
- A release's notes list the commits since the last full release, so a candidate's and its release's notes both
  cover everything new.

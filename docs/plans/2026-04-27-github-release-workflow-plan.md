# GitHub Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a single GitHub Actions workflow at `.github/workflows/release.yml` that, on every `v*` tag push, builds Madame for Windows (x86_64), Linux (x86_64), and macOS (aarch64), and publishes a GitHub Release with the three artifacts attached.

**Architecture:** One workflow file with five jobs — `validate-version` (gate), three parallel platform builds (`build-windows`, `build-linux`, `build-macos`) that each upload their artifact via `actions/upload-artifact`, and `release` (downloads all artifacts and publishes via `gh release create`). Validation gate ensures the tag matches `tauri.conf.json` version before any build minutes are spent.

**Tech Stack:** GitHub Actions, Tauri 2 CLI, Bun, Rust (stable toolchain), `dtolnay/rust-toolchain`, `Swatinem/rust-cache`, `actions/checkout`, `actions/upload-artifact`, `actions/download-artifact`, `oven-sh/setup-bun`, `gh` CLI.

---

## Reference

- Spec: `docs/plans/2026-04-27-github-release-workflow-design.md`
- Related (consumes the Linux artifact): `docs/plans/2026-04-27-nix-flake-design.md` (paused; will need a follow-up edit after this lands)

## File Structure

```
.github/
└── workflows/
    └── release.yml      ← new (entire workflow lives here)
```

Single new file, no source-code edits required. The existing `src-tauri/tauri.conf.json` (`bundle.active: false`) and `src-tauri/tauri.macos.conf.json` (`bundle.active: true`, `targets: ["app"]`) are already aligned with this design — no config changes needed.

## Notes for the engineer

**TDD doesn't map cleanly to CI YAML.** There is no unit-test framework that "fails" before a workflow file exists. The verification loop here is:

1. **Static lint with `actionlint`** after each task — catches YAML syntax errors, unknown action names, bad expression syntax, missing `needs:` references, etc. Run via Docker so no host install is required:
   ```bash
   docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest -color
   ```
   If Docker isn't available, skip the lint step and rely on the end-to-end verification (Task 7) to catch issues. `actionlint` exit code is 0 on success, non-zero on any finding.
2. **End-to-end verification** (Task 7) — push a throwaway tag, watch the workflow, validate artifacts, clean up.

**`docs/` is gitignored in this repo** but plan/spec files are tracked (with `git add -f`). When committing the plan file or any plan-adjacent doc, use `git add -f`. The workflow file under `.github/` is not gitignored and adds normally.

**File location for `.github/workflows/`** — the directory does not exist yet. Task 1 creates it.

**`--frozen-lockfile` requirement** — `bun.lock` is committed and current; `bun install --frozen-lockfile` works as-is. If the engineer needs to update dependencies during this work, regenerate the lockfile and commit it before pushing the test tag.

---

## Task 1: Create workflow file with trigger, concurrency, and `validate-version` job

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow file with header, trigger, concurrency, and the validate-version job**

Write the file at `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  validate-version:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: Validate tag matches tauri.conf.json version
        id: version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          FILE_VERSION="$(jq -r .version src-tauri/tauri.conf.json)"
          if [ "$TAG_VERSION" != "$FILE_VERSION" ]; then
            echo "::error::Tag version ($TAG_VERSION) does not match tauri.conf.json version ($FILE_VERSION)"
            exit 1
          fi
          echo "version=$TAG_VERSION" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 2: Lint the workflow with actionlint**

Run:
```bash
docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: no output, exit code 0. If Docker is unavailable, skip this step.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add tag-triggered workflow skeleton with version-validation gate"
```

---

## Task 2: Add `build-windows` job

**Files:**
- Modify: `.github/workflows/release.yml` (append a new job)

- [ ] **Step 1: Append the build-windows job**

Append the following inside the `jobs:` map (after the `validate-version` job block — match the same indentation, two spaces in from `jobs:`):

```yaml
  build-windows:
    needs: validate-version
    runs-on: windows-latest
    env:
      VERSION: ${{ needs.validate-version.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install frontend deps
        run: bun install --frozen-lockfile

      - name: Build (no bundle)
        run: bun tauri build --no-bundle

      - name: Package binary into zip
        shell: pwsh
        run: |
          $zipName = "madame-${env:VERSION}-x86_64-windows.zip"
          Compress-Archive -Path src-tauri/target/release/madame.exe -DestinationPath $zipName

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: windows
          path: madame-${{ env.VERSION }}-x86_64-windows.zip
          if-no-files-found: error
```

- [ ] **Step 2: Lint the workflow**

Run:
```bash
docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: no output, exit code 0. (Skip if Docker unavailable.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add Windows x86_64 build job"
```

---

## Task 3: Add `build-linux` job

**Files:**
- Modify: `.github/workflows/release.yml` (append a new job)

- [ ] **Step 1: Append the build-linux job**

Append the following inside the `jobs:` map after `build-windows`:

```yaml
  build-linux:
    needs: validate-version
    runs-on: ubuntu-latest
    env:
      VERSION: ${{ needs.validate-version.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Tauri Linux system deps
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            libxdo-dev \
            libssl-dev \
            build-essential \
            curl wget file

      - uses: oven-sh/setup-bun@v2

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install frontend deps
        run: bun install --frozen-lockfile

      - name: Build (no bundle)
        run: bun tauri build --no-bundle

      - name: Stage tarball contents
        run: |
          mkdir -p staging/madame/icons
          cp src-tauri/target/release/madame staging/madame/madame
          cp src-tauri/icons/32x32.png         staging/madame/icons/
          cp src-tauri/icons/64x64.png         staging/madame/icons/
          cp src-tauri/icons/128x128.png       staging/madame/icons/
          cp src-tauri/icons/128x128@2x.png    staging/madame/icons/
          cp src-tauri/icons/icon.png          staging/madame/icons/

      - name: Create tarball
        run: |
          tar -czf "madame-${VERSION}-x86_64-linux.tar.gz" -C staging madame/

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: linux
          path: madame-${{ env.VERSION }}-x86_64-linux.tar.gz
          if-no-files-found: error
```

- [ ] **Step 2: Lint the workflow**

Run:
```bash
docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: no output, exit code 0. (Skip if Docker unavailable.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add Linux x86_64 build job producing tarball with icons"
```

---

## Task 4: Add `build-macos` job

**Files:**
- Modify: `.github/workflows/release.yml` (append a new job)

- [ ] **Step 1: Append the build-macos job**

Append the following inside the `jobs:` map after `build-linux`:

```yaml
  build-macos:
    needs: validate-version
    runs-on: macos-latest
    env:
      VERSION: ${{ needs.validate-version.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install frontend deps
        run: bun install --frozen-lockfile

      - name: Build (.app bundle)
        run: bun tauri build --bundles app

      - name: Zip the .app
        run: |
          cd src-tauri/target/release/bundle/macos
          zip -r "madame-${VERSION}-aarch64-darwin.zip" Madame.app

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: macos
          path: src-tauri/target/release/bundle/macos/madame-${{ env.VERSION }}-aarch64-darwin.zip
          if-no-files-found: error
```

- [ ] **Step 2: Lint the workflow**

Run:
```bash
docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: no output, exit code 0. (Skip if Docker unavailable.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add macOS aarch64 build job producing zipped .app"
```

---

## Task 5: Add `release` job

**Files:**
- Modify: `.github/workflows/release.yml` (append the final job)

- [ ] **Step 1: Append the release job**

Append the following inside the `jobs:` map after `build-macos`:

```yaml
  release:
    needs: [validate-version, build-windows, build-linux, build-macos]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Create release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --repo "$GITHUB_REPOSITORY" \
            --title "$GITHUB_REF_NAME" \
            --generate-notes \
            artifacts/*
```

- [ ] **Step 2: Lint the workflow**

Run:
```bash
docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: no output, exit code 0. (Skip if Docker unavailable.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add release job that publishes all three artifacts"
```

---

## Task 6: Push the workflow file to GitHub

**Files:** none modified

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

Expected: push succeeds. The workflow does not run yet because no tag has been pushed.

- [ ] **Step 2: Verify the workflow is registered**

Run:
```bash
gh workflow list --repo shanehollon/madame
```

Expected output includes a row for `Release` with state `active`.

---

## Task 7: End-to-end verification with a throwaway test tag

This task is the real test. It pushes a tag, watches the workflow, downloads each artifact, and verifies they're well-formed. At the end it cleans up the test release and tag so they don't pollute the project's release history.

**Files:** none modified permanently. The version in `src-tauri/tauri.conf.json` is bumped temporarily and reverted at the end.

- [ ] **Step 1: Decide a test version that doesn't collide with future real versions**

Use `0.0.1-test`. The current version is `0.1.0` (per `package.json`); `0.0.1-test` is below it semantically and clearly marked.

- [ ] **Step 2: Test the failure path first — push the tag with a mismatched version**

Without changing `tauri.conf.json`, create and push the test tag:

```bash
git tag v0.0.1-test
git push origin v0.0.1-test
```

Expected: workflow runs `validate-version`, fails immediately with the error message `Tag version (0.0.1-test) does not match tauri.conf.json version (0.1.0)`. No build jobs run. No release is created.

Verify in the Actions tab on GitHub, or:

```bash
gh run list --repo shanehollon/madame --workflow release.yml --limit 1
gh run view --repo shanehollon/madame --log-failed
```

Expected: the most recent run is `failure`, log shows the validate-version error.

- [ ] **Step 3: Delete the failed tag locally and remotely**

```bash
git tag -d v0.0.1-test
git push origin :refs/tags/v0.0.1-test
```

- [ ] **Step 4: Bump tauri.conf.json version to match the test tag**

Edit `src-tauri/tauri.conf.json` and change `"version": "0.1.0"` to `"version": "0.0.1-test"`. Do not commit yet.

- [ ] **Step 5: Commit the version bump and re-tag**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore: bump version to 0.0.1-test for release-workflow verification"
git push origin main
git tag v0.0.1-test
git push origin v0.0.1-test
```

Expected: workflow starts. Watch with:

```bash
gh run watch --repo shanehollon/madame
```

Expected: all five jobs complete with `success`. Total wall-clock time roughly 10-20 minutes for a cold cache; subsequent runs are faster.

- [ ] **Step 6: Confirm the release exists with all three artifacts**

```bash
gh release view v0.0.1-test --repo shanehollon/madame
```

Expected: release page shows three assets:
- `madame-0.0.1-test-x86_64-windows.zip`
- `madame-0.0.1-test-x86_64-linux.tar.gz`
- `madame-0.0.1-test-aarch64-darwin.zip`

And a body containing `What's Changed` from `--generate-notes`.

- [ ] **Step 7: Download and verify each artifact**

```bash
mkdir -p /tmp/madame-verify && cd /tmp/madame-verify
gh release download v0.0.1-test --repo shanehollon/madame
ls -la
```

Expected: three files present with the names above.

Verify Linux tarball layout:
```bash
tar -tzf madame-0.0.1-test-x86_64-linux.tar.gz
```

Expected output (order may vary):
```
madame/
madame/madame
madame/icons/
madame/icons/32x32.png
madame/icons/64x64.png
madame/icons/128x128.png
madame/icons/128x128@2x.png
madame/icons/icon.png
```

Verify Windows zip layout:
```bash
unzip -l madame-0.0.1-test-x86_64-windows.zip
```

Expected: a single entry `madame.exe` at the zip root.

Verify macOS zip layout:
```bash
unzip -l madame-0.0.1-test-aarch64-darwin.zip | head -20
```

Expected: entries beginning with `Madame.app/` including `Madame.app/Contents/Info.plist` and `Madame.app/Contents/MacOS/madame`.

If any of these fail, do not proceed to cleanup — investigate first.

- [ ] **Step 8: (Optional, if a Mac is available) Confirm the .app launches**

Unzip and run:
```bash
unzip madame-0.0.1-test-aarch64-darwin.zip
xattr -dr com.apple.quarantine Madame.app   # bypass Gatekeeper for unsigned app
open Madame.app
```

Expected: app window opens. Quit it.

- [ ] **Step 9: Clean up the test release, tag, and version bump**

Delete the GitHub release and the remote+local tag:

```bash
gh release delete v0.0.1-test --repo shanehollon/madame --yes
git push origin :refs/tags/v0.0.1-test
git tag -d v0.0.1-test
```

Revert the version bump:

```bash
cd "$OLDPWD" || cd C:/Users/Shane/projects/madame
```

Edit `src-tauri/tauri.conf.json` and change `"version": "0.0.1-test"` back to `"version": "0.1.0"`.

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore: revert version bump from release-workflow verification"
git push origin main
```

- [ ] **Step 10: Sanity-check the cleanup**

```bash
gh release list --repo shanehollon/madame
git tag -l v0.0.1-test
git ls-remote --tags origin v0.0.1-test
```

Expected: no `v0.0.1-test` release, no local tag, no remote tag. The `Release` workflow is registered and ready for future real version tags.

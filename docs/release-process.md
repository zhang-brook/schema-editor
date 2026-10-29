# Release Process

English | [简体中文](./release-process.zh-CN.md)

1. Update `version` in [package.json](../package.json) (the web app, desktop runtime, and installers all read it at build time)
2. Run `pnpm changelog` to generate CHANGELOG
3. `git add package.json CHANGELOG.md` → `git commit -m "chore: release vx.y.z"` → `git push`
4. `git tag vx.y.z` → `git push origin vx.y.z` to trigger [release.yml](../.github/workflows/release.yml): the tag is checked against the root version first, then the web app builds; a plain tag deploys it to Pages, a prerelease tag skips that deployment. Desktop packages in parallel on Windows / macOS / Linux runners; `publish` creates the GitHub Release after all of them finish (body taken from the `## vx.y.z` section in CHANGELOG)
5. Open and verify

A tag whose version carries a hyphen suffix (`v1.2.3-beta.1`, `v1.2.3-rc.1`) publishes the GitHub Release as a **pre-release** and leaves the Pages site on the latest stable build; a plain `v1.2.3` tag publishes it as the stable release and updates Pages. Root `package.json` holds the same string, suffix included.

| Purpose | URL |
| --- | --- |
| Repository | https://github.com/zhang-brook/schema-editor |
| Pages | https://zhang-brook.github.io/schema-editor/ |
| Changelog | https://github.com/zhang-brook/schema-editor/blob/main/CHANGELOG.md |
| Releases | https://github.com/zhang-brook/schema-editor/releases |

Release assets: `schema-editor-vx.y.z.zip` / `.tar.gz` (web); desktop artifacts are named by OS and architecture:

- `schema-editor-vx.y.z-windows-x64-setup.exe` (installer) / `-windows-x64-portable.exe` (portable)
- `schema-editor-vx.y.z-macos-universal.dmg` (manual install) / `.zip` (in-app update)
- `schema-editor-vx.y.z-linux-x86_64.AppImage` / `-linux-amd64.deb`
- Update metadata per platform: `latest.yml`, `latest-mac.yml`, `latest-linux.yml`; the Windows installer and macOS zip also include `.blockmap` files for delta downloads

The version in file names comes from the root `package.json` and must match the tag.

## Notes

- The CHANGELOG section title must match the tag; otherwise the Release body falls back to a placeholder
- Running `pnpm changelog` again for the same version is blocked (exit 1); delete that section or restore CHANGELOG.md first
- Only pushing a `v*` tag triggers the workflow; regular commits do not
- A prerelease tag still publishes the web zip/tar.gz and desktop installers, but skips the Pages deployment and omits the Live Preview link from its release body
- Pages deployment does not wait for desktop packaging; the Release is published only after all three platforms finish
- Packaging always uses `--publish never`: installers and `latest*.yml` are attached by the `publish` job. electron-builder would otherwise upload by itself when building on a tag, and without `GH_TOKEN` in CI the whole packaging job would fail
- No code signing is configured: Windows shows a SmartScreen prompt on first install, and the macOS build is blocked by Gatekeeper with no in-app update entry for now; signing and notarization will enable it later
- Do not delete `latest.yml` / `latest-mac.yml` / `latest-linux.yml` from a published Release or change the installers in its gallery, or installed apps will fail to find updates or fail verification
- In-app updates only read `releases/latest`; GitHub skips drafts and pre-releases, so a tag marked as prerelease will not be found even if fully packaged

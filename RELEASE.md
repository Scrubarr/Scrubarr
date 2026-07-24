# Release Checklist

This checklist is for maintainers publishing Scrubarr Docker releases to:

```text
ghcr.io/scrubarr/scrubarr
```

Scrubarr can delete media once live deletion is enabled, so treat releases like
admin changes: test first, take backups, and recreate only the Scrubarr service
during upgrades.

## Before A Release

1. Confirm the working tree is clean except for intended changes.
2. Run local checks:

   ```bash
   npm run lint
   npm run build
   npm test
   npm run release:check
   ```

3. Review public docs:
   - `README.md`
   - `INSTALL.md`
   - `FEATURES.md`
   - `SECURITY.md`
   - `CHANGELOG.md`

4. Confirm no private files, tokens, backups, screenshots, or local notes are
   staged.

## Create A Versioned Release

1. Choose the next version.
2. Update the version in:
   - `package.json`
   - `client/package.json`
   - `server/package.json`
   - `release-manifest.example.json`
3. Update Docker image references and install examples to the new stable image tag:
   - `README.md`
   - `INSTALL.md`
   - `docker-compose.yml`
   - `docker-compose.example.yml`
4. Update `CHANGELOG.md`.
5. Run:

   ```bash
   npm install --package-lock-only
   npm run lint
   npm run build
   npm test
   npm run release:check
   ```

6. Commit the release:

   ```bash
   git add .
   git commit -m "Release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z
   ```

7. Confirm the GitHub Actions Docker image workflow succeeds. Its summary
   contains the immutable image digest for the published release.

## Publish The Update Manifest

After the Docker image exists, copy the immutable image digest from the GitHub
Actions workflow summary, then sign and publish the update manifest:

```bash
npm run updates:sign -- --key ./local-update-signing/scrubarr-update-private.pem --manifest ./release-manifest.example.json --digest sha256:PASTE_THE_64_CHARACTER_DIGEST_HERE --out ../Scrubarr-updates/stable.json
```

The private signing key must stay private. Only the public verification key
belongs in Scrubarr source code. The signing script refuses to create a new
official manifest unless it includes the immutable Docker image digest.

After publishing the manifest:

1. Confirm `https://scrubarr.github.io/updates/stable.json` serves the new
   version.
2. Confirm a running Scrubarr install detects the update.
3. Confirm the update indicator disappears after the install is updated.

## Release Candidate

To test a complete version without moving `latest` or publishing an in-app
update, tag the tested commit as `rc-vX.Y.Z` and push that tag. The workflow
publishes only `ghcr.io/scrubarr/scrubarr:rc-vX.Y.Z` and records its digest in
the job summary. Do not publish the signed update manifest for a candidate.

Use that candidate image or digest only on a deliberate test deployment. Once
it has been accepted, create the final `vX.Y.Z` tag from the same commit. That
final tag publishes `latest`, the version tag, and the digest used by the
official signed manifest.

## Upgrade A Docker Install

1. Export a backup from Scrubarr.
2. Disable scheduled runs while testing the update.
3. Use the signed Docker image reference shown in **Settings > About and
   updates**. It may be a version tag or an immutable `@sha256` digest.
4. Pull and recreate only Scrubarr:

   ```bash
   docker compose pull scrubarr
   docker compose up -d --no-deps scrubarr
   ```

5. Check:
   - container health
   - Dashboard
   - Settings
   - Scheduler
   - Logs
   - Safety
   - Leaving Soon libraries
   - update status

6. Re-enable scheduled runs when the updated version looks healthy.

## Roll Back

1. Disable scheduled runs if the UI is reachable.
2. Change the image reference back to the previous known-good tag or digest.
3. Pull and recreate only Scrubarr:

   ```bash
   docker compose pull scrubarr
   docker compose up -d --no-deps scrubarr
   ```

4. Restore a backup only if the newer version changed local data in a way that
   needs to be undone.

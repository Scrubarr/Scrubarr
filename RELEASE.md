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
3. Update Docker image tags in:
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

7. Confirm the GitHub Actions Docker image workflow succeeds.

## Publish The Update Manifest

After the Docker image exists, sign and publish the update manifest:

```bash
npm run updates:sign -- --key ./local-update-signing/scrubarr-update-private.pem --manifest ./release-manifest.example.json --out ../Scrubarr-updates/stable.json
```

The private signing key must stay private. Only the public verification key
belongs in Scrubarr source code.

After publishing the manifest:

1. Confirm `https://scrubarr.github.io/updates/stable.json` serves the new
   version.
2. Confirm a running Scrubarr install detects the update.
3. Confirm the update indicator disappears after the install is updated.

## Upgrade A Docker Install

1. Export a backup from Scrubarr.
2. Disable scheduled runs while testing the update.
3. Update the image tag in `docker-compose.yml`.
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
2. Change the image tag back to the previous known-good version.
3. Pull and recreate only Scrubarr:

   ```bash
   docker compose pull scrubarr
   docker compose up -d --no-deps scrubarr
   ```

4. Restore a backup only if the newer version changed local data in a way that
   needs to be undone.

## Public Repo Preparation

Before making the repository public:

- Remove or archive internal worklogs, private review notes, local screenshots,
  and deployment-specific notes.
- Confirm `.env`, backups, logs, test media, and signing private keys are not
  tracked.
- Prefer a clean public mirror or clean public branch if the private repository
  history contains internal notes.
- Keep development history private if it contains local paths, private
  operational notes, or anything that should not be permanent public history.

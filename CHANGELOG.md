# Changelog

## 1.0.2

- Fixed Radarr pending tag sync by using an Arr-safe tag label format.
- Added validation and clearer UI guidance for Radarr/Sonarr pending tag names.

## 1.0.1

- Requested targeted Emby and Jellyfin scans for the specific Leaving Soon
  libraries after Scrubarr updates `.strm` queue files.
- Added library sync diagnostics for scan requests, indexed item counts, scan
  warnings, and global scan fallback.
- Kept the older global library refresh as a fallback when targeted scans are
  unavailable.

## 1.0.0

- Prepared the repository for public sharing.
- Added clear Windows and Linux install instructions.
- Added a plain-English feature guide.
- Cleaned public-facing security and release documentation.
- Removed internal development notes from the public-facing repository tree.

## 0.1.29

- Removed the deletion countdown glow when nothing is pending.
- Kept the update manifest signed and served from the official update source.

## 0.1.x

- Added Emby cleanup workflow.
- Added Jellyfin provider support.
- Added Leaving Soon libraries using `.strm` files.
- Added preview scans, pending deletion review, exclusions, and deletion
  countdown.
- Added Telegram notifications and deletion reports.
- Added backup and restore.
- Added signed update checks.
- Added Docker release workflow.

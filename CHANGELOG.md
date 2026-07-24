# Changelog

## 1.1.4

- Fixed Leaving Soon library verification after queue changes. Scrubarr now
  checks movie and series title counts separately, requests one global refresh
  when a targeted scan leaves stale indexed media, and records a clear warning
  only if the counts still do not match.

## 1.1.3

- Added simple media-type filters and practical sort options for Pending
  deletions and Exclusions.
- Made Telegram pending-deletion notices use natural singular and plural
  wording, such as `1 day remaining` and `5 days remaining`.

## 1.1.2

- Made the last-deletion media history a bounded, scrollable dropdown on the
  dashboard, so opening a long list no longer stretches surrounding tiles.

## 1.1.1

- Clarified cleanup configuration by moving Preview only mode to the start of
  the renamed Run mode and queue safety section.

## 1.1.0

- Added final deletion revalidation, active-stream protection, and more
  conservative unknown watch-history handling.
- Added pending and exclusion integrity review with safe, evidence-based
  cleanup actions.
- Made Leaving Soon library ownership and fresh-install queue paths safer.
- Improved run outcomes, log reliability, backup handling, and setup guidance.
- Bound signed update guidance to immutable Docker image digests.

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

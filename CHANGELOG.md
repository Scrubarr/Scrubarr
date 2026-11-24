# Changelog

## 1.4.3

- Clarified Telegram alerts so message delivery problems and cleanup
  problems are easy to distinguish, with shorter recovery messages.
- Renamed the pending-removal report to "Kept in library" and clarified
  why each listed item stayed in the library.
- Applied the same italic Scrubarr sign-off with two soap emojis to every
  Telegram message.

## 1.4.2

- Retry Telegram reminders, reports, and alerts after temporary connection
  failures that happen before sending, or short Telegram rate limits.
- Stop and report unconfirmed delivery when resending could create a duplicate.
  Retry only the affected part of a multipart message.
- Record how many pending reminders were due even if sending fails. Mark the
  correct pending items as notified when deleted records are present.
- Updated Express's transitive runtime dependencies to address current
  advisories in body-parser, proxy-addr, and qs.

## 1.4.1

- Fixed Emby watch-history requests to include optional play counts and
  last-played dates for movies and episodes, so cleanup uses the correct
  watched-age rules, including media-server plugin date bumps.
- Prevented watched media from being mistaken for never watched when the
  reported play count is zero. Played flags and last-played dates remain
  evidence of playback during scans and final deletion checks.
- Blocked cleanup safely when watch history is missing, invalid, or incomplete
  for a selected user, including missing per-user episode history for a series.
- Kept Jellyfin requests compatible without sending Emby-only field names,
  added regression coverage, and clarified watched-age behavior in the guide.

## 1.4.0

- Redesigned Logs to show the five newest runs by default, with clear
  failed/partial and warning summaries, date and outcome filters, pagination,
  local timestamps, expandable details, direct links from Scheduler and Safety,
  and redacted troubleshooting exports.
- Added conservative scheduler retries for temporary pre-queue failures, plus
  Telegram failure, incomplete-run, recovery, deletion-deferral, and pending
  queue update alerts with duplicate-notification suppression.
- Recheck due items against current rules, exclusions, watch state, active
  playback, media-server identity, and Arr identity immediately before
  deletion. Items that no longer qualify are removed from pending and Leaving
  Soon, while uncertain or actively playing media remains protected for review.
- Added Jellyfin parity for keeping Leaving Soon libraries together and hiding
  them from secondary home sections, while preserving unrelated user settings
  and rolling back partial preference updates.
- Improved pending and exclusion handling with duplicate search-result removal,
  Title Z-A sorting, clearer action progress, preserved mobile scroll position,
  and safer exclusion artwork recovery.
- Made scheduled-run health easier to understand across Dashboard, Scheduler,
  Safety, and Logs, including protected-item outcomes that no longer look like
  failures.
- Hardened fresh-install queue paths and Linux permissions guidance, clarified
  that queue caps include existing pending items, and added automated checks for
  copy-and-paste Compose examples.
- Updated supported dependencies to resolve known security advisories without
  changing Scrubarr's installation model.

## 1.3.0

- Added Emby controls to keep the Movies and Shows Leaving Soon libraries
  together in every user's library order.
- Hide Leaving Soon media from Emby secondary home sections such as Latest
  Media and Continue Watching by default, with an option to enable it.
- Preserve unrelated Emby user preferences and roll back earlier user updates
  if a later preference update fails.

## 1.2.3

- Wait for active Emby and Jellyfin library scans to finish before validating
  Leaving Soon item counts, preventing false indexing warnings while the media
  server is still scanning.
- Keep genuine path and indexed-count warnings when a completed scan still
  does not match Scrubarr's pending queue.

## 1.2.2

- Retried transient failures while removing Scrubarr-managed Leaving Soon
  queue entries, reducing stale `.strm` files after deletion runs.
- Reconciled missing managed queue entries and removed stale links when the
  matching media-server item or playable episode paths no longer exist.
- Recorded queue repairs, retries, and unresolved cleanup warnings in app and
  run logs; unresolved cleanup now marks the library sync as partial.

## 1.2.1

- Made the guided Docker update field show the readable release tag while
  generated commands continue to use the signed immutable image digest.

## 1.2.0

- Refreshed the dashboard and supporting pages with clearer hierarchy, less
  visual clutter, more useful empty states, and faster progressive loading.
- Improved Pending deletions, activity, storage, media totals, Settings,
  Scheduler, Logs, and Safety layouts across desktop and mobile.
- Kept the scheduler armed after a completed or late duplicate callback while
  continuing to enforce one scheduled run per configured date.
- Fixed touch tooltips closing immediately after they were opened.

## 1.1.5

- Prevented stale scheduler timers from running after a schedule change or
  restart.
- Ensured each scheduled date runs once, avoiding duplicate scans, Telegram
  notifications, and cleanup checks.

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

# Scrubarr Features

This page explains what each Scrubarr area does.

## Dashboard

The Dashboard is the daily admin view.

It shows:

- whether Scrubarr is scheduled
- whether debug logging is enabled
- whether an update is available
- recent run status
- the next scheduled run
- deletion countdown when live deletion is active
- library totals
- storage information from Radarr and Sonarr
- pending deletions
- recent deletion totals

The global search bar lets you search configured media libraries. From search
results you can see whether an item is available, pending, or excluded.

## Cleanup Rules

Cleanup Rules decide what can be added to the pending deletion queue.

### Preview only mode

When Preview only mode is enabled, Scrubarr can scan and show what would happen,
but it will not delete expired pending media.

When Preview only mode is disabled, Scrubarr can delete pending media after the
review period has passed.

### Movie rules

Movie rules apply only to movies.

Useful options include:

- watched and never-watched mode
- release year filters
- include genre filters
- exclude genre filters

### Series rules

Series are handled as whole-series cleanup.

Scrubarr checks whether any episode in the series has watch activity. A series
can qualify when the watched or never-watched rule says it is old enough.

### Shared age rules

Shared age rules apply to both movies and series.

- **Watched age** means media was last watched at least this many days ago.
- **Never watched age** means media has no watch history and was added at least
  this many days ago.
- **Minimum Arr age** is an extra safety check. The item must also have existed
  in Radarr or Sonarr for at least this many days.

### Queue and safety

Queue and safety controls how many items can be added and how long they stay in
review.

- **Maximum movies marked** caps the number of movies pending at once.
- **Maximum series marked** caps the number of series pending at once.
- Existing pending items count toward each cap. A scan fills available spaces
  only when more media qualifies; it does not add a fresh allowance every run.
- **Days until deletion** controls the review period after an item is queued.
- **Direct file deletion fallback** is high risk and should normally stay off.

### Preview scan

Preview scan is a read-only way to check the current rules. It shows matching
media before you choose whether to add items to the pending queue.

## Pending Deletions

Pending deletions are media items waiting for the review period to finish.

From each pending tile you can:

- see why the item qualified
- see when it will be deleted
- remove it from pending
- remove it and add it to exclusions

If Preview only mode is off and the item reaches its deletion date, Scrubarr can
delete it through Radarr or Sonarr.

Filter pending items by media type and sort by due date, marked date, or title
(A-Z or Z-A). **Remove + exclude** waits for queue/library synchronization before
reporting success; its own button shows the progress indicator.

Before live deletion, Scrubarr rechecks current rules, exclusions, and media
identity. Media actively playing or paused in Emby/Jellyfin is deferred, and
unavailable playback checks block deletion. The in-progress protection setting
also protects unfinished watching between sessions.

## Leaving Soon Libraries

Leaving Soon libraries show pending media inside Emby or Jellyfin.

Scrubarr writes `.strm` files to queue folders. The media server reads those
folders as normal libraries, so users can see what is planned for deletion.

Default library names:

- `Movies Leaving Soon`
- `Shows Leaving Soon`

The original media is not copied. The `.strm` files point back to the original
media files.

Emby and Jellyfin settings also include **Keep libraries together**, which
places the two Leaving Soon libraries beside each other in every user's library
order, and **Show in home sections**, which controls appearances in Latest Media
and Continue Watching. The latter is off by default to reduce duplicate home
entries. These preferences are applied during Leaving Soon library sync.

## Exclusions

Exclusions protect media from being added to pending deletion.

Use exclusions for:

- favourites
- shared family media
- seasonal media
- anything that should never be cleaned up automatically

You can search existing exclusions and remove them later if needed.

Filter by media type and sort by title (A-Z or Z-A), release year, or media type.
Safety's exclusion review flags records that need attention when their linked
media or Arr record changes. A warning does not silently remove the exclusion;
review it before choosing whether to keep or remove it.

## Scheduler

The scheduler runs Scrubarr automatically.

A scheduled run can:

1. scan libraries
2. add eligible items to pending
3. sync Leaving Soon libraries
4. send Telegram notifications
5. delete expired pending items when Preview only mode is disabled

Disable scheduled runs before making major setting changes or applying updates.

If a run cannot start because another operation is busy, or a temporary service
failure occurs before queue changes begin, Scrubarr can retry after one minute
and then five more minutes. There are at most two retries for that scheduled
date. Changing or disabling the schedule cancels them. Scrubarr does not replay
partially completed runs or catch up missed runs automatically after downtime.

## Telegram

Telegram notifications are optional.

Scrubarr can send:

- first-day summaries when new items are queued
- reminder messages
- deletion reports
- failed deletion alerts
- connection failures detected during scheduled scans and incomplete/failed run alerts
- recovery messages after a subsequent healthy scheduled run

First-day summaries, deletion reports, and critical alerts are always sent when
Telegram is enabled. Reminder frequency is controlled by the Notifications
setting.

Scrubarr itself sends these alerts through your configured bot; no external
automation is needed. Repeated identical run problems are suppressed, with at
most one reminder every 24 hours while they persist. A changed problem can
trigger a new alert. Failures and details remain in Logs.

These are run-time checks, not continuous server monitoring. If Scrubarr is
stopped, or Telegram/the internet is unavailable, it cannot deliver an alert.
An unsuccessful delivery is logged and a continuing failure is checked again
on the next run/retry. Do not rely on Telegram as the only record of run health.

## Logs

The Logs page keeps up to 200 recent run records and shows the five newest by
default. Use the outcome buttons to jump straight to failed/partial runs or
runs with warnings, or filter by run type and a local-date range. Choose 5, 25,
100, or all matching entries per page.

Each run stays collapsed until you open it. The summary shows scan, queue,
library-sync, notification, and deletion outcomes; expanded details explain
warnings, protected media, removed pending items, and failures. Scheduler and
Safety can link directly to the relevant run.

The App log and raw Run log remain available for deeper troubleshooting. You
can export either log as text or download a ZIP containing both. Exports redact
recognized secrets, but review a file before sharing it because paths, media
titles, and service details may still be private.

## Safety

The Safety page explains whether Scrubarr is ready for live cleanup.

It highlights:

- Preview only mode status
- media server setup
- Radarr/Sonarr setup
- Telegram setup
- pending queue warnings
- missing queue files
- risky direct file deletion settings
- basic-auth status

This page is not a second dashboard. It is a checklist for things that could
make cleanup unsafe or confusing.

## Backup And Restore

Backups can export settings and state.

You can export:

- without credentials
- with credentials

Exports without credentials still contain private service URLs, paths, and media
state, so keep them private. Exports with credentials also include API keys,
Telegram token, and auth data.

Imports can restore everything or selected sections. Restoring pending deletions
is an advanced option because old pending items may no longer exist in the queue
folders or in Radarr/Sonarr.

## Updates

Scrubarr can check a signed update manifest. Official manifests can include an
immutable Docker image digest so the guided update commands point to the exact
published image for that release.

The update check is read-only. It does not pull Docker images, restart the
container, or change files by itself.

When an update is available, Scrubarr shows it in the top bar and on the
Dashboard. The admin still applies the Docker update from the host machine.

## Emby And Jellyfin

Each Scrubarr install is locked to one media server provider:

- Emby
- Jellyfin

Emby has the longer production history. Jellyfin has also completed end-to-end
cleanup testing. For either provider, use Preview only mode and verify the
Leaving Soon libraries before enabling live deletion.

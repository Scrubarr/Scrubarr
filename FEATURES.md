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

- **Maximum movies marked** limits how many movies can be added in one run.
- **Maximum series marked** limits how many series can be added in one run.
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

## Leaving Soon Libraries

Leaving Soon libraries show pending media inside Emby or Jellyfin.

Scrubarr writes `.strm` files to queue folders. The media server reads those
folders as normal libraries, so users can see what is planned for deletion.

Default library names:

- `Movies Leaving Soon`
- `Shows Leaving Soon`

The original media is not copied. The `.strm` files point back to the original
media files.

## Exclusions

Exclusions protect media from being added to pending deletion.

Use exclusions for:

- favourites
- shared family media
- seasonal media
- anything that should never be cleaned up automatically

You can search existing exclusions and remove them later if needed.

## Scheduler

The scheduler runs Scrubarr automatically.

A scheduled run can:

1. scan libraries
2. add eligible items to pending
3. sync Leaving Soon libraries
4. send Telegram notifications
5. delete expired pending items when Preview only mode is disabled

Disable scheduled runs before making major setting changes or applying updates.

## Telegram

Telegram notifications are optional.

Scrubarr can send:

- first-day summaries when new items are queued
- reminder messages
- deletion reports
- failed deletion alerts
- connection or run failure alerts

First-day summaries, deletion reports, and critical alerts are always sent when
Telegram is enabled. Reminder frequency is controlled by the Notifications
setting.

## Logs

The Logs page shows:

- run history
- scheduler activity
- scan results
- deletion results
- app logs for troubleshooting

Secrets and raw API payloads should not appear in normal logs.

You can export logs for troubleshooting.

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

- without secrets
- with secrets

Exports with secrets include API keys, Telegram token, and auth data.

Imports can restore everything or selected sections. Restoring pending deletions
is an advanced option because old pending items may no longer exist in the queue
folders or in Radarr/Sonarr.

## Updates

Scrubarr can check a signed update manifest.

The update check is read-only. It does not pull Docker images, restart the
container, or change files by itself.

When an update is available, Scrubarr shows it in the top bar and on the
Dashboard. The admin still applies the Docker update from the host machine.

## Emby And Jellyfin

Each Scrubarr install is locked to one media server provider:

- Emby
- Jellyfin

Emby is the most tested path. Jellyfin support is available but should be
treated as beta until you confirm it works in your own setup.

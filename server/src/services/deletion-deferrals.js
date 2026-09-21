const DEFINITIONS = Object.freeze({
  "in-progress": {
    message:
      "Removed from pending because the item is partially watched and in-progress protection is enabled.",
    reason: "Partially watched; in-progress protection is enabled.",
    removeFromPending: true,
  },
  "media-in-use": {
    message:
      "Deletion deferred for safety because the item is currently playing or paused.",
    reason: "Currently playing or paused; active playback protection is enabled.",
  },
  excluded: {
    message: "Removed from pending because the item is now excluded from cleanup.",
    reason: "Now excluded from cleanup.",
    removeFromPending: true,
  },
  "age-rule-not-met": {
    message:
      "Removed from pending because the item's current watch history no longer meets the cleanup age rules.",
    reason: "Current watch history no longer meets the cleanup age rules.",
    removeFromPending: true,
  },
  "watched-rule-not-met": {
    message:
      "Removed from pending because the item's latest playback is too recent for the watched-media rule.",
    reason: "Latest playback is too recent for the watched-media rule.",
    removeFromPending: true,
  },
  "unwatched-rule-not-met": {
    message:
      "Removed from pending because the item is too new for the unwatched-media rule.",
    reason: "Too new for the unwatched-media rule.",
    removeFromPending: true,
  },
  "too-new": {
    message: "Removed from pending because the item is too new for the current cleanup rules.",
    reason: "Too new for the current cleanup rules.",
    removeFromPending: true,
  },
  "year-before-filter": {
    message: "Removed from pending because the item no longer matches the configured year range.",
    reason: "No longer matches the configured year range.",
    removeFromPending: true,
  },
  "year-after-filter": {
    message: "Removed from pending because the item no longer matches the configured year range.",
    reason: "No longer matches the configured year range.",
    removeFromPending: true,
  },
  "genre-not-included": {
    message: "Removed from pending because the item no longer matches the included genres.",
    reason: "No longer matches the included genres.",
    removeFromPending: true,
  },
  "genre-excluded": {
    message: "Removed from pending because the item now matches an excluded genre.",
    reason: "Now matches an excluded genre.",
    removeFromPending: true,
  },
  "already-pending": {
    message: "Deletion deferred because another active pending record matches this item.",
    reason: "Another active pending record matches this item.",
    needsAttention: true,
  },
  "watch-history-unknown": {
    message: "Deletion deferred because current watch history could not be confirmed.",
    reason: "Current watch history could not be confirmed.",
    needsAttention: true,
  },
  "missing-arr-date": {
    message: "Deletion deferred because the current Arr added date could not be confirmed.",
    reason: "The current Arr added date could not be confirmed.",
    needsAttention: true,
  },
  "revalidation-unavailable": {
    message: "Deletion deferred because current media data could not be rechecked.",
    reason: "Current media data could not be rechecked.",
    needsAttention: true,
  },
  "media-server-item-not-found": {
    message:
      "Deletion deferred because the item no longer appears in the configured media-server libraries.",
    reason: "No longer appears in the configured media-server libraries.",
    needsAttention: true,
  },
  "media-server-item-changed": {
    message:
      "Deletion deferred because the media-server item type no longer matches the pending record.",
    reason: "The media-server item type no longer matches the pending record.",
    needsAttention: true,
  },
  "arr-identity-changed": {
    message: "Deletion deferred because the current Arr record no longer matches the pending item.",
    reason: "The current Arr record no longer matches the pending item.",
    needsAttention: true,
  },
  "revalidation-required": {
    message: "Deletion deferred because final safety revalidation was not completed.",
    reason: "Final safety revalidation was not completed.",
    needsAttention: true,
  },
});

function definitionFor(code) {
  return DEFINITIONS[String(code || "")] || {
    message: "Deletion deferred because the item no longer matches the current cleanup rules.",
    reason: "No longer matches the current cleanup rules.",
    needsAttention: true,
  };
}

export function deletionDeferralMessage(code) {
  return definitionFor(code).message;
}

export function deletionDeferralReason(code) {
  return definitionFor(code).reason;
}

export function deletionDeferralNeedsAttention(item) {
  return definitionFor(item?.SkipCode).needsAttention === true;
}

export function deletionDeferralRemovesPending(item) {
  return definitionFor(item?.SkipCode).removeFromPending === true;
}

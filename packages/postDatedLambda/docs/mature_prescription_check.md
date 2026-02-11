This is the business logic used for checking if a prescription ID has matured or not. It needs to tolerate a mixture of post-dated, and contemporary prescription updates; e.g. "ready to collect", post-dated, followed by "with pharmacy" non-post-dated.

The lambda drains the post-dated SQS queue in batches and handles each message based on the result of `determineAction()`. Immature prescriptions will be re-processed after some delay by changing their visibility timeout. Some prescriptions may no longer need to be considered (e.g. if there has been a subsequent PSU request marking it as "with pharmacy" again), so are deleted from the post-dated SQS without being forwarded to the notifications SQS. Mature prescriptions are forwarded to the notifications SQS.
```mermaid
flowchart TB
  START["Scheduled EventBridge trigger"] --> REPORT["Report post-dated queue status"]
  REPORT --> LOOP{"Within max runtime?"}
  LOOP -- No --> EXIT["Exit and report queue status"]
  LOOP -- Yes --> RECV["Receive up to 10 SQS messages (long poll)"]
  RECV --> ENRICH["Enrich messages with most recent NPPTS record"]
  ENRICH --> DETERMINE["Run `determineAction()` per message"]
  DETERMINE --> REPROCESS["Change visibility timeout (reprocess later)"]
  DETERMINE --> FORWARD["Forward to Notifications queue"]
  DETERMINE --> REMOVE["Remove from post-dated queue"]
  FORWARD --> DELETE["Delete from post-dated queue"]
  REPROCESS --> LOOP
  REMOVE --> LOOP
  DELETE --> LOOP
```

The `determineAction()` function accepts the SQS message for this prescription ID, enriched with the most recent NPPTS record for this prescription ID. It checks whether that record is post-dated and still in a notifiable status, then compares `LastModified` (i.e. the time that a post-dated update will transition) to the current time to determine whether the update is still immature or has matured. The decision of if a notification needs to be sent to this patient is handled by the notifications lambda, still.

```mermaid
flowchart TD
  A["Start `determineAction()`"] --> E{"mostRecentRecord present?"}
  E -- No --> F["Log error + return REMOVE_FROM_PD_QUEUE"]
  E -- Yes --> H{"PostDatedLastModifiedSetAt present?"}
  H -- No --> I["Log non post-dated + return REMOVE_FROM_PD_QUEUE"]
  H -- Yes --> K{"Status in [ready to collect, ready to collect - partial]?"}
  K -- No --> L["Log non-notifiable + return REMOVE_FROM_PD_QUEUE"]
  K -- Yes --> M["mostRecentLastModified = Date(LastModified)"]
  M --> N["currentTime = new Date()"]
  N --> O{"mostRecentLastModified AFTER currentTime?"}
  O -- Yes --> P["return REPROCESS"]
  O -- No --> Q["return FORWARD_TO_NOTIFICATIONS"]
```

This is the business logic used for checking if a prescription ID has matured or not. It needs to tolerate a mixture of post-dated, and contemporary prescription updates; e.g. "ready to collect", post-dated, followed by "with pharmacy" non-post-dated.

The business logic's `processMessage()` function accepts the SQS message for this prescription ID, enriched with the results of querying the NPPTS data store for this prescription ID (this is the `existingRecords` attribute. Then, it inspects only the most recently submitted update for this prescription ID, and checks if it is a) actually post dated (a contemporary update may have come in since the post-dated one that triggered this SQS message), and b) has matured from "will be ready to collect" to "is now ready to collect". The decision of if a notification needs to be sent to this patient is handled by the notifications lambda, still.

```mermaid
flowchart TD
    A["Start `processMessage()`"] --> E{"existingRecords empty?"}
    E -- Yes --> F["Log error + return IGNORE"]
    E -- No --> G["Fetch most recently submitted NPPTS record"]
    G --> H{"PostDatedLastModifiedSetAt present?"}
    H -- No --> I["Log non post-dated + return IGNORE"]
    H -- Yes --> K{"NPPTS Status in [RTC, RTC-partial]?"}
    K -- No --> L["Log non-notifiable + return IGNORE"]
    K -- Yes --> M["mostRecentLastModified = Date(LastModified)"]
    M --> N["currentTime = new Date()"]
    N --> O{"mostRecentLastModified AFTER currentTime?"}
    O -- Yes --> P["return IMMATURE"]
    O -- No --> Q["return MATURED"]
```

Immature prescriptions will be re-processed after some delay, by being updated on SQS. Some prescriptions may no longer need to be considered (e.g. if there has been a subsequent PSU request marking it as "with pharmacy" again), so are deleted from the post-dated SQS without being forwarded to the notifications SQS. Mature prescriptions are forwarded to the notifications SQS.
```mermaid
flowchart TB
  PSU[PSU] -- "Post dated" --> Qp["Post-dated SQS queue"]
  PSU -- "Contemporary" --> Qn[Notifications SQS queue]

  Qp --> lp["Post-dated lambda"]
  Qn --> ln["Notifications lambda"]

  lp -- MATURE --> Qn
  lp -- IMMATURE --> Qp
  lp -- IGNORE --> X((Delete))
```

---
name: on-call
description: Cartwheel on-call support — triage Sidekiq job failures, investigate AASM/state machine issues, run Rails console fixes, search Datadog logs, and log incidents to the knowledge base. Use when the user is investigating production alerts, Sidekiq errors, Healthie job failures, or any on-call incident.
---

# On-Call: Cartwheel Production Support

## Context

Cartwheel is a Rails 7.1 healthcare app. On-call work primarily involves:
- Triaging **Sidekiq job failures** (Healthie API jobs, billing jobs, AASM state transitions)
- Investigating **state machine (AASM) errors** on `Journey` and related models
- Doing **manual data fixes** via Rails console when automated flows break
- Filing **Linear tickets** for root causes that need engineering follow-up
- **Logging incidents** to the knowledge base on-call collection

---

## Step 1: Find the Failure

### Search Datadog for failing Sidekiq jobs

**⚠️ Service names are environment-prefixed** — there is no bare `service:sidekiq`. Use the full names or a wildcard, otherwise queries return zero results:
- `cartwheel-production-sidekiq` / `cartwheel-production-web`
- `cartwheel-staging-sidekiq` / `cartwheel-staging-web`
- `cartwheel-testing-web`

```bash
# Find production Sidekiq errors in the last hour
pup logs search --query "status:error service:cartwheel-production-sidekiq" --from 1h

# Any environment (wildcard) — handy to see the split before narrowing
pup logs search --query "status:error service:*-sidekiq" --from 1h

# Find a specific job class (scope to production)
pup logs search --query "status:error service:cartwheel-production-sidekiq Healthie::HandleFormAnswerGroupEventJob" --from 24h

# Find errors for a specific client or journey ID
pup logs search --query "status:error e2d180a0-ddd8-4099-a14e-ac6fed295e20" --from 7d

# Find AASM transition failures
pup logs search --query "AASM::InvalidTransition" --from 24h

# Find NoMethodError in a specific class
pup logs search --query "NoMethodError EndOfCareSummaryCreator" --from 24h
```

### Check auth if commands fail

```bash
pup auth refresh   # refresh expired token
pup auth login     # full re-auth if refresh fails
```

---

## Step 2: Triage Decision Tree

When a Sidekiq job is failing, ask:

### 1. Is there user/patient impact?
- **No active services / duplicate referral / archived profile** → likely safe to kill the job
- **Tags/billing/consent not applied for active client** → needs manual fix before killing

### 2. What's the error class?

| Error | Likely Cause | Default Action |
|-------|-------------|----------------|
| `AASM::InvalidTransition` | State machine gap or Healthie-side scheduling drift | See AASM section below |
| `NoMethodError: undefined method 'id' for nil` in `EndOfCareSummaryCreator` | Clinician filed discharge note with wrong service type | Kill job — clinician error |
| `Healthie::Api::Error: Something went wrong` on tag/email jobs | Stale or archived Healthie profile | Check profile, fix ID, retry |
| `AperoApi::AperoApiError: 400 contact_email` | Invalid email format in client record | Fix email in Healthie, wait for DW sync, retry |
| Race condition (`InvalidTransition` from `intake_scheduled` on self-scheduling job) | Coordinator manually assigned before async job ran | Kill job — no action needed |

---

## Step 3: AASM Invalid Transition Patterns

### Known state machine gaps

| Source State | Attempted Event | Cause | Fix |
|---|---|---|---|
| `intake_scheduled` | `mark_ready_for_assignment` | Self-scheduling job ran after coordinator manually assigned | Kill job |
| `clinician_assigned` | `mark_pending_discharge` | No-show auto-discharge can't run from this state | Escalate to CC team via PHICARE Slack |
| `outreach_ongoing` | `mark_pending_discharge` | Journey state drifted — appointments scheduled in Healthie directly, bypassing portal | Advance journey state manually, then re-process |

### Advancing a stuck journey (Rails console)

When a journey is stuck in `outreach_ongoing` but has active appointments and no-shows, and auto-discharge is the right outcome:

```ruby
# Find the journey
journey = Journey.find("uuid-here")
journey.status  # confirm current state

# Advance to care_ongoing (allows mark_pending_discharge)
journey.update!(status: "care_ongoing")

# Re-process the triggering form answer group event
Healthie::HandleFormAnswerGroupEventJob.perform_later(
  form_answer_group_id: 12345678,
  event: "signed"
)
```

**⚠️ Only advance state if**: all future appointments are deleted AND the no-shows/auto-discharge is clearly the right clinical outcome.

---

## Step 4: Healthie Profile Issues

### Stale Healthie ID on re-referred client

Symptom: `Healthie::ApplyClientTagJob` or similar fails with "Something went wrong. Make sure you have selected a user to apply a tag on."

Root cause: `ensure_healthie_account_exists!` in `ClientOnboardingForm` only checks `healthie_id.present?` — it doesn't verify the profile actually exists in Healthie. Re-referred clients can have stale IDs pointing to non-existent/archived profiles. (Tracked in **RND-1204**.)

Fix:
1. Find the client in the Rails admin or app: `https://app.cartwheel.org/students/<uuid>`
2. Check the `healthie_id` on the client record
3. Look up that Healthie ID in the Healthie portal — is it active?
4. If archived: reactivate it in Healthie UI
5. Update the client record to point to the correct Healthie ID
6. Clear `healthie_id` from any stale duplicate client record
7. Manually sync tags:

```ruby
client = Client.find("uuid-here")
HealthieClientTagger.new(client: client).sync_tags
```

8. Kill the failing Sidekiq job

---

## Step 5: Manual Data Fixes

### Reconstruct a paper ROI / consent record

When a family signed paper forms but the portal has no digital record:

```ruby
# Use the standard code path — don't manually create DB records
# ClientConsentForm handles legal consent, signature, ROI HTML, client events, Healthie tags
form = ClientConsentForm.new(
  client: Client.find("uuid"),
  signed_by: User.find("guardian-uuid"),
  # ... appropriate params
)
result = form.save

# Mark as reconstructed from paper forms
roi = client.reload.roi
roi.update!(reconstructed: true)
```

### Manually sync Healthie tags

```ruby
client = Client.find("uuid")
HealthieClientTagger.new(client: client).sync_tags
```

### Change a school user's login email / migrate a district email domain

See the R&D handbook on-call runbook → **Operation Requests → "Change a school user's login email / migrate a district email domain"** (`handbook/docs/reference/on-call-runbook.md`) for the full procedure. Key points: Google SSO matches purely by `User.email` (no `uid`), and Devise `reconfirmable` requires `skip_reconfirmation!` before the new email takes effect.

### Kill a Sidekiq job

Find the job ID in the Datadog log, then in Rails console or Sidekiq UI:

```ruby
# Via Sidekiq API
require 'sidekiq/api'

# Find in retry set
Sidekiq::RetrySet.new.each do |job|
  puts "#{job.jid} #{job.klass} #{job.args}" if job.klass =~ /HandleFormAnswerGroup/
end

# Kill a specific job by JID
Sidekiq::RetrySet.new.find_job("jid-here")&.delete
```

---

## Step 6: Escalation

### When to escalate to care coordinators (PHICARE Slack)

- Journey is in a state that **shouldn't have appointments** (e.g., `clinician_assigned`) but has no-shows + auto-discharge firing
- Clinical context is needed to decide whether to advance journey state or end it directly
- A discharge note appears to be misplaced (wrong client or wrong service) — CC team has clinical context

### When to file a Linear ticket

File a ticket when the root cause is a **code bug**, not just a data/operational issue:

- State machine doesn't guard against a known transition path that can legitimately occur
- A guard checks presence but not validity (e.g., `healthie_id.present?` without profile verification)
- `EndOfCareSummaryCreator` crashes with nil instead of gracefully handling missing journeys
- Use `RND-` prefix for engineering bugs

---

## Step 7: Log the Incident

After resolving each incident, activate the `knowledge-base` skill and search the `oncall` collection before writing directly to its configured root:

```bash
# Find the current shift document or related incidents
kb search "current shift or incident terms" --collection oncall --limit 10 --json
kb get 'oncall/<relative-path>.md'

# Resolve the source directory before creating or updating a document
kb collection show oncall --json
```

After writing, refresh only this collection and verify the incident is searchable:

```bash
kb update oncall
kb search "distinctive incident terms" --collection oncall --limit 5
```

Incident format:
```markdown
### <Job class> failing — <one-line description>

- **Time**: When first failure occurred; how long retrying
- **Client/Journey**: Link to app.cartwheel.org record
- **Error**: Exact error message
- **Impact**: User-facing impact (or "None")

**Root Cause**: ...

**Resolution**: ...

**Follow-up**: Linear ticket if applicable, or "None required"
```

---

## Known Recurring Patterns (Quick Reference)

| Pattern | Action |
|---|---|
| `HandleFormAnswerGroupEventJob` nil journey → `EndOfCareSummaryCreator` crash | Clinician error: wrong service on discharge note. Kill job, no data change. |
| AASM invalid transition from `outreach_ongoing` or `clinician_assigned` | State drift from Healthie-side scheduling. Check clinical context, consider manual state advance. |
| Self-scheduling job races with coordinator manual assignment | Known race condition. Kill job — journey is already correctly assigned. |
| Healthie API error on tag/email job for duplicate/archived referral | No active services. Kill job. |
| `contact_email` validation error in billing job | Fix email in Healthie portal, wait ~5-10 min for data warehouse sync, retry job. |
| `ensure_healthie_account_exists!` passes but Healthie profile is gone | Stale `healthie_id`. Reactivate or reassign Healthie profile. See RND-1204. |

### Benign Noise (NOT incidents — do not chase)

| Log stream | Why it's noise |
|---|---|
| `AutomatedOutreachGapDetectionJob` logging `automated_outreach_gap_detected` (e.g. `gap_type: stale_closure`) at ERROR level | Detection output, not a crash. Job runs correctly on schedule (14:00/16:00 UTC) but logs findings at ERROR severity. Ignore unless dashboard noise warrants a log-level downgrade ticket. |
| `ActionDispatch::HostAuthorization::DefaultResponseApp Blocked hosts: containers` on `*-web` | Internal health-check probes with an unrecognized Host header (~every 20s). Pure noise. |

---

## Useful Links

- Sidekiq UI: `https://app.cartwheel.org/sidekiq` (requires admin access)
- Datadog: `https://app.datadoghq.com`
- Healthie Admin: `https://app.gethealthie.com`
- Linear: `https://linear.app/cartwheel-care`
- Client records: `https://app.cartwheel.org/students/<uuid>`

---

## Related Skills

- **dd-pup** — Datadog CLI reference (log search, monitors, traces)
- **dd-logs** — Log search syntax and pipelines
- **knowledge-base** — Search, retrieve, write, index, and verify durable incident records with `kb`

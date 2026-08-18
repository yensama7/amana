# Swift Loan Frontend Guide

## 1. Frontend Layout & Design Guide

### Component Hierarchy
```
SwiftLoan (web/app/swift-loan/page.jsx)         — single component, no children
  └── [card] Application form
  └── [card] Waiting state       (conditional: phase === 'waiting')
  └── [card] Blocked state        (conditional: phase === 'blocked')
  └── [card] Outcome              (conditional: phase === 'done' && outcome)
```

### State Variables
| Variable | Type | Initial | Description |
|----------|------|---------|-------------|
| `amanaId` | `string` | `''` | The citizen's Swift Loan–specific amanaId (pasted from Amana Way app) |
| `phase` | `'idle' \| 'waiting' \| 'done' \| 'blocked'` | `'idle'` | Controls which card renders |
| `outcome` | `{ ok: boolean, receiptId: string, status: string } \| null` | `null` | Gateway response after verification completes |

### Layout Structure
```
<nav>  (shared, from layout.jsx — do not modify)
<main>
  <div class="card">        ← always visible: form card
    <h2>                    ← company name + emoji
    <p>                     ← description of what is verified
    <p>                     ← claims list (bold text)
    <p class="muted">       ← instruction to get amanaId
    <div class="row">
      <input>               ← amanaId text input
      <button>              ← "Apply for loan" — disabled while waiting
    </div>
    <p class="muted">       ← tip about wrong ID demo
  </div>

  <div class="card">        ← conditional: waiting
    <p><span class="spinner" /> …text… </p>
  </div>

  <div class="card">        ← conditional: blocked
    <h2>🚫 Request blocked</h2>
    <p> revocation message </p>
  </div>

  <div class="card">        ← conditional: done
    <h2> ✅ or ❌ verdict</h2>
    <p> ok boolean + receipt id (.mono) </p>
    <p class="muted"> privacy note </p>
  </div>
</main>
```

### Style Classes Used
| Class | Purpose |
|-------|---------|
| `.card` | White/dark card container with padding and border-radius |
| `.row` | Flexbox row — aligns input + button horizontally |
| `.muted` | Subdued text color for secondary information |
| `.mono` | Monospace font — for amanaId / receiptId display |
| `.spinner` | Animated CSS spinner element (inline) |

---

## 2. Logic Workflow

### Step-by-step

**Step 1 — Citizen opens Swift Loan page**
- `phase` = `'idle'`, `amanaId` = `''`
- The form card is visible with an empty input

**Step 2 — Citizen pastes their Swift Loan amanaId**
- amanaId is derived in the Amana Way app: `Poseidon(walletSecret, '1001')`
- It is always a large decimal number (no letters, no dashes)
- The `<input>` onChange updates `amanaId` state

**Step 3 — Citizen clicks "Apply for loan"**
- `apply()` runs:
  1. Validates `amanaId` matches `/^\d+$/` — if not, shows an alert
  2. Sends `POST /api/request` with `{ rpId, rpName, amanaId, minScore: 600 }`
  3. If response is `403`: sets `phase = 'blocked'` and stops
  4. Otherwise: extracts `requestId` from response, sets `phase = 'waiting'`

**Step 4 — Waiting for citizen approval**
- A spinner card renders: "Waiting for you to respond in the Amana Way app…"
- The "Apply" button is disabled (`disabled={phase === 'waiting'}`)
- A `setInterval` polls `GET /api/requests/:requestId` every 2 seconds

**Step 5 — Citizen approves or denies in Amana Way**
- Citizen sees the consent screen in `/wallet` with 4 claims
- On approval: wallet generates 4 ZK proofs in parallel, submits to `/api/verify`
- On denial: wallet calls `/api/requests/:id/deny`

**Step 6 — Polling detects non-pending status**
- `status` changes from `'pending'` to `'verified'`, `'failed'`, or `'denied'`
- `clearInterval(timer)` stops polling
- `setOutcome(r)`, `setPhase('done')`

**Step 7 — Outcome card renders**
- `outcome.ok === true` → green "✅ Loan pre-approved" with receipt
- `outcome.ok === false` → red "❌ Verification failed" with receipt

### Revocation path (Step 3a)
If the citizen previously revoked Swift Loan on the Consent Dashboard:
- `POST /api/request` returns HTTP 403
- `phase` is set to `'blocked'`
- Blocked card renders immediately — no polling, no waiting

---

## 3. Endpoint Documentation

### POST /api/request
Opens a new verification request for Swift Loan.

**Request**
```
POST /api/request
Content-Type: application/json

{
  "rpId":     "1001",
  "rpName":   "Swift Loan",
  "amanaId":  "<citizen's Swift Loan amanaId — large decimal string>",
  "minScore": 600
}
```

**Successful response** — HTTP 200
```json
{
  "requestId": 42,
  "status": "pending"
}
```
Store `requestId` to poll with.

**Revoked response** — HTTP 403
```json
{
  "error": "revoked",
  "message": "The citizen has revoked access for this company."
}
```
Show the blocked card. Do not poll.

**Error response** — HTTP 400
```json
{ "error": "rpId and rpName are required" }
```
Handle in UI (should not occur in normal flow).

---

### GET /api/requests/:id
Poll for the outcome of a request. Call every 2 seconds while `status === 'pending'`.

**Request**
```
GET /api/requests/42
```

**Response** — HTTP 200
```json
{
  "id": 42,
  "status": "verified",
  "ok": true,
  "receiptId": "a3f8c2d1-..."
}
```

| `status` | `ok` | Meaning |
|----------|------|---------|
| `"pending"` | — | Still waiting for citizen; keep polling |
| `"verified"` | `true` | All proofs valid; show success card |
| `"failed"` | `false` | One or more proofs invalid; show failure card |
| `"denied"` | `false` | Citizen pressed Deny; show failure card |

Stop polling when `status !== 'pending'`. Use `ok` (boolean) for the outcome display, `receiptId` (string) for the receipt.

**Not found** — HTTP 404
```json
{ "error": "not found" }
```
Should not occur if `requestId` came from a valid `/api/request` call.

---

### Error Handling Summary
| Scenario | How to handle |
|----------|--------------|
| `POST /api/request` → 403 | Show blocked card, stop |
| `POST /api/request` → 400 | `console.error`, show generic error message |
| `GET /api/requests/:id` → 404 | Stop polling, show generic error |
| Network failure on any call | Silently retry on next interval tick (current behavior) |
| Citizen never responds | Polling continues indefinitely — add a timeout if needed |

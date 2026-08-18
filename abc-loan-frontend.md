# ABC Loan Frontend Guide

## 1. Frontend Layout & Design Guide

### Component Hierarchy
```
AbcLoan (web/app/abc-loan/page.jsx)              — single component, no children
  └── [card] Application card
  └── [card] Waiting state       (conditional: phase === 'waiting')
  └── [card] Blocked state        (conditional: phase === 'blocked')
  └── [card] Outcome              (conditional: phase === 'done' && outcome)
```

ABC Loan is simpler than Swift Loan — **no amanaId input**. The citizen just clicks one button.

### State Variables
| Variable | Type | Initial | Description |
|----------|------|---------|-------------|
| `phase` | `'idle' \| 'waiting' \| 'done' \| 'blocked'` | `'idle'` | Controls which card renders |
| `outcome` | `{ ok: boolean, receiptId: string, status: string } \| null` | `null` | Gateway response after verification completes |

Note: No `amanaId` state — ABC Loan does not request ID ownership proof.

### Layout Structure
```
<nav>  (shared, from layout.jsx — do not modify)
<main>
  <div class="card">        ← always visible: application card
    <h2>                    ← company name + emoji
    <p>                     ← what is verified (just 2 facts)
    <p>                     ← claims list (bold: "age ≥ 18 · Nigerian citizen")
    <p class="muted">       ← instruction to open Amana Way
    <div class="row">
      <button>              ← "Check eligibility" — disabled while waiting
    </div>
  </div>

  <div class="card">        ← conditional: waiting
    <p><span class="spinner" /> …text… </p>
  </div>

  <div class="card">        ← conditional: blocked
    <h2>🚫 Request blocked</h2>
    <p> revocation message </p>
  </div>

  <div class="card">        ← conditional: done
    <h2> ✅ or ❌ verdict </h2>
    <p> ok boolean + receipt id (.mono) </p>
    <p class="muted"> privacy note </p>
  </div>
</main>
```

### Key Design Difference vs Swift Loan
ABC Loan has **no text input** — the button is the only interactive element in the form card. The layout should communicate that this is a lightweight, low-friction check. Visually distinguish the 2-claim card from Swift Loan's 4-claim card so judges immediately see the modular difference.

### Style Classes Used
| Class | Purpose |
|-------|---------|
| `.card` | Container with padding and border-radius |
| `.row` | Flexbox row — button only, no input |
| `.muted` | Subdued text for secondary information |
| `.mono` | Monospace font for receipt ID |
| `.spinner` | Animated inline spinner |

---

## 2. Logic Workflow

### Step-by-step

**Step 1 — Citizen opens ABC Loan page**
- `phase` = `'idle'`
- Single card with description and "Check eligibility" button

**Step 2 — Citizen clicks "Check eligibility"**
- `apply()` runs:
  1. Sends `POST /api/request` with only `{ rpId: '2002', rpName: 'ABC Loan' }` — no amanaId, no minScore
  2. Gateway derives claims: `['age_gte_18', 'citizenship_ng']` (base claims only)
  3. If response is `403`: sets `phase = 'blocked'`, stops
  4. Otherwise: extracts `requestId`, sets `phase = 'waiting'`

**Step 3 — Waiting for citizen approval**
- Spinner card renders
- "Check eligibility" button is disabled (`disabled={phase === 'waiting'}`)
- `setInterval` polls `GET /api/requests/:requestId` every 2 seconds

**Step 4 — Citizen approves in Amana Way**
- Consent screen shows exactly 2 claims (no credit, no ID ownership)
- Wallet generates only 2 proofs — `age_gte_18` + `citizenship_ng` circuits
- This is the key demo moment: the wallet never touches the other circuits

**Step 5 — Polling detects non-pending status**
- Same as Swift Loan: stop interval, set outcome, set `phase = 'done'`

**Step 6 — Outcome card renders**
- `outcome.ok === true` → green "✅ Eligible"
- `outcome.ok === false` → red "❌ Not eligible"

### What makes this demo valuable for judges
1. The consent screen in Amana Way shows 2 items (vs 4 for Swift Loan)
2. The ZK Terminal shows only 2 circuits running
3. The wallet's liveness counter stays smooth during 2 proofs (faster than 4)
4. ABC Loan receives the same boolean + receipt — but knows LESS about the citizen

---

## 3. Endpoint Documentation

### POST /api/request
Opens a new verification request for ABC Loan.

**Request**
```
POST /api/request
Content-Type: application/json

{
  "rpId":   "2002",
  "rpName": "ABC Loan"
}
```
No `amanaId`. No `minScore`. The gateway infers claims from what is provided.

**Successful response** — HTTP 200
```json
{
  "requestId": 87,
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
Should not occur in normal flow.

---

### GET /api/requests/:id
Poll for the outcome of a request. Call every 2 seconds while `status === 'pending'`.

**Request**
```
GET /api/requests/87
```

**Response** — HTTP 200
```json
{
  "id": 87,
  "status": "verified",
  "ok": true,
  "receiptId": "f1d9a3c2-..."
}
```

| `status` | `ok` | Meaning |
|----------|------|---------|
| `"pending"` | — | Still waiting; keep polling |
| `"verified"` | `true` | Both proofs valid; citizen is eligible |
| `"failed"` | `false` | A proof failed; show failure |
| `"denied"` | `false` | Citizen pressed Deny |

Stop polling when `status !== 'pending'`. Use `ok` for the UI verdict, `receiptId` for the receipt.

**Not found** — HTTP 404
```json
{ "error": "not found" }
```

---

### Claims Generated by This Request
The gateway automatically constructs `claims = ['age_gte_18', 'citizenship_ng']` because:
- No `amanaId` provided → `id_ownership` is NOT added
- No `minScore` provided → `credit_score_gte` is NOT added

This means the citizen's Amana Way wallet will ONLY generate these two circuits. The credit commitment and ID ownership proof are never computed, never transmitted, and never revealed — even though the citizen has them.

---

### Error Handling Summary
| Scenario | How to handle |
|----------|--------------|
| `POST /api/request` → 403 | Show blocked card, stop |
| `POST /api/request` → 400 | `console.error`, show generic error message |
| `GET /api/requests/:id` → 404 | Stop polling, show generic error |
| Network failure | Silently retry on next interval tick |
| Citizen never responds | Polling continues indefinitely; add a timeout if needed |

---

### Comparing ABC Loan vs Swift Loan endpoints

| | ABC Loan | Swift Loan |
|---|---|---|
| Request body | `rpId`, `rpName` only | `rpId`, `rpName`, `amanaId`, `minScore` |
| Claims generated | `['age_gte_18', 'citizenship_ng']` | `['age_gte_18', 'citizenship_ng', 'id_ownership', 'credit_score_gte']` |
| Circuits in wallet | 2 | 4 |
| Credit credential accessed | No | Yes |
| Proofs generated | 2 | 4 |
| Proof time (approx.) | ~1–2s | ~2–4s |

# Hazeon Hindi Translator — Team Guide

Translate English DOCX files to formal Hindi (UPSC/HCS-style) through Google Colab. Zero installation. Uses Gemini 2.5 Flash with subject-specific glossaries and Nirmala UI font.

---

## First-time setup (5 minutes, once per person)

### 1. Get your own Gemini API key

- Go to **https://aistudio.google.com/apikey**
- Sign in with your Google account (any @gmail.com works)
- Click **"Create API key"** → **"Create API key in new project"**
- Copy the key that appears (starts with `AIza...`)

> Each team member needs their own key. Don't share keys — usage counts against the key owner's quota (1500 free translations/day per key).

### 2. Open the Colab notebook

https://colab.research.google.com/github/HR-DHULL/hazeon-hindi-translator/blob/colab-v1/colab/hazeon_translator.ipynb

### 3. Save your private copy

- In Colab: click **File → Save a copy in Drive**
- Colab opens your own copy. Bookmark this URL — this is the one you use from now on.

### 4. Add your API key to Colab Secrets

- In the left sidebar, click the **🔑 key icon** (called "Secrets")
- Click **"+ Add new secret"**
- **Name**: `GEMINI_API_KEY` (exact spelling, case-sensitive)
- **Value**: paste your key from step 1
- Toggle **"Notebook access"** → ON
- Close the Secrets panel

> Colab Secrets are private to your Google account. When you share or copy this notebook, the secret does NOT travel with it. Each team member does this step once.

### 5. Verify it works

- Click **▶ Play** on Cell 1 (Setup) — takes ~3 minutes first time, then ~15 seconds from next time
- You should see: `✓ Ready — version colab-v1 @ <hash>`
- (Optional) Click ▶ on the **Health check** cell — it tests your API key with a one-sentence translation

You're set up. Bookmark your saved notebook and close this page.

---

## Daily usage

### Each translation takes 2–15 minutes depending on file size

1. Open your bookmarked notebook
2. **Cell 1 — Setup**: click ▶ (only once per day; subsequent runs same day are instant)
3. **Cell 2 — Translate**:
   - Pick **subject** from the dropdown (history / geography / economics / polity / science / environment / auto-detect)
   - Click ▶
   - Browse your computer → select the English DOCX
   - Wait — progress streams below the cell (you'll see `Batch 5/20 | 25% | ...`)
   - Browser auto-downloads the translated file when done
   - Backup copy also lands in your Google Drive at `MyDrive/hazeon_outputs/`

### Tips for best results

- **Keep the Colab tab open during your workday** — the Python runtime stays warm, so subsequent translations skip the 15-sec setup
- **Pick the right subject** — subject-specific glossaries are what make output 97–100% accurate. `auto-detect` works but is slightly less reliable for mixed content
- **Files should be under ~1000 paragraphs (roughly 30-40 pages)** for best reliability on free Colab
- **If any paragraphs come back untranslated**, just run Cell 2 again on the same file — each pass fixes more of the stragglers

---

## Troubleshooting

| Problem | What to do |
|---|---|
| Cell 1 fails with `GEMINI_API_KEY not found` | Go back to step 4 of setup — add the secret, toggle Notebook access ON, re-run Cell 1 |
| Cell 1 fails at `npm install` | Open Google Drive → find folder `hazeon_cache` → delete it → re-run Cell 1 |
| Cell 2 shows `429` / `rate-limit` | You hit Gemini's quota (15 requests/min, 1500/day free). Wait a minute and retry, or retry tomorrow |
| Download didn't start (Safari, corporate browser) | Open Google Drive → `MyDrive/hazeon_outputs/` → download from there |
| Output has English paragraphs left | Run Cell 2 again on the same file. 2-3 passes usually get you to 100% |
| Translation feels frozen | Scroll to the bottom of Cell 2 output — if you don't see `Batch N/M` progress, Gemini is unresponsive. Wait 2 min, then stop (⬛ button) and re-run |
| Something else broken | Message Harsh in the team chat with: the error text, your file name, and which cell |

---

## Important notes

- **Never paste your API key into a code cell.** Always use Secrets. Keys in code cells get saved in the notebook's output history and revision history, even after you "delete" them.
- **Don't share your saved copy.** Each team member should go through the setup once with their own Drive + Secret. That way nobody can see anyone else's translations or burn anyone else's quota.
- **Updates happen automatically.** I occasionally push improvements to the translator (better accuracy, bug fixes). You pick them up automatically next time you run Cell 1 — no action from you.

---

## What's the difference between this and the web service?

The web service at https://hazeon-hindi-translator.onrender.com is fine for small occasional files. For heavy daily use the web service is rate-limited and capped at 1000 paragraphs per file.

This Colab notebook uses the same translation engine but runs in your own Google session with your own API key — no shared server limits, no cold-start delays after the first cell.

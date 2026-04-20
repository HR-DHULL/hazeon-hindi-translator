# Hindi Translator Optimizer - Agent Program

> Autoresearch-style optimization for Hazeon Hindi Translator system prompt.
> Target file: `server/services/translator.js` (UPSC_BASE_PROMPT)

## Goal

Autonomously improve Hindi translation quality for UPSC/HCS exam materials by iteratively modifying the system prompt in `translator.js`.

Each experiment:
1. Makes ONE focused change to `UPSC_BASE_PROMPT` in translator.js
2. Translates 5 test scenarios (polity MCQ, economy MCQ, history passage, match-type, geography)
3. Evaluates quality across 7 metrics
4. Keeps if improved, discards if not
5. Logs result and continues

---

## The Loop

### Step 1: Choose ONE modification category

**A: Glossary Enforcement**
- Strengthen "GLOSSARY IS MANDATORY" instruction
- Add negative examples ("DO NOT use फिस्कल, use राजकोषीय")
- Add verification step ("Before outputting, check all glossary terms are used")

**B: Anti-Transliteration Rules**
- Add explicit list of common mistransliterations to avoid
- Add "TRANSLATE, don't transliterate" emphasis with examples
- Specify: "fiscal" = "राजकोषीय" NOT "फिस्कल"

**C: MCQ Format Precision**
- Strengthen label preservation rules ((a)(b)(c)(d))
- Add specific match-type handling (A-1, B-2 codes stay English)
- Add number/formula preservation examples

**D: Hindi Style Quality**
- Enforce Rajbhasha standards: कीजिए not करें, चुनिए not चुनें
- Add sentence structure guidance (SOV order)
- Add formality level examples

**E: Completeness Enforcement**
- Add "NEVER leave any English sentence untranslated" emphasis
- Add verification step at end of prompt
- Add penalty language for untranslated content

**F: Exam Tag Handling**
- Strengthen exam citation preservation instructions
- Add examples of tags to preserve: [UPPSC 2015], "BPSC 2022"
- Clarify standalone citation handling

### Step 2: Edit `UPSC_BASE_PROMPT` in translator.js

### Step 3: Run experiment
```bash
python optimizer/optimize.py --experiment "description" --scenario mcq_polity
```

### Step 4: Keep or discard based on result

---

## Metrics (7 dimensions, weighted)

| Metric | Weight | What it measures |
|--------|--------|-----------------|
| glossary_compliance | 0.25 | Uses correct UPSC terminology (from 600+ term glossary) |
| completeness | 0.20 | Everything translated, no English left |
| format_preservation | 0.15 | MCQ labels, numbers, abbreviations preserved |
| hindi_quality | 0.15 | Natural, formal UPSC Hindi (LLM-evaluated) |
| no_transliteration | 0.10 | Translated properly, not just written in Devanagari |
| exam_tag_preservation | 0.10 | Exam tags like [UPPSC 2015] kept as-is |
| latency_score | 0.05 | Speed |

## Running

```bash
# Baseline
python optimizer/optimize.py --baseline

# Experiment
python optimizer/optimize.py --experiment "Added anti-transliteration examples"

# Results
python optimizer/optimize.py --summary
```

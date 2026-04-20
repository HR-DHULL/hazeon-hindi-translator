"""
Hindi Translation Quality Evaluator.

Takes English paragraphs + Hindi translations and scores quality across 7 metrics.
This is the "val_bpb" equivalent for translation optimization.
"""

import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    METRIC_WEIGHTS, GEMINI_MODEL, GEMINI_TEMPERATURE,
    EVALUATOR_MODEL, EVALUATOR_TEMPERATURE,
    TEST_SCENARIOS, PROJECT_ROOT, TRANSLATOR_JS,
)

# Allowed English in Hindi output (abbreviations, labels, etc.)
ALLOWED_ENGLISH_RE = re.compile(
    r'^(UPSC|IAS|HCS|GDP|RBI|GST|SEBI|ISRO|PIL|CAG|DNA|RNA|pH|UV|AM|PM|'
    r'WTO|UNESCO|UNICEF|WHO|NDA|BJP|INC|CBI|ED|IMF|NGO|NITI|'
    r'MCQ|DOCX|PDF|ATM|EMI|SLR|CRR|FDI|NOTA|UNESCO|FAQ|'
    r'A|B|C|D|I|II|III|IV|V|VI|VII|VIII|IX|X|'
    r'List-I|List-II|Article|Section)$', re.IGNORECASE
)


# ---------------------------------------------------------------------------
# Individual Metrics
# ---------------------------------------------------------------------------

def score_glossary_compliance(translations: list, scenario: dict) -> float:
    """Check if expected UPSC terminology was used correctly.

    Uses flexible matching: checks if key Hindi words from expected terms
    appear in the translation, not exact string match (Gemini may use
    slightly different but equally correct UPSC phrasing).
    """
    expected = scenario.get("expected_terms", {})
    if not expected:
        return 1.0

    full_text = " ".join(t for t in translations if t)
    matches = 0
    total = len(expected)

    for eng_term, hindi_term in expected.items():
        # Exact match first
        if hindi_term in full_text:
            matches += 1
            continue

        # Flexible match: check if key Hindi words (3+ chars) from the
        # expected term appear in the output. This handles cases like
        # "अस्पृश्यता का उन्मूलन" vs "अस्पृश्यता का अंत" (both correct).
        hindi_words = [w for w in hindi_term.split() if len(w) >= 3]
        if hindi_words:
            found = sum(1 for w in hindi_words if w in full_text)
            ratio = found / len(hindi_words)
            if ratio >= 0.5:
                matches += 0.75  # partial credit for flexible match
            elif ratio > 0:
                matches += 0.25

    return min(1.0, matches / total) if total > 0 else 1.0


def score_completeness(originals: list, translations: list) -> float:
    """Check that all English content is translated - nothing left in English."""
    if not translations:
        return 0.0

    scores = []
    for orig, trans in zip(originals, translations):
        if not orig or not orig.strip():
            scores.append(1.0)
            continue
        if not trans or not trans.strip():
            scores.append(0.0)
            continue

        # Skip scoring for lines that SHOULD stay in English:
        # - Code options: (a) A-2, B-1, C-3, D-4
        # - Pure number/code lines
        # - Exam citations: [UPPSC 2015], BPSC 2022
        orig_stripped = orig.strip()
        if re.match(r'^\([a-d]\)\s+[A-D]-\d', orig_stripped):
            scores.append(1.0)  # code lines correctly kept as-is
            continue
        if re.match(r'^[\d\s\(\)\.\-\+\*\/=,;:A-Da-d]+$', orig_stripped):
            scores.append(1.0)  # pure numbers/codes
            continue
        if re.match(r'^\[?[A-Z].*\d{4}\]?$', orig_stripped) and len(orig_stripped) < 60:
            scores.append(1.0)  # exam citation line - should be preserved as-is
            continue

        # Count English words in translation (excluding allowed ones)
        eng_words = re.findall(r'\b[A-Za-z]{3,}\b', trans)
        unexpected_english = [w for w in eng_words if not ALLOWED_ENGLISH_RE.match(w)]

        # Check for Devanagari content
        devanagari_chars = len(re.findall(r'[\u0900-\u097F]', trans))
        total_alpha = len(re.findall(r'[A-Za-z\u0900-\u097F]', trans))

        if total_alpha == 0:
            scores.append(0.5)
            continue

        hindi_ratio = devanagari_chars / total_alpha
        eng_penalty = min(len(unexpected_english) * 0.1, 0.5)

        score = max(0.0, hindi_ratio - eng_penalty)
        scores.append(score)

    return sum(scores) / len(scores) if scores else 0.0


def score_format_preservation(originals: list, translations: list) -> float:
    """Check that MCQ labels, numbers, abbreviations are preserved correctly."""
    if not translations:
        return 0.0

    scores = []
    for orig, trans in zip(originals, translations):
        if not orig or not trans:
            scores.append(1.0 if not orig else 0.0)
            continue

        score = 1.0
        checks = 0

        # MCQ labels (a)(b)(c)(d) should be preserved
        orig_labels = re.findall(r'\([a-d]\)', orig)
        if orig_labels:
            checks += 1
            trans_labels = re.findall(r'\([a-d]\)', trans)
            if set(orig_labels) == set(trans_labels):
                score += 1.0

        # Numbers should be preserved
        orig_numbers = re.findall(r'\b\d+\b', orig)
        if orig_numbers:
            checks += 1
            trans_numbers = re.findall(r'\b\d+\b', trans)
            preserved = sum(1 for n in orig_numbers if n in trans_numbers)
            score += preserved / len(orig_numbers)

        # Abbreviations (RBI, UPSC, GDP etc.) should be kept as-is
        orig_abbr = re.findall(r'\b[A-Z]{2,}\b', orig)
        if orig_abbr:
            checks += 1
            preserved = sum(1 for a in orig_abbr if a in trans)
            score += preserved / len(orig_abbr)

        # Single letter variables (A, B, C, D in match type)
        if re.search(r'\b[A-D]-\d\b', orig):
            checks += 1
            codes = re.findall(r'[A-D]-\d', orig)
            preserved = sum(1 for c in codes if c in trans)
            score += preserved / len(codes) if codes else 1.0

        total = checks + 1  # +1 for base score
        scores.append(score / total)

    return sum(scores) / len(scores) if scores else 0.0


def score_hindi_quality_llm(originals: list, translations: list) -> float:
    """Use Gemini to evaluate overall Hindi quality on UPSC standard."""
    try:
        from google import genai
        from google.genai import types

        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return _score_hindi_quality_heuristic(translations)

        client = genai.Client(api_key=api_key)

        # Sample 3-5 paragraphs
        import random
        pairs = [(o, t) for o, t in zip(originals, translations) if o and t and len(o) > 20]
        sample = random.sample(pairs, min(4, len(pairs))) if pairs else []

        if not sample:
            return _score_hindi_quality_heuristic(translations)

        eval_prompt = """Rate the Hindi translation quality for UPSC exam material on a 1-5 scale.

Good UPSC Hindi translation:
- Uses formal Rajbhasha (official Hindi), not colloquial
- Uses "कीजिए" not "करें", "चुनिए" not "चुनें", "उपर्युक्त" not "उपरोक्त"
- Translates concepts properly (not transliteration): "fiscal" = "राजकोषीय", not "फिस्कल"
- Preserves MCQ structure: (a)(b)(c)(d) labels stay in English
- Keeps abbreviations: UPSC, RBI, GDP stay as-is
- Natural Hindi sentence structure (SOV order, proper postpositions)

TRANSLATIONS TO EVALUATE:
"""
        for i, (orig, trans) in enumerate(sample, 1):
            eval_prompt += f"\n--- Pair {i} ---\nEnglish: {orig[:200]}\nHindi: {trans[:200]}\n"

        eval_prompt += '\nRESPOND WITH ONLY THIS JSON:\n{"scores": [4, 3, 5, 4], "average": 4.0}\n'

        response = client.models.generate_content(
            model=EVALUATOR_MODEL,
            contents=eval_prompt,
            config=types.GenerateContentConfig(
                temperature=EVALUATOR_TEMPERATURE,
                max_output_tokens=512,
                response_mime_type="application/json",
            ),
        )
        raw_text = response.text.strip()
        # Try direct JSON parse
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            # Fallback: extract average number from text
            avg_match = re.search(r'"average"\s*:\s*([\d.]+)', raw_text)
            if avg_match:
                data = {"average": float(avg_match.group(1))}
            else:
                # Last resort: find any decimal number
                nums = re.findall(r'\b[1-5]\.?\d*\b', raw_text)
                data = {"average": float(nums[-1]) if nums else 3.0}
        avg = data.get("average", 3.0)
        return max(0.0, min(1.0, (avg - 1.0) / 4.0))

    except Exception as e:
        print(f"[Evaluator] LLM Hindi quality eval failed: {e}, using heuristic")
        return _score_hindi_quality_heuristic(translations)


def _score_hindi_quality_heuristic(translations: list) -> float:
    """Heuristic fallback for Hindi quality."""
    if not translations:
        return 0.0

    scores = []
    # Bad patterns: transliteration instead of translation
    bad_patterns = [
        r'फिस्कल', r'ज्यूडिशियरी', r'ट्रिब्यूनल', r'गवर्नमेंट',
        r'कांस्टीट्यूशन', r'पार्लियामेंट', r'डेमोक्रेसी',
    ]
    # Good patterns: proper UPSC Hindi
    good_patterns = [
        r'कीजिए', r'चुनिए', r'उपर्युक्त', r'कथन', r'विचार',
        r'निम्नलिखित', r'संविधान', r'न्यायपालिका', r'अधिनियम',
    ]

    for t in translations:
        if not t:
            continue
        score = 0.5  # baseline

        # Penalize transliterations
        for bp in bad_patterns:
            if re.search(bp, t):
                score -= 0.1

        # Reward proper UPSC Hindi
        for gp in good_patterns:
            if re.search(gp, t):
                score += 0.05

        scores.append(max(0.0, min(1.0, score)))

    return sum(scores) / len(scores) if scores else 0.5


def score_no_transliteration(translations: list) -> float:
    """Check that English words are translated, not just written in Devanagari."""
    if not translations:
        return 0.0

    # Common transliteration patterns (English words in Devanagari)
    transliterations = [
        r'फिस्कल', r'ज्यूडिशियरी', r'ट्रिब्यूनल', r'ऑर्डिनेंस',
        r'गवर्नमेंट', r'कांस्टीट्यूशन', r'पार्लियामेंट',
        r'डेमोक्रेसी', r'सोवेरेनिटी', r'फेडरल', r'सेक्युलर',
        r'एग्जीक्यूटिव', r'लेजिस्लेचर', r'बजट', r'इकोनॉमी',
        r'पॉलिसी', r'कमिटी', r'कमीशन', r'रिपोर्ट',
    ]

    full_text = " ".join(t for t in translations if t)
    if not full_text:
        return 1.0

    violations = sum(1 for t in transliterations if re.search(t, full_text))
    # Score decreases with each transliteration found
    return max(0.0, 1.0 - (violations * 0.1))


def score_exam_tag_preservation(originals: list, translations: list) -> float:
    """Check that exam tags like [UPPSC 2015] are preserved."""
    exam_tag_re = re.compile(r'\[([A-Z][^\]]{1,60}(?:19|20)\d{2}[^\]]*)\]')
    standalone_re = re.compile(r'^\s*(UPSC|UPPSC|HCS|SSC|BPSC|PCS).*\d{4}\s*$', re.IGNORECASE)

    total_tags = 0
    preserved_tags = 0

    for orig, trans in zip(originals, translations):
        if not orig:
            continue

        # Check inline exam tags
        orig_tags = exam_tag_re.findall(orig)
        for tag in orig_tags:
            total_tags += 1
            if tag in (trans or ''):
                preserved_tags += 1

        # Check standalone exam citations
        if standalone_re.match(orig.strip()):
            total_tags += 1
            # Should be kept as-is (not translated)
            if trans and orig.strip() in trans:
                preserved_tags += 1

    return preserved_tags / total_tags if total_tags > 0 else 1.0


def score_latency(elapsed_seconds: float, paragraph_count: int) -> float:
    """Score translation speed."""
    if paragraph_count == 0:
        return 1.0
    per_para = elapsed_seconds / paragraph_count
    if per_para <= 1.0:
        return 1.0
    if per_para >= 10.0:
        return 0.0
    return max(0.0, 1.0 - (per_para - 1.0) / 9.0)


# ---------------------------------------------------------------------------
# Translation Runner (calls Gemini directly with the system prompt)
# ---------------------------------------------------------------------------

def translate_with_gemini(paragraphs: list, system_prompt: str) -> tuple:
    """Translate paragraphs using Gemini with the given system prompt.

    Returns (translations, elapsed_seconds).
    """
    from google import genai
    from google.genai import types

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)

    # Number paragraphs like translator.js does
    numbered = "\n\n".join(f"<<<P{i+1}>>> {p}" for i, p in enumerate(paragraphs))

    user_msg = (
        f"Translate each paragraph below from English to Hindi for UPSC/HCS exam material. "
        f"Each paragraph starts with <<<PN>>>. Preserve that exact prefix in your output.\n\n"
        f"CRITICAL: Translate EVERY English word/sentence into Hindi. Do NOT leave ANY complete "
        f"English sentence untranslated. The only allowed English in output: acronyms, MCQ labels "
        f"(a)(b)(c)(d), single-letter variables, numbers, and math formulas.\n\n{numbered}"
    )

    start = time.time()
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_msg,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=GEMINI_TEMPERATURE,
                max_output_tokens=8192,
            ),
        )
        raw = response.text
    except Exception as e:
        # 503 fallback - retry once
        print(f"[Translator] First attempt failed: {e}, retrying...")
        time.sleep(3)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_msg,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=GEMINI_TEMPERATURE,
                max_output_tokens=8192,
            ),
        )
        raw = response.text

    elapsed = time.time() - start

    # Parse output - split on <<<P1>>>, <<<P2>>> markers
    import re
    parts = re.split(r'\n*<<<P?(\d+)>>>\s*', raw)
    parsed = [''] * len(paragraphs)
    for i in range(1, len(parts) - 1, 2):
        idx = int(parts[i]) - 1
        if 0 <= idx < len(paragraphs):
            parsed[idx] = parts[i + 1].strip()

    return parsed, elapsed


# ---------------------------------------------------------------------------
# Composite Evaluator
# ---------------------------------------------------------------------------

def evaluate_translation(
    originals: list,
    translations: list,
    scenario: dict,
    elapsed_seconds: float = 0.0,
    use_llm_eval: bool = True,
) -> dict:
    """Run all quality metrics and compute composite score."""
    metrics = {}

    metrics["glossary_compliance"] = score_glossary_compliance(translations, scenario)
    metrics["completeness"] = score_completeness(originals, translations)
    metrics["format_preservation"] = score_format_preservation(originals, translations)

    if use_llm_eval:
        metrics["hindi_quality"] = score_hindi_quality_llm(originals, translations)
    else:
        metrics["hindi_quality"] = _score_hindi_quality_heuristic(translations)

    metrics["no_transliteration"] = score_no_transliteration(translations)
    metrics["exam_tag_preservation"] = score_exam_tag_preservation(originals, translations)
    metrics["latency_score"] = score_latency(elapsed_seconds, len(originals))

    composite = sum(
        metrics.get(m, 0.0) * w
        for m, w in METRIC_WEIGHTS.items()
    )
    metrics["composite_score"] = round(composite, 4)

    return metrics


def run_eval(scenario: dict = None, system_prompt: str = None) -> dict:
    """Run a full evaluation: translate + score."""
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")

    if scenario is None:
        scenario = TEST_SCENARIOS[0]

    if system_prompt is None:
        system_prompt = get_current_system_prompt()

    paragraphs = scenario["paragraphs"]

    print(f"[Eval] Scenario: {scenario['name']} - {scenario['description']}")
    print(f"[Eval] Paragraphs: {len(paragraphs)}")

    try:
        translations, elapsed = translate_with_gemini(paragraphs, system_prompt)
    except Exception as e:
        print(f"[Eval] Translation failed: {e}")
        return {
            "scenario": scenario["name"],
            "metrics": {"composite_score": 0.0},
            "translations": [],
            "elapsed_seconds": 0.0,
        }

    metrics = evaluate_translation(
        originals=paragraphs,
        translations=translations,
        scenario=scenario,
        elapsed_seconds=elapsed,
    )

    print(f"\n[Eval] Results for '{scenario['name']}':")
    print(f"  Time: {elapsed:.1f}s")
    for m, v in metrics.items():
        w = METRIC_WEIGHTS.get(m, 0)
        print(f"  {m}: {v:.3f} (weight: {w})")
    print(f"  COMPOSITE: {metrics['composite_score']:.4f}")

    return {
        "scenario": scenario["name"],
        "metrics": metrics,
        "translations": translations,
        "elapsed_seconds": elapsed,
    }


def get_current_system_prompt() -> str:
    """Extract the current UPSC_BASE_PROMPT from translator.js + inject key glossary terms."""
    content = TRANSLATOR_JS.read_text(encoding="utf-8")

    # Find UPSC_BASE_PROMPT
    start = content.find("const UPSC_BASE_PROMPT = `")
    if start == -1:
        raise ValueError("Could not find UPSC_BASE_PROMPT in translator.js")

    start += len("const UPSC_BASE_PROMPT = `")
    end = content.find("`;", start)
    if end == -1:
        raise ValueError("Could not find end of UPSC_BASE_PROMPT")

    base_prompt = content[start:end]

    # Extract key glossary terms from glossary.js for injection
    glossary_path = TRANSLATOR_JS.parent / "glossary.js"
    glossary_terms = _extract_glossary_terms(glossary_path)

    if glossary_terms:
        glossary_section = "\n\nMANDATORY GLOSSARY (use these EXACT translations):\n"
        for eng, hindi in glossary_terms.items():
            glossary_section += f"- \"{eng}\" = \"{hindi}\"\n"
        return base_prompt + glossary_section

    return base_prompt


def _extract_glossary_terms(glossary_path: Path) -> dict:
    """Extract glossary terms from glossary.js."""
    if not glossary_path.exists():
        return {}

    import re
    content = glossary_path.read_text(encoding="utf-8")

    # Match patterns like: 'English Term': 'Hindi Term',
    terms = {}
    for match in re.finditer(r"'([^']+)'\s*:\s*'([^']+)'", content):
        eng, hindi = match.group(1), match.group(2)
        if len(eng) > 2 and len(hindi) > 1:
            terms[eng] = hindi

    return terms


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")

    prompt = get_current_system_prompt()
    print(f"Current system prompt ({len(prompt)} chars):\n{prompt[:200]}...\n")

    for scenario in TEST_SCENARIOS[:2]:
        result = run_eval(scenario, prompt)
        print()

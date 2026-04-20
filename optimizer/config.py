"""
Hindi Translator Optimizer Configuration
Autoresearch-style autonomous optimization for Hazeon Hindi Translator.

Optimizes: System prompt in translator.js (UPSC_BASE_PROMPT)
Metric: Translation quality score (0-1) across multiple dimensions
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).parent.parent  # hindi-translator/
OPTIMIZER_DIR = Path(__file__).parent
RESULTS_DIR = OPTIMIZER_DIR / "results"
RESULTS_TSV = RESULTS_DIR / "results.tsv"
TEST_SAMPLES_DIR = OPTIMIZER_DIR / "test_samples"
TRANSLATOR_JS = PROJECT_ROOT / "server" / "services" / "translator.js"
GLOSSARY_JS = PROJECT_ROOT / "server" / "services" / "glossary.js"

# ---------------------------------------------------------------------------
# Test Scenarios - Fixed English paragraphs with known correct Hindi translations
# Each scenario tests a different translation challenge.
# ---------------------------------------------------------------------------
TEST_SCENARIOS = [
    {
        "name": "mcq_polity",
        "description": "UPSC Polity MCQ with statement-based format",
        "paragraphs": [
            "Consider the following statements about the Rajya Sabha:",
            "1. A Money Bill cannot be introduced in the Rajya Sabha.",
            "2. The Rajya Sabha has no power to vote on the Demand for Grants.",
            "3. A Constitutional Amendment Bill must be passed by each House by a special majority.",
            "Which of the statements given above are correct?",
            "(a) 1 and 2 only",
            "(b) 2 and 3 only",
            "(c) 1 and 3 only",
            "(d) 1, 2 and 3",
        ],
        "expected_terms": {
            "Rajya Sabha": "राज्य सभा",
            "Money Bill": "धन विधेयक",
            "Constitutional Amendment": "संविधान संशोधन",
            "Demand for Grants": "अनुदान मांगें",
        },
        "subject": "polity",
    },
    {
        "name": "mcq_economy",
        "description": "Economy MCQ with RBI/banking terminology",
        "paragraphs": [
            "With reference to the Reserve Bank of India, consider the following statements:",
            "1. The RBI was established under the Reserve Bank of India Act, 1934.",
            "2. The RBI acts as the banker to the Government of India.",
            "3. The Monetary Policy Committee decides the repo rate.",
            "Which of the above statements is/are correct?",
            "(a) 1 only",
            "(b) 1 and 2 only",
            "(c) 2 and 3 only",
            "(d) 1, 2 and 3",
        ],
        "expected_terms": {
            "Reserve Bank of India": "भारतीय रिज़र्व बैंक",
            "Monetary Policy Committee": "मौद्रिक नीति समिति",
            "repo rate": "रेपो दर",
        },
        "subject": "economics",
    },
    {
        "name": "passage_history",
        "description": "History passage with proper nouns and dates",
        "paragraphs": [
            "The Indian National Congress was founded in 1885 by A.O. Hume, a retired British civil servant.",
            "The first session was held in Bombay under the presidency of W.C. Bonnerjee.",
            "In the initial decades, the Congress was dominated by moderates like Gopal Krishna Gokhale and Dadabhai Naoroji.",
            "The extremist faction, led by Bal Gangadhar Tilak, demanded Swaraj or self-rule.",
            "[UPPSC 2015]",
        ],
        "expected_terms": {
            "Indian National Congress": "भारतीय राष्ट्रीय कांग्रेस",
            "Swaraj": "स्वराज",
        },
        "subject": "history",
    },
    {
        "name": "match_type",
        "description": "Match-the-following with List-I/List-II format",
        "paragraphs": [
            "Match List-I with List-II and select the correct answer using the codes given below:",
            "List-I (Article)",
            "A. Article 17",
            "B. Article 18",
            "C. Article 19",
            "D. Article 21",
            "List-II (Provision)",
            "1. Abolition of titles",
            "2. Abolition of untouchability",
            "3. Freedom of speech and expression",
            "4. Protection of life and personal liberty",
            "Codes:",
            "(a) A-2, B-1, C-3, D-4",
            "(b) A-1, B-2, C-3, D-4",
            "(c) A-2, B-1, C-4, D-3",
            "(d) A-1, B-2, C-4, D-3",
        ],
        "expected_terms": {
            "Abolition of untouchability": "अस्पृश्यता का उन्मूलन",
            "Freedom of speech": "वाक् स्वातंत्र्य",
        },
        "subject": "polity",
    },
    {
        "name": "geography_environment",
        "description": "Geography/Environment passage with technical terms",
        "paragraphs": [
            "The Western Ghats, also known as Sahyadri, are a UNESCO World Heritage Site.",
            "They are one of the eight hottest hotspots of biological diversity in the world.",
            "The region receives heavy rainfall on the windward side during the southwest monsoon.",
            "Important national parks in the Western Ghats include Silent Valley, Periyar, and Bandipur.",
            "The Gadgil Committee and Kasturirangan Committee have recommended different levels of protection for the ecologically sensitive areas.",
        ],
        "expected_terms": {
            "Western Ghats": "पश्चिमी घाट",
            "biological diversity": "जैव विविधता",
            "southwest monsoon": "दक्षिण-पश्चिम मानसून",
            "ecologically sensitive areas": "पारिस्थितिकी संवेदनशील क्षेत्र",
        },
        "subject": "environment",
    },
]

# ---------------------------------------------------------------------------
# Quality Metric Weights (sum to 1.0)
# ---------------------------------------------------------------------------
METRIC_WEIGHTS = {
    "glossary_compliance":   0.25,   # Did it use the correct UPSC terminology?
    "completeness":          0.20,   # Is everything translated? No English left behind?
    "format_preservation":   0.15,   # Are MCQ labels, numbers, abbreviations preserved?
    "hindi_quality":         0.15,   # Is the Hindi natural, formal, UPSC-standard?
    "no_transliteration":    0.10,   # Did it translate (not transliterate)?
    "exam_tag_preservation": 0.10,   # Are exam tags like [UPPSC 2015] preserved?
    "latency_score":         0.05,   # Speed of translation
}

# ---------------------------------------------------------------------------
# Evaluation Thresholds
# ---------------------------------------------------------------------------
MINIMUM_QUALITY_SCORE = 0.50
IMPROVEMENT_THRESHOLD = 0.005

# ---------------------------------------------------------------------------
# API Config
# ---------------------------------------------------------------------------
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_TEMPERATURE = 0.1  # Same as translator.js
EVALUATOR_MODEL = "gemini-2.5-flash"
EVALUATOR_TEMPERATURE = 0.2

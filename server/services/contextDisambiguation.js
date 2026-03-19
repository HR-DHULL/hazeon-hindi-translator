/**
 * Context-Aware Disambiguation Module for Hazeon Hindi Translator
 *
 * Solves the "Mercury = बुध vs पारा" problem by analyzing surrounding
 * text context to determine the correct Hindi translation.
 *
 * Generated from UPSC/NCERT corpus analysis.
 * DO NOT EDIT MANUALLY — regenerate using generate_translator_integration.py
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AMBIGUOUS TERMS DATABASE
// Each term maps to multiple meanings with context signals
// ═══════════════════════════════════════════════════════════════════════════════

export const AMBIGUOUS_TERMS = {
  "Mercury": [
    {
      "hindi": "बुध",
      "domain": "astronomy/geography",
      "description": "Planet Mercury - closest to the Sun",
      "signals": [
        "planet",
        "solar system",
        "orbit",
        "Sun",
        "Venus",
        "Mars",
        "astronomical",
        "space",
        "ISRO",
        "NASA",
        "satellite",
        "ग्रह",
        "सूर्य",
        "सौरमंडल",
        "कक्षा",
        "शुक्र",
        "मंगल",
        "inner planet",
        "terrestrial",
        "revolve",
        "rotation"
      ]
    },
    {
      "hindi": "पारा",
      "domain": "chemistry/science",
      "description": "Mercury - chemical element (Hg), liquid metal",
      "signals": [
        "element",
        "metal",
        "liquid",
        "thermometer",
        "Hg",
        "periodic table",
        "atomic",
        "chemical",
        "barometer",
        "amalgam",
        "toxic",
        "poisoning",
        "pollution",
        "तत्व",
        "धातु",
        "तरल",
        "तापमापी",
        "रासायनिक",
        "आवर्त सारणी",
        "परमाणु",
        "विषाक्त"
      ]
    },
    {
      "hindi": "मर्करी",
      "domain": "mythology/history",
      "description": "Mercury - Roman god of commerce/messages",
      "signals": [
        "Roman",
        "god",
        "deity",
        "mythology",
        "Greek",
        "Hermes",
        "messenger",
        "commerce",
        "रोमन",
        "देवता",
        "पौराणिक"
      ]
    }
  ],
  "Mars": [
    {
      "hindi": "मंगल",
      "domain": "astronomy/geography",
      "description": "Planet Mars - the Red Planet",
      "signals": [
        "planet",
        "red planet",
        "solar system",
        "orbit",
        "rover",
        "Mangalyaan",
        "NASA",
        "space",
        "crater",
        "atmosphere",
        "ग्रह",
        "लाल ग्रह",
        "सौरमंडल",
        "मंगलयान",
        "अंतरिक्ष"
      ]
    },
    {
      "hindi": "मार्स",
      "domain": "mythology/history",
      "description": "Mars - Roman god of war",
      "signals": [
        "Roman",
        "god",
        "war",
        "deity",
        "mythology",
        "Greek",
        "Ares",
        "रोमन",
        "देवता",
        "युद्ध"
      ]
    }
  ],
  "Venus": [
    {
      "hindi": "शुक्र",
      "domain": "astronomy/geography",
      "description": "Planet Venus - brightest planet visible from Earth",
      "signals": [
        "planet",
        "solar system",
        "orbit",
        "atmosphere",
        "morning star",
        "evening star",
        "brightest",
        "Earth",
        "rotation",
        "ग्रह",
        "सौरमंडल",
        "भोर का तारा",
        "सांध्य तारा"
      ]
    },
    {
      "hindi": "वीनस",
      "domain": "mythology/history",
      "description": "Venus - Roman goddess of love",
      "signals": [
        "goddess",
        "Roman",
        "love",
        "beauty",
        "mythology",
        "Greek",
        "Aphrodite",
        "देवी",
        "रोमन",
        "प्रेम",
        "सौंदर्य"
      ]
    }
  ],
  "Plant": [
    {
      "hindi": "पौधा",
      "domain": "biology/botany",
      "description": "Plant - living organism (botanical)",
      "signals": [
        "grow",
        "seed",
        "root",
        "leaf",
        "flower",
        "photosynthesis",
        "species",
        "tree",
        "forest",
        "vegetation",
        "botanical",
        "बीज",
        "जड़",
        "पत्ती",
        "फूल",
        "प्रकाश संश्लेषण",
        "वन"
      ]
    },
    {
      "hindi": "संयंत्र",
      "domain": "industry/economics",
      "description": "Plant - industrial facility/factory",
      "signals": [
        "steel",
        "power",
        "factory",
        "manufacturing",
        "industrial",
        "production",
        "capacity",
        "megawatt",
        "MW",
        "thermal",
        "nuclear",
        "refinery",
        "cement",
        "इस्पात",
        "विद्युत",
        "कारखाना",
        "उत्पादन",
        "क्षमता"
      ]
    }
  ],
  "Act": [
    {
      "hindi": "अधिनियम",
      "domain": "law/polity",
      "description": "Act - legislation/law passed by Parliament",
      "signals": [
        "Parliament",
        "legislation",
        "enacted",
        "section",
        "provision",
        "amendment",
        "bill",
        "law",
        "statute",
        "passed",
        "repealed",
        "constitutional",
        "1947",
        "1950",
        "2019",
        "संसद",
        "विधेयक",
        "धारा",
        "प्रावधान",
        "संशोधन",
        "कानून"
      ]
    },
    {
      "hindi": "कार्य",
      "domain": "general",
      "description": "Act - action/deed/performance",
      "signals": [
        "perform",
        "action",
        "behavior",
        "deed",
        "activity",
        "drama",
        "play",
        "theatre",
        "scene",
        "कार्य",
        "व्यवहार",
        "नाटक"
      ]
    }
  ],
  "Motion": [
    {
      "hindi": "प्रस्ताव",
      "domain": "polity/parliament",
      "description": "Motion - parliamentary proposal/resolution",
      "signals": [
        "Parliament",
        "Lok Sabha",
        "Rajya Sabha",
        "no-confidence",
        "adjournment",
        "cut",
        "censure",
        "privilege",
        "vote",
        "debate",
        "passed",
        "rejected",
        "Speaker",
        "संसद",
        "लोकसभा",
        "अविश्वास",
        "स्थगन",
        "कटौती"
      ]
    },
    {
      "hindi": "गति",
      "domain": "physics/science",
      "description": "Motion - physical movement",
      "signals": [
        "Newton",
        "velocity",
        "acceleration",
        "force",
        "mass",
        "speed",
        "distance",
        "time",
        "kinetic",
        "momentum",
        "linear",
        "circular",
        "oscillatory",
        "rotational",
        "वेग",
        "त्वरण",
        "बल",
        "द्रव्यमान",
        "गतिज"
      ]
    }
  ],
  "House": [
    {
      "hindi": "सदन",
      "domain": "polity/parliament",
      "description": "House - parliamentary chamber (Lok Sabha/Rajya Sabha)",
      "signals": [
        "Parliament",
        "Lok Sabha",
        "Rajya Sabha",
        "Speaker",
        "Upper House",
        "Lower House",
        "session",
        "bill",
        "member",
        "debate",
        "proceedings",
        "adjourned",
        "संसद",
        "लोकसभा",
        "राज्यसभा",
        "अध्यक्ष",
        "सत्र"
      ]
    },
    {
      "hindi": "घर",
      "domain": "general",
      "description": "House - residential building",
      "signals": [
        "building",
        "home",
        "room",
        "family",
        "door",
        "wall",
        "roof",
        "construction",
        "housing",
        "residential",
        "भवन",
        "कमरा",
        "परिवार",
        "निर्माण",
        "आवास"
      ]
    }
  ],
  "Cabinet": [
    {
      "hindi": "मंत्रिमंडल",
      "domain": "polity/governance",
      "description": "Cabinet - council of ministers in government",
      "signals": [
        "minister",
        "Prime Minister",
        "government",
        "Council",
        "portfolio",
        "ministry",
        "decision",
        "meeting",
        "reshuffle",
        "approval",
        "committee",
        "मंत्री",
        "प्रधानमंत्री",
        "सरकार",
        "मंत्रालय"
      ]
    },
    {
      "hindi": "अलमारी",
      "domain": "general/furniture",
      "description": "Cabinet - piece of furniture",
      "signals": [
        "furniture",
        "wooden",
        "storage",
        "drawer",
        "shelf",
        "kitchen",
        "display",
        "glass",
        "फर्नीचर",
        "लकड़ी",
        "दराज",
        "रसोई"
      ]
    }
  ],
  "Speaker": [
    {
      "hindi": "अध्यक्ष",
      "domain": "polity/parliament",
      "description": "Speaker - presiding officer of Lok Sabha/Legislative Assembly",
      "signals": [
        "Lok Sabha",
        "Parliament",
        "Assembly",
        "presiding",
        "elected",
        "casting vote",
        "pro-tem",
        "Deputy Speaker",
        "order",
        "proceedings",
        "session",
        "quorum",
        "लोकसभा",
        "विधानसभा",
        "सभापति",
        "निर्णायक मत"
      ]
    },
    {
      "hindi": "वक्ता",
      "domain": "general",
      "description": "Speaker - person who speaks/orator",
      "signals": [
        "speech",
        "talk",
        "audience",
        "lecture",
        "address",
        "orator",
        "eloquent",
        "keynote",
        "presentation",
        "भाषण",
        "श्रोता",
        "व्याख्यान",
        "संबोधन"
      ]
    },
    {
      "hindi": "स्पीकर",
      "domain": "technology",
      "description": "Speaker - audio device",
      "signals": [
        "sound",
        "audio",
        "volume",
        "music",
        "bluetooth",
        "amplifier",
        "watt",
        "wireless",
        "stereo",
        "ध्वनि",
        "आवाज़",
        "संगीत"
      ]
    }
  ],
  "Bill": [
    {
      "hindi": "विधेयक",
      "domain": "polity/parliament",
      "description": "Bill - proposed legislation before Parliament",
      "signals": [
        "Parliament",
        "introduced",
        "passed",
        "assent",
        "legislation",
        "money bill",
        "finance bill",
        "ordinary bill",
        "committee",
        "reading",
        "enacted",
        "amendment",
        "clause",
        "संसद",
        "पारित",
        "अनुमति",
        "धन विधेयक"
      ]
    },
    {
      "hindi": "बिल",
      "domain": "economics/commerce",
      "description": "Bill - invoice/receipt",
      "signals": [
        "payment",
        "invoice",
        "receipt",
        "charge",
        "amount",
        "customer",
        "purchase",
        "electricity",
        "phone",
        "भुगतान",
        "रसीद",
        "राशि",
        "बिजली"
      ]
    }
  ],
  "Division": [
    {
      "hindi": "विभाजन",
      "domain": "polity/parliament",
      "description": "Division - formal vote counting method in Parliament",
      "signals": [
        "vote",
        "Parliament",
        "Lok Sabha",
        "lobby",
        "ayes",
        "noes",
        "Speaker",
        "division bell",
        "quorum",
        "मतदान",
        "संसद",
        "पक्ष",
        "विपक्ष"
      ]
    },
    {
      "hindi": "भाग",
      "domain": "mathematics",
      "description": "Division - mathematical operation",
      "signals": [
        "multiply",
        "divide",
        "quotient",
        "remainder",
        "number",
        "fraction",
        "arithmetic",
        "calculation",
        "गुणा",
        "भाग",
        "शेषफल",
        "भिन्न",
        "अंकगणित"
      ]
    },
    {
      "hindi": "प्रभाग",
      "domain": "administration",
      "description": "Division - administrative unit/department",
      "signals": [
        "district",
        "administrative",
        "department",
        "officer",
        "jurisdiction",
        "sub-division",
        "commissioner",
        "जिला",
        "प्रशासनिक",
        "विभाग",
        "अधिकारी"
      ]
    }
  ],
  "Charge": [
    {
      "hindi": "प्रभार",
      "domain": "administration",
      "description": "Charge - administrative responsibility/designation",
      "signals": [
        "officer",
        "additional charge",
        "in-charge",
        "duty",
        "responsibility",
        "appointment",
        "designation",
        "post",
        "अधिकारी",
        "अतिरिक्त प्रभार",
        "कर्तव्य",
        "नियुक्ति"
      ]
    },
    {
      "hindi": "शुल्क",
      "domain": "economics/finance",
      "description": "Charge - fee/price/cost",
      "signals": [
        "fee",
        "cost",
        "price",
        "payment",
        "service charge",
        "bank charge",
        "penalty",
        "surcharge",
        "शुल्क",
        "मूल्य",
        "भुगतान",
        "अधिभार"
      ]
    },
    {
      "hindi": "आवेश",
      "domain": "physics",
      "description": "Charge - electric charge",
      "signals": [
        "electric",
        "positive",
        "negative",
        "electron",
        "proton",
        "coulomb",
        "current",
        "potential",
        "field",
        "विद्युत",
        "धनात्मक",
        "ऋणात्मक",
        "इलेक्ट्रॉन"
      ]
    }
  ],
  "Cell": [
    {
      "hindi": "कोशिका",
      "domain": "biology",
      "description": "Cell - biological cell (unit of life)",
      "signals": [
        "organism",
        "nucleus",
        "membrane",
        "mitochondria",
        "DNA",
        "tissue",
        "division",
        "mitosis",
        "meiosis",
        "cytoplasm",
        "prokaryotic",
        "eukaryotic",
        "organelle",
        "जीव",
        "केंद्रक",
        "झिल्ली",
        "ऊतक",
        "विभाजन"
      ]
    },
    {
      "hindi": "सेल",
      "domain": "physics/technology",
      "description": "Cell - electrochemical/battery cell",
      "signals": [
        "battery",
        "voltage",
        "current",
        "electrochemical",
        "anode",
        "cathode",
        "electrolyte",
        "solar cell",
        "बैटरी",
        "वोल्टेज",
        "विद्युत",
        "सौर सेल"
      ]
    },
    {
      "hindi": "कक्ष",
      "domain": "general/law",
      "description": "Cell - prison cell/room",
      "signals": [
        "prison",
        "jail",
        "prisoner",
        "detention",
        "custody",
        "lock",
        "solitary",
        "confinement",
        "कारागार",
        "जेल",
        "बंदी",
        "हिरासत"
      ]
    }
  ],
  "Power": [
    {
      "hindi": "शक्ति",
      "domain": "polity/governance",
      "description": "Power - political authority/governance power",
      "signals": [
        "government",
        "legislative",
        "executive",
        "judicial",
        "separation of powers",
        "constitutional",
        "authority",
        "federal",
        "state",
        "centre",
        "concurrent",
        "सरकार",
        "विधायी",
        "कार्यपालिका",
        "न्यायिक"
      ]
    },
    {
      "hindi": "शक्ति",
      "domain": "physics",
      "description": "Power - physical power (work/time, watt)",
      "signals": [
        "watt",
        "energy",
        "work",
        "time",
        "force",
        "velocity",
        "kilowatt",
        "horsepower",
        "electrical",
        "mechanical",
        "वाट",
        "ऊर्जा",
        "कार्य",
        "बल"
      ]
    },
    {
      "hindi": "घात",
      "domain": "mathematics",
      "description": "Power - mathematical exponent",
      "signals": [
        "exponent",
        "square",
        "cube",
        "index",
        "base",
        "exponential",
        "logarithm",
        "x²",
        "x³",
        "वर्ग",
        "घन",
        "आधार",
        "घातांक"
      ]
    }
  ],
  "Current": [
    {
      "hindi": "विद्युत धारा",
      "domain": "physics",
      "description": "Current - electric current (flow of charges)",
      "signals": [
        "electric",
        "ampere",
        "voltage",
        "resistance",
        "circuit",
        "conductor",
        "alternating",
        "direct",
        "AC",
        "DC",
        "एम्पियर",
        "वोल्टेज",
        "प्रतिरोध",
        "परिपथ"
      ]
    },
    {
      "hindi": "धारा",
      "domain": "geography",
      "description": "Current - ocean/water current",
      "signals": [
        "ocean",
        "sea",
        "warm",
        "cold",
        "Gulf Stream",
        "Labrador",
        "Humboldt",
        "wind",
        "drift",
        "महासागर",
        "समुद्र",
        "गर्म",
        "ठंडी",
        "अपवाह"
      ]
    },
    {
      "hindi": "वर्तमान",
      "domain": "general/economics",
      "description": "Current - present/ongoing",
      "signals": [
        "current affairs",
        "present",
        "ongoing",
        "existing",
        "current account",
        "current year",
        "current status",
        "वर्तमान",
        "चालू खाता",
        "मौजूदा"
      ]
    }
  ],
  "Revolution": [
    {
      "hindi": "क्रांति",
      "domain": "history/politics",
      "description": "Revolution - political/social uprising",
      "signals": [
        "French",
        "Russian",
        "Industrial",
        "Green",
        "uprising",
        "overthrow",
        "movement",
        "freedom",
        "independence",
        "reform",
        "1789",
        "1917",
        "Bolshevik",
        "फ्रांसीसी",
        "रूसी",
        "औद्योगिक",
        "हरित",
        "विद्रोह"
      ]
    },
    {
      "hindi": "परिक्रमा",
      "domain": "astronomy/physics",
      "description": "Revolution - orbital revolution (planet around Sun)",
      "signals": [
        "orbit",
        "Sun",
        "Earth",
        "planet",
        "365 days",
        "orbital",
        "axis",
        "period",
        "year",
        "कक्षा",
        "सूर्य",
        "पृथ्वी",
        "ग्रह",
        "वर्ष"
      ]
    }
  ],
  "Reservation": [
    {
      "hindi": "आरक्षण",
      "domain": "polity/social",
      "description": "Reservation - constitutional reservation for SC/ST/OBC",
      "signals": [
        "SC",
        "ST",
        "OBC",
        "quota",
        "caste",
        "backward",
        "Constitution",
        "Article 15",
        "Article 16",
        "Mandal",
        "creamy layer",
        "percentage",
        "seats",
        "अनुसूचित जाति",
        "अनुसूचित जनजाति",
        "कोटा"
      ]
    },
    {
      "hindi": "आरक्षण",
      "domain": "general/travel",
      "description": "Reservation - booking (hotel, train, etc.)",
      "signals": [
        "hotel",
        "train",
        "ticket",
        "booking",
        "IRCTC",
        "seat",
        "berth",
        "confirmation",
        "cancel",
        "होटल",
        "ट्रेन",
        "टिकट",
        "बुकिंग"
      ]
    }
  ],
  "Order": [
    {
      "hindi": "आदेश",
      "domain": "law/administration",
      "description": "Order - legal/administrative order/command",
      "signals": [
        "court",
        "government",
        "executive",
        "issued",
        "directive",
        "notification",
        "compliance",
        "enforcement",
        "न्यायालय",
        "सरकार",
        "निर्देश",
        "अनुपालन"
      ]
    },
    {
      "hindi": "क्रम",
      "domain": "general/mathematics",
      "description": "Order - sequence/arrangement",
      "signals": [
        "sequence",
        "arrangement",
        "ascending",
        "descending",
        "chronological",
        "alphabetical",
        "hierarchy",
        "क्रम",
        "व्यवस्था",
        "आरोही",
        "अवरोही"
      ]
    },
    {
      "hindi": "संप्रदाय",
      "domain": "history/religion",
      "description": "Order - religious order/monastic order",
      "signals": [
        "monastic",
        "religious",
        "Buddhist",
        "Jain",
        "monk",
        "monastery",
        "sangha",
        "sect",
        "मठ",
        "भिक्षु",
        "संघ",
        "संप्रदाय"
      ]
    }
  ],
  "Scale": [
    {
      "hindi": "पैमाना",
      "domain": "geography/maps",
      "description": "Scale - map scale (ratio of map to ground distance)",
      "signals": [
        "map",
        "ratio",
        "1:50000",
        "representative fraction",
        "distance",
        "cartography",
        "topographic",
        "survey",
        "मानचित्र",
        "अनुपात",
        "दूरी",
        "सर्वेक्षण"
      ]
    },
    {
      "hindi": "पैमाना",
      "domain": "science/measurement",
      "description": "Scale - measurement scale (Richter, temperature, etc.)",
      "signals": [
        "Richter",
        "Celsius",
        "Fahrenheit",
        "Kelvin",
        "Mohs",
        "measurement",
        "magnitude",
        "intensity",
        "temperature",
        "रिक्टर",
        "तापमान",
        "माप",
        "तीव्रता"
      ]
    },
    {
      "hindi": "स्वरमान",
      "domain": "music/art",
      "description": "Scale - musical scale",
      "signals": [
        "music",
        "notes",
        "raga",
        "octave",
        "frequency",
        "melody",
        "sa re ga ma",
        "sargam",
        "संगीत",
        "स्वर",
        "राग",
        "सरगम"
      ]
    }
  ],
  "Fold": [
    {
      "hindi": "वलन",
      "domain": "geology/geography",
      "description": "Fold - geological fold (bending of rock layers)",
      "signals": [
        "rock",
        "layer",
        "anticline",
        "syncline",
        "tectonic",
        "compressional",
        "mountain",
        "Himalayas",
        "strata",
        "शैल",
        "परत",
        "अपनति",
        "अभिनति",
        "विवर्तनिक"
      ]
    },
    {
      "hindi": "गुना",
      "domain": "general/mathematics",
      "description": "Fold - multiplier (two-fold, three-fold)",
      "signals": [
        "increase",
        "decrease",
        "double",
        "triple",
        "two-fold",
        "three-fold",
        "manifold",
        "times",
        "वृद्धि",
        "दोगुना",
        "तिगुना"
      ]
    }
  ],
  "Bench": [
    {
      "hindi": "न्यायपीठ",
      "domain": "judiciary/law",
      "description": "Bench - judicial bench (panel of judges)",
      "signals": [
        "Supreme Court",
        "High Court",
        "judge",
        "hearing",
        "verdict",
        "constitution bench",
        "division bench",
        "appeal",
        "writ",
        "PIL",
        "सर्वोच्च न्यायालय",
        "उच्च न्यायालय",
        "न्यायाधीश"
      ]
    },
    {
      "hindi": "बेंच",
      "domain": "general",
      "description": "Bench - seating furniture",
      "signals": [
        "sit",
        "park",
        "wooden",
        "garden",
        "seat",
        "बैठना",
        "बगीचा",
        "लकड़ी"
      ]
    }
  ],
  "Bar": [
    {
      "hindi": "अधिवक्ता संघ",
      "domain": "judiciary/law",
      "description": "Bar - legal profession / Bar Council",
      "signals": [
        "advocate",
        "lawyer",
        "Bar Council",
        "legal profession",
        "court",
        "practice",
        "enrolled",
        "license",
        "अधिवक्ता",
        "वकील",
        "बार काउंसिल",
        "न्यायालय"
      ]
    },
    {
      "hindi": "छड़",
      "domain": "general/physics",
      "description": "Bar - rod/stick/physical object",
      "signals": [
        "rod",
        "metal",
        "iron",
        "pressure",
        "unit",
        "magnet",
        "chocolate",
        "छड़",
        "दंड",
        "चुंबक",
        "दबाव"
      ]
    }
  ],
  "Deposit": [
    {
      "hindi": "जमा",
      "domain": "economics/banking",
      "description": "Deposit - bank deposit / financial deposit",
      "signals": [
        "bank",
        "account",
        "savings",
        "fixed",
        "recurring",
        "interest",
        "RBI",
        "CASA",
        "demand deposit",
        "बैंक",
        "खाता",
        "बचत",
        "ब्याज"
      ]
    },
    {
      "hindi": "निक्षेप",
      "domain": "geology/geography",
      "description": "Deposit - geological/mineral deposit",
      "signals": [
        "mineral",
        "ore",
        "coal",
        "petroleum",
        "geological",
        "sediment",
        "alluvial",
        "formation",
        "reserve",
        "खनिज",
        "अयस्क",
        "कोयला",
        "भूवैज्ञानिक",
        "अवसाद"
      ]
    }
  ],
  "Plate": [
    {
      "hindi": "प्लेट",
      "domain": "geology/geography",
      "description": "Plate - tectonic plate",
      "signals": [
        "tectonic",
        "Earth",
        "crust",
        "mantle",
        "lithosphere",
        "convergent",
        "divergent",
        "transform",
        "boundary",
        "Indian Plate",
        "Pacific Plate",
        "Eurasian",
        "विवर्तनिक",
        "भूपर्पटी",
        "मैंटल",
        "सीमा"
      ]
    },
    {
      "hindi": "थाली",
      "domain": "general",
      "description": "Plate - dish/utensil",
      "signals": [
        "food",
        "dish",
        "eat",
        "kitchen",
        "table",
        "भोजन",
        "खाना",
        "रसोई",
        "मेज"
      ]
    }
  ],
  "Drift": [
    {
      "hindi": "अपवाह",
      "domain": "geology/geography",
      "description": "Drift - continental drift / geological drift",
      "signals": [
        "continental",
        "Wegener",
        "Pangaea",
        "plate",
        "tectonic",
        "landmass",
        "theory",
        "evidence",
        "fossil",
        "महाद्वीपीय",
        "वेगनर",
        "पैंजिया",
        "भूखंड"
      ]
    },
    {
      "hindi": "बहाव",
      "domain": "general/oceanography",
      "description": "Drift - movement/flow (ocean drift, wind drift)",
      "signals": [
        "ocean",
        "wind",
        "snow",
        "current",
        "ice",
        "समुद्र",
        "हवा",
        "बर्फ",
        "प्रवाह"
      ]
    }
  ],
  "Session": [
    {
      "hindi": "सत्र",
      "domain": "polity/parliament",
      "description": "Session - parliamentary session",
      "signals": [
        "Parliament",
        "budget",
        "monsoon",
        "winter",
        "Lok Sabha",
        "summoned",
        "prorogued",
        "President",
        "session",
        "संसद",
        "बजट",
        "मानसून",
        "शीतकालीन"
      ]
    },
    {
      "hindi": "सत्र",
      "domain": "education",
      "description": "Session - academic session/year",
      "signals": [
        "academic",
        "school",
        "college",
        "university",
        "exam",
        "semester",
        "admission",
        "enrollment",
        "शैक्षणिक",
        "विद्यालय",
        "विश्वविद्यालय",
        "परीक्षा"
      ]
    }
  ],
  "State": [
    {
      "hindi": "राज्य",
      "domain": "polity/governance",
      "description": "State - political state/province",
      "signals": [
        "government",
        "Chief Minister",
        "Governor",
        "Legislature",
        "Union Territory",
        "Article 370",
        "federal",
        "Rajasthan",
        "Maharashtra",
        "state list",
        "concurrent list",
        "सरकार",
        "मुख्यमंत्री",
        "राज्यपाल",
        "विधानमंडल"
      ]
    },
    {
      "hindi": "अवस्था",
      "domain": "science/general",
      "description": "State - condition/state of matter",
      "signals": [
        "solid",
        "liquid",
        "gas",
        "matter",
        "phase",
        "equilibrium",
        "steady state",
        "excited state",
        "ठोस",
        "तरल",
        "गैस",
        "पदार्थ",
        "अवस्था"
      ]
    }
  ],

  // ─── NEW TERMS — discovered from 329MB Drishti IAS / NCERT corpus analysis ───

  "Bank": [
    {
      "hindi": "बैंक",
      "domain": "economics/finance",
      "description": "Financial institution — bank, banking system",
      "signals": [
        "RBI", "loan", "credit", "deposit", "interest", "financial", "banking",
        "NABARD", "SBI", "nationalization", "NPA", "NBFC", "monetary", "ऋण",
        "जमा", "ब्याज", "वित्तीय", "बैंकिंग", "राष्ट्रीयकरण", "मौद्रिक"
      ]
    },
    {
      "hindi": "तट",
      "domain": "geography",
      "description": "Bank of a river or body of water",
      "signals": [
        "river", "flood", "erosion", "alluvial", "plain", "meander", "tributary",
        "delta", "नदी", "बाढ़", "अपरदन", "जलोढ़", "मैदान", "सहायक नदी",
        "तटीय", "तटरेखा", "समुद्र", "समुद्री"
      ]
    }
  ],

  "Capital": [
    {
      "hindi": "पूंजी",
      "domain": "economics",
      "description": "Capital — financial/economic capital, investment",
      "signals": [
        "investment", "FDI", "market", "account", "formation", "expenditure",
        "GDP", "fiscal", "budget", "stock", "निवेश", "बाज़ार", "राजकोषीय",
        "व्यय", "बजट", "पूंजीगत", "पूंजी निर्माण", "शेयर"
      ]
    },
    {
      "hindi": "राजधानी",
      "domain": "polity/geography",
      "description": "Capital city — seat of government",
      "signals": [
        "city", "Delhi", "state", "government", "seat", "administration",
        "शहर", "दिल्ली", "राज्य", "सरकार", "प्रशासन", "मुख्यालय"
      ]
    }
  ],

  "Interest": [
    {
      "hindi": "ब्याज",
      "domain": "economics/banking",
      "description": "Interest — financial interest/rate on money",
      "signals": [
        "rate", "loan", "bank", "RBI", "repo", "SLR", "CRR", "compound",
        "simple", "EMI", "दर", "ऋण", "बैंक", "रेपो", "चक्रवृद्धि"
      ]
    },
    {
      "hindi": "हित",
      "domain": "polity/governance",
      "description": "Interest — public interest, national interest",
      "signals": [
        "public", "national", "conflict", "vested", "PIL", "welfare", "common",
        "group", "सार्वजनिक", "राष्ट्रीय", "लोकहित", "जनहित", "कल्याण"
      ]
    },
    {
      "hindi": "रुचि",
      "domain": "general/ethics",
      "description": "Interest — personal interest, curiosity",
      "signals": [
        "hobby", "personal", "individual", "aptitude", "शौक", "व्यक्तिगत"
      ]
    }
  ],

  "Right": [
    {
      "hindi": "अधिकार",
      "domain": "polity/law",
      "description": "Right — legal/fundamental right",
      "signals": [
        "fundamental", "constitutional", "Article", "human", "civil", "citizen",
        "legal", "मौलिक", "संवैधानिक", "अनुच्छेद", "मानवाधिकार", "नागरिक"
      ]
    },
    {
      "hindi": "दक्षिण",
      "domain": "geography",
      "description": "Right as in direction (south in Hindi context) — rarely used as 'right'",
      "signals": [
        "direction", "south", "hemisphere", "दिशा", "गोलार्ध"
      ]
    }
  ],

  "Article": [
    {
      "hindi": "अनुच्छेद",
      "domain": "polity/constitution",
      "description": "Article of the Constitution",
      "signals": [
        "constitution", "Article 14", "Article 21", "Article 32", "Article 370",
        "fundamental", "Part", "संविधान", "भाग", "मौलिक", "संशोधन"
      ]
    },
    {
      "hindi": "धारा",
      "domain": "law",
      "description": "Section/Article of a law/act (IPC, CrPC etc.)",
      "signals": [
        "IPC", "CrPC", "Section", "BNS", "penal", "criminal", "offence",
        "दंड संहिता", "अपराध", "भारतीय न्याय संहिता"
      ]
    },
    {
      "hindi": "लेख",
      "domain": "general/media",
      "description": "Article — written piece, essay, news article",
      "signals": [
        "newspaper", "editorial", "opinion", "published", "author", "write",
        "समाचार", "संपादकीय", "प्रकाशित", "लेखक"
      ]
    }
  ],

  "Duty": [
    {
      "hindi": "शुल्क",
      "domain": "economics/trade",
      "description": "Duty — customs duty, excise duty, tax",
      "signals": [
        "customs", "excise", "import", "export", "tariff", "trade", "GST",
        "सीमा शुल्क", "उत्पाद शुल्क", "आयात", "निर्यात", "व्यापार"
      ]
    },
    {
      "hindi": "कर्तव्य",
      "domain": "polity/ethics",
      "description": "Duty — moral/fundamental duty, obligation",
      "signals": [
        "fundamental", "citizen", "moral", "Article 51A", "obligation", "Part IV-A",
        "मौलिक कर्तव्य", "नागरिक", "नैतिक", "दायित्व"
      ]
    }
  ],

  "Force": [
    {
      "hindi": "बल",
      "domain": "physics/science",
      "description": "Force — physical force, Newton's laws",
      "signals": [
        "Newton", "gravity", "friction", "acceleration", "mass", "centripetal",
        "centrifugal", "electromagnetic", "गुरुत्वाकर्षण", "घर्षण", "त्वरण"
      ]
    },
    {
      "hindi": "सेना",
      "domain": "defence/polity",
      "description": "Force — armed forces, military",
      "signals": [
        "army", "military", "air", "navy", "CRPF", "BSF", "paramilitary",
        "defence", "armed", "थलसेना", "वायुसेना", "नौसेना", "सशस्त्र"
      ]
    },
    {
      "hindi": "प्रवर्तन",
      "domain": "law/governance",
      "description": "Force — enforcement (Enforcement Directorate)",
      "signals": [
        "enforcement", "ED", "directorate", "PMLA", "money laundering",
        "प्रवर्तन निदेशालय", "मनी लॉन्ड्रिंग"
      ]
    }
  ],

  "Matter": [
    {
      "hindi": "पदार्थ",
      "domain": "science/physics",
      "description": "Matter — physical substance, states of matter",
      "signals": [
        "solid", "liquid", "gas", "atom", "molecule", "particle", "mass",
        "ठोस", "तरल", "गैस", "परमाणु", "अणु", "कण", "द्रव्यमान"
      ]
    },
    {
      "hindi": "मामला",
      "domain": "law/polity",
      "description": "Matter — legal case, subject matter",
      "signals": [
        "case", "court", "hearing", "judgment", "petition", "bench",
        "मुकदमा", "न्यायालय", "सुनवाई", "फैसला", "याचिका"
      ]
    },
    {
      "hindi": "विषय",
      "domain": "general/polity",
      "description": "Matter — topic, subject (Union/State/Concurrent list)",
      "signals": [
        "subject", "list", "Union", "State", "Concurrent", "Schedule VII",
        "सूची", "संघ", "राज्य", "समवर्ती", "सातवीं अनुसूची"
      ]
    }
  ],

  "Solution": [
    {
      "hindi": "विलयन",
      "domain": "chemistry/science",
      "description": "Solution — chemical solution, dissolved mixture",
      "signals": [
        "solute", "solvent", "dissolve", "concentration", "aqueous", "pH",
        "विलेय", "विलायक", "सांद्रता", "जलीय", "घोल"
      ]
    },
    {
      "hindi": "समाधान",
      "domain": "general/polity",
      "description": "Solution — answer, resolution to a problem",
      "signals": [
        "problem", "issue", "resolve", "alternative", "approach", "reform",
        "समस्या", "मुद्दा", "सुधार", "विकल्प"
      ]
    }
  ],

  "Reserve": [
    {
      "hindi": "भंडार",
      "domain": "economics/resources",
      "description": "Reserve — stockpile, foreign exchange reserve, mineral reserve",
      "signals": [
        "foreign", "exchange", "forex", "gold", "mineral", "oil", "coal",
        "strategic", "विदेशी मुद्रा", "स्वर्ण", "खनिज", "रणनीतिक"
      ]
    },
    {
      "hindi": "आरक्षित",
      "domain": "polity/forest",
      "description": "Reserved — reserved category, reserved forest",
      "signals": [
        "forest", "category", "seat", "constituency", "SC", "ST",
        "वन", "श्रेणी", "सीट", "निर्वाचन क्षेत्र"
      ]
    },
    {
      "hindi": "अभयारण्य",
      "domain": "environment",
      "description": "Reserve — wildlife reserve/sanctuary",
      "signals": [
        "wildlife", "tiger", "biosphere", "sanctuary", "national park",
        "वन्यजीव", "बाघ", "जैवमंडल", "राष्ट्रीय उद्यान"
      ]
    }
  ],

  "Party": [
    {
      "hindi": "दल",
      "domain": "polity/elections",
      "description": "Party — political party",
      "signals": [
        "election", "BJP", "Congress", "INC", "opposition", "coalition",
        "manifesto", "vote", "चुनाव", "विपक्ष", "गठबंधन", "घोषणापत्र", "मतदान"
      ]
    },
    {
      "hindi": "पक्ष",
      "domain": "law/judicial",
      "description": "Party — litigant, party to a case/dispute",
      "signals": [
        "plaintiff", "defendant", "litigant", "dispute", "case", "court",
        "वादी", "प्रतिवादी", "विवाद", "मुकदमा", "न्यायालय"
      ]
    }
  ],

  "Union": [
    {
      "hindi": "केंद्र",
      "domain": "polity/governance",
      "description": "Union — Central/Union Government of India",
      "signals": [
        "government", "cabinet", "territory", "budget", "ministry",
        "सरकार", "मंत्रिमंडल", "राज्यक्षेत्र", "बजट", "मंत्रालय"
      ]
    },
    {
      "hindi": "संघ",
      "domain": "polity/federalism",
      "description": "Union — federation, union of states",
      "signals": [
        "federation", "federal", "state", "list", "subject", "Schedule",
        "संघवाद", "संघीय", "सूची", "अनुसूची"
      ]
    },
    {
      "hindi": "यूनियन",
      "domain": "labour/economics",
      "description": "Union — trade union, labour union",
      "signals": [
        "trade", "labour", "worker", "strike", "wage", "collective",
        "श्रमिक", "मज़दूर", "हड़ताल", "वेतन"
      ]
    }
  ],

  "Conduct": [
    {
      "hindi": "आचरण",
      "domain": "ethics/governance",
      "description": "Conduct — behavior, code of conduct",
      "signals": [
        "code", "ethics", "behavior", "civil servant", "rules", "standard",
        "आचार संहिता", "नैतिकता", "व्यवहार", "लोकसेवक", "मानक"
      ]
    },
    {
      "hindi": "संचालन",
      "domain": "polity/administration",
      "description": "Conduct — conducting (elections, operations, business)",
      "signals": [
        "election", "business", "operation", "parliament", "proceedings",
        "चुनाव", "संसद", "कार्यवाही", "प्रक्रिया"
      ]
    }
  ],

  "Policy": [
    {
      "hindi": "नीति",
      "domain": "governance/polity",
      "description": "Policy — government policy, public policy",
      "signals": [
        "government", "foreign", "fiscal", "monetary", "public", "NITI",
        "reform", "national", "सरकार", "विदेश", "राजकोषीय", "मौद्रिक",
        "सार्वजनिक", "सुधार", "राष्ट्रीय"
      ]
    },
    {
      "hindi": "बीमा",
      "domain": "economics/insurance",
      "description": "Policy — insurance policy",
      "signals": [
        "insurance", "LIC", "premium", "claim", "health", "life",
        "बीमा", "प्रीमियम", "दावा", "स्वास्थ्य", "जीवन"
      ]
    }
  ],

  "Schedule": [
    {
      "hindi": "अनुसूची",
      "domain": "polity/constitution",
      "description": "Schedule — constitutional schedule (First to Twelfth)",
      "signals": [
        "constitution", "First", "Second", "Seventh", "Eighth", "Ninth",
        "Twelfth", "list", "संविधान", "सातवीं", "आठवीं", "सूची"
      ]
    },
    {
      "hindi": "सूची",
      "domain": "general/administration",
      "description": "Schedule — timetable, list, schedule of activities",
      "signals": [
        "time", "exam", "plan", "calendar", "timetable",
        "समय", "परीक्षा", "योजना", "कैलेंडर"
      ]
    }
  ],

  "Assembly": [
    {
      "hindi": "विधानसभा",
      "domain": "polity/legislature",
      "description": "Assembly — State Legislative Assembly (Vidhan Sabha)",
      "signals": [
        "state", "MLA", "election", "Vidhan", "legislative", "dissolution",
        "राज्य", "विधायक", "चुनाव", "विधान", "विघटन"
      ]
    },
    {
      "hindi": "संविधान सभा",
      "domain": "polity/history",
      "description": "Assembly — Constituent Assembly",
      "signals": [
        "constituent", "drafting", "committee", "Ambedkar", "1946", "1949",
        "संविधान", "प्रारूप", "समिति", "अंबेडकर"
      ]
    },
    {
      "hindi": "सभा",
      "domain": "general/polity",
      "description": "Assembly — general assembly, gathering",
      "signals": [
        "General Assembly", "UN", "meeting", "gathering",
        "महासभा", "संयुक्त राष्ट्र", "बैठक"
      ]
    }
  ],

  "Grant": [
    {
      "hindi": "अनुदान",
      "domain": "polity/finance",
      "description": "Grant — budgetary grant, grants-in-aid",
      "signals": [
        "demand", "supplementary", "token", "excess", "budget", "Article 113",
        "appropriation", "मांग", "अनुपूरक", "सांकेतिक", "अतिरिक्त",
        "बजट", "विनियोग"
      ]
    },
    {
      "hindi": "छात्रवृत्ति",
      "domain": "education",
      "description": "Grant — scholarship, educational grant",
      "signals": [
        "scholarship", "student", "education", "fellowship", "research",
        "छात्र", "शिक्षा", "अनुसंधान"
      ]
    }
  ],

  "Pressure": [
    {
      "hindi": "दबाव",
      "domain": "polity/general",
      "description": "Pressure — political/social pressure, pressure group",
      "signals": [
        "group", "lobby", "political", "social", "international",
        "समूह", "राजनीतिक", "सामाजिक", "अंतरराष्ट्रीय"
      ]
    },
    {
      "hindi": "वायुदाब",
      "domain": "geography/meteorology",
      "description": "Pressure — atmospheric/barometric pressure",
      "signals": [
        "atmospheric", "barometric", "high", "low", "isobar", "cyclone",
        "anticyclone", "wind", "वायुमंडलीय", "समदाब", "चक्रवात", "पवन"
      ]
    },
    {
      "hindi": "दाब",
      "domain": "physics/science",
      "description": "Pressure — scientific pressure (Pascal, force per area)",
      "signals": [
        "Pascal", "force", "area", "fluid", "gas", "Boyle",
        "बल", "क्षेत्रफल", "तरल", "गैस"
      ]
    }
  ],

  "Summit": [
    {
      "hindi": "शिखर सम्मेलन",
      "domain": "international_relations",
      "description": "Summit — diplomatic/multilateral summit meeting",
      "signals": [
        "G20", "G7", "BRICS", "SAARC", "bilateral", "multilateral", "leaders",
        "द्विपक्षीय", "बहुपक्षीय", "नेता"
      ]
    },
    {
      "hindi": "चोटी",
      "domain": "geography",
      "description": "Summit — mountain peak/summit",
      "signals": [
        "mountain", "peak", "Everest", "altitude", "climb",
        "पर्वत", "शिखर", "ऊंचाई", "हिमालय"
      ]
    }
  ],

  "Movement": [
    {
      "hindi": "आंदोलन",
      "domain": "history/polity",
      "description": "Movement — social/political movement",
      "signals": [
        "civil", "disobedience", "non-cooperation", "Quit India", "freedom",
        "independence", "Gandhi", "protest", "असहयोग", "सविनय अवज्ञा",
        "स्वतंत्रता", "गांधी", "विरोध"
      ]
    },
    {
      "hindi": "गति",
      "domain": "physics/science",
      "description": "Movement — physical motion, velocity",
      "signals": [
        "speed", "velocity", "Newton", "momentum", "acceleration", "kinetic",
        "चाल", "वेग", "संवेग", "त्वरण", "गतिज"
      ]
    }
  ],

  "Security": [
    {
      "hindi": "सुरक्षा",
      "domain": "polity/defence",
      "description": "Security — national/internal security, safety",
      "signals": [
        "national", "internal", "cyber", "border", "UNSC", "council",
        "threat", "राष्ट्रीय", "आंतरिक", "साइबर", "सीमा", "खतरा"
      ]
    },
    {
      "hindi": "प्रतिभूति",
      "domain": "economics/finance",
      "description": "Security — financial security, securities market",
      "signals": [
        "SEBI", "market", "bond", "share", "stock", "exchange", "trading",
        "बाज़ार", "बांड", "शेयर", "कारोबार"
      ]
    }
  ],

  "Reaction": [
    {
      "hindi": "अभिक्रिया",
      "domain": "chemistry/science",
      "description": "Reaction — chemical reaction",
      "signals": [
        "chemical", "oxidation", "reduction", "acid", "base", "catalyst",
        "endothermic", "exothermic", "रासायनिक", "ऑक्सीकरण", "अपचयन",
        "अम्ल", "क्षार", "उत्प्रेरक"
      ]
    },
    {
      "hindi": "प्रतिक्रिया",
      "domain": "general/polity",
      "description": "Reaction — response, political reaction",
      "signals": [
        "response", "opposition", "public", "government", "statement",
        "प्रतिक्रिया", "विपक्ष", "सार्वजनिक", "सरकार", "बयान"
      ]
    }
  ],

  "Compound": [
    {
      "hindi": "यौगिक",
      "domain": "chemistry/science",
      "description": "Compound — chemical compound",
      "signals": [
        "chemical", "organic", "inorganic", "molecule", "formula", "element",
        "रासायनिक", "कार्बनिक", "अकार्बनिक", "अणु", "सूत्र", "तत्व"
      ]
    },
    {
      "hindi": "परिसर",
      "domain": "general",
      "description": "Compound — premises, building complex",
      "signals": [
        "building", "campus", "premises", "area", "complex",
        "भवन", "परिसर", "क्षेत्र"
      ]
    }
  ],

  "Base": [
    {
      "hindi": "आधार",
      "domain": "general/polity",
      "description": "Base — foundation, basis, Aadhaar",
      "signals": [
        "foundation", "basis", "Aadhaar", "UIDAI", "identity", "fundamental",
        "नींव", "आधारभूत", "पहचान"
      ]
    },
    {
      "hindi": "क्षार",
      "domain": "chemistry/science",
      "description": "Base — chemical base (alkaline substance)",
      "signals": [
        "acid", "alkali", "pH", "litmus", "neutralization", "hydroxide",
        "अम्ल", "क्षारीय", "उदासीनीकरण", "लिटमस"
      ]
    },
    {
      "hindi": "अड्डा",
      "domain": "defence/military",
      "description": "Base — military base, air base",
      "signals": [
        "military", "air", "naval", "army", "strategic",
        "सैन्य", "वायु", "नौसैनिक", "सामरिक"
      ]
    }
  ]
};

// ═══════════════════════════════════════════════════════════════════════════════
// SUBJECT DETECTION KEYWORDS
// Used to detect the domain/subject of surrounding text
// ═══════════════════════════════════════════════════════════════════════════════

export const SUBJECT_KEYWORDS = {
  geography: [
    'plateau', 'plain', 'river', 'mountain', 'ocean', 'monsoon',
    'latitude', 'longitude', 'equator', 'climate', 'soil', 'vegetation',
    'earthquake', 'volcano', 'continent', 'island', 'peninsula', 'delta',
    'mineral', 'ore', 'agriculture', 'irrigation', 'crop',
    'पठार', 'नदी', 'पर्वत', 'महासागर', 'मानसून', 'जलवायु',
    'भूकंप', 'ज्वालामुखी', 'महाद्वीप', 'कृषि', 'सिंचाई',
  ],
  polity: [
    'Parliament', 'Constitution', 'Article', 'Amendment', 'Lok Sabha',
    'Rajya Sabha', 'Supreme Court', 'High Court', 'fundamental rights',
    'bill', 'legislature', 'executive', 'judiciary', 'federal',
    'election', 'governor', 'president', 'prime minister',
    'संसद', 'संविधान', 'अनुच्छेद', 'लोकसभा', 'राज्यसभा',
    'मौलिक अधिकार', 'विधेयक', 'कार्यपालिका', 'न्यायपालिका',
  ],
  economics: [
    'GDP', 'inflation', 'fiscal', 'monetary', 'budget', 'tax',
    'revenue', 'expenditure', 'deficit', 'trade', 'export', 'import',
    'investment', 'bank', 'interest', 'subsidy', 'poverty', 'market',
    'मुद्रास्फीति', 'राजकोषीय', 'मौद्रिक', 'बजट', 'कर', 'व्यापार',
  ],
  science: [
    'atom', 'molecule', 'element', 'compound', 'reaction', 'cell',
    'organism', 'DNA', 'gene', 'force', 'energy', 'velocity',
    'acid', 'base', 'electric', 'magnetic', 'wave', 'frequency',
    'परमाणु', 'अणु', 'तत्व', 'कोशिका', 'बल', 'ऊर्जा', 'विद्युत',
  ],
  history: [
    'dynasty', 'empire', 'kingdom', 'ruler', 'invasion', 'movement',
    'revolt', 'independence', 'colonial', 'Mughal', 'Maurya', 'Gupta',
    'civilization', 'ancient', 'medieval', 'modern', 'renaissance',
    'वंश', 'साम्राज्य', 'आंदोलन', 'विद्रोह', 'स्वतंत्रता', 'सभ्यता',
  ],
  environment: [
    'biodiversity', 'ecosystem', 'conservation', 'pollution',
    'climate change', 'global warming', 'ozone', 'wildlife',
    'national park', 'sanctuary', 'endangered', 'renewable',
    'जैव विविधता', 'पारिस्थितिकी', 'संरक्षण', 'प्रदूषण', 'वन्यजीव',
  ],
};

/**
 * Detect the subject domain of a text passage.
 * @param {string} text - The text to analyze
 * @returns {{ subject: string, confidence: number }}
 */
export function detectSubject(text) {
  if (!text) return { subject: 'general', confidence: 0 };

  const textLower = text.toLowerCase();
  const scores = {};

  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    let matched = 0;
    for (const kw of keywords) {
      if (textLower.includes(kw.toLowerCase()) || text.includes(kw)) {
        matched++;
      }
    }
    scores[subject] = matched / keywords.length;
  }

  let bestSubject = 'general';
  let bestScore = 0;

  for (const [subject, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestSubject = subject;
    }
  }

  return { subject: bestSubject, confidence: Math.round(bestScore * 1000) / 1000 };
}

/**
 * Disambiguate an English term based on surrounding context.
 *
 * @param {string} term - The ambiguous English word (e.g., "Mercury")
 * @param {string} surroundingText - Text around the term (paragraph/sentence)
 * @param {string} [subjectHint] - Optional subject domain hint
 * @returns {{ hindi: string, domain: string, confidence: number } | null}
 */
export function disambiguateTerm(term, surroundingText, subjectHint = null) {
  const meanings = AMBIGUOUS_TERMS[term];
  if (!meanings) return null;

  const textLower = (surroundingText || '').toLowerCase();
  const scores = [];

  for (const meaning of meanings) {
    let score = 0;
    let matched = 0;

    for (const signal of meaning.signals) {
      const signalLower = signal.toLowerCase();
      if (textLower.includes(signalLower) || surroundingText.includes(signal)) {
        matched++;
      }
    }

    score = meaning.signals.length > 0 ? matched / meaning.signals.length : 0;

    // Boost if subject hint matches
    if (subjectHint) {
      const domains = meaning.domain.split('/');
      if (domains.some(d => d.toLowerCase() === subjectHint.toLowerCase())) {
        score += 0.3;
      }
    }

    scores.push({
      hindi: meaning.hindi,
      domain: meaning.domain,
      description: meaning.description,
      score: Math.min(score, 1.0),
      matched,
    });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];
  return {
    hindi: best.hindi,
    domain: best.domain,
    confidence: Math.round(best.score * 1000) / 1000,
    allMeanings: scores,
  };
}

/**
 * Apply context-aware disambiguation to a full text before translation.
 * Replaces ambiguous English terms with their context-appropriate Hindi.
 *
 * @param {string} englishText - The source English text
 * @param {string} [subjectHint] - Optional subject domain hint
 * @returns {{ processedText: string, disambiguations: Array }}
 */
export function applyContextDisambiguation(englishText, subjectHint = null) {
  if (!englishText) return { processedText: englishText, disambiguations: [] };

  // Auto-detect subject if no hint provided
  if (!subjectHint) {
    const detected = detectSubject(englishText);
    if (detected.confidence > 0.05) {
      subjectHint = detected.subject;
    }
  }

  const disambiguations = [];

  // For each ambiguous term, provide context hints to the AI translator
  for (const term of Object.keys(AMBIGUOUS_TERMS)) {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    if (regex.test(englishText)) {
      const result = disambiguateTerm(term, englishText, subjectHint);
      if (result && result.confidence > 0.05) {
        disambiguations.push({
          term,
          correctHindi: result.hindi,
          domain: result.domain,
          confidence: result.confidence,
        });
      }
    }
  }

  return {
    processedText: englishText,
    disambiguations,
    detectedSubject: subjectHint,
  };
}

/**
 * Generate a disambiguation instruction string for the Claude system prompt.
 * Call this with the disambiguations from applyContextDisambiguation().
 *
 * @param {Array} disambiguations - Array from applyContextDisambiguation()
 * @returns {string} Additional prompt instructions
 */
export function getDisambiguationPrompt(disambiguations) {
  if (!disambiguations || disambiguations.length === 0) return '';

  let prompt = '\n## CONTEXT-AWARE DISAMBIGUATION (auto-detected):\n';
  prompt += 'The following terms have been analyzed for context. Use EXACTLY these Hindi translations:\n';

  for (const d of disambiguations) {
    prompt += `- "${d.term}" → "${d.correctHindi}" (${d.domain}, confidence: ${d.confidence})\n`;
  }

  return prompt;
}

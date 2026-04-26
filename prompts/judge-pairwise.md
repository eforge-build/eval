You are an expert code reviewer acting as an LLM judge. Your task is to compare two implementations (A and B) of the same PRD and determine which is better on each dimension.

For each dimension, choose `"a"` if implementation A is better, `"b"` if B is better, or `"tie"` if they are equivalent. Include a one-sentence justification.

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON object.

## Dimensions

### 1. PRD Adherence (prdAdherence)
Which implementation better satisfies every requirement stated in the PRD?
- Anchors: 1=critical requirements missing; 3=most requirements addressed; 5=every requirement fully implemented

### 2. Code Quality (codeQuality)
Which implementation has better code structure, readability, and idiomatic style?
- Anchors: 1=significant structural problems; 3=acceptable quality; 5=excellent, idiomatic code

### 3. Test Quality (testQuality)
Which implementation has more thorough and meaningful tests?
- Anchors: 1=no new tests; 3=happy-path tests; 5=happy+edge+error paths with meaningful assertions

### 4. Change Discipline (changeDiscipline)
Which implementation has a more focused, appropriately scoped diff?
- Anchors: 1=unrelated changes or excessive scope; 3=mostly on-target; 5=perfectly scoped

## Required Output Format

Respond with exactly this JSON structure and nothing else:

{
  "prdAdherence": {
    "winner": "<a|b|tie>",
    "justification": "<one sentence>"
  },
  "codeQuality": {
    "winner": "<a|b|tie>",
    "justification": "<one sentence>"
  },
  "testQuality": {
    "winner": "<a|b|tie>",
    "justification": "<one sentence>"
  },
  "changeDiscipline": {
    "winner": "<a|b|tie>",
    "justification": "<one sentence>"
  }
}

---

## PRD

{{PRD}}

---

## Implementation A ({{PROFILE_A}})

{{DIFF_A}}

---

## Implementation B ({{PROFILE_B}})

{{DIFF_B}}

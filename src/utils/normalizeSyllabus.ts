import { ParsedSyllabusResponse } from '../types/course';

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

export function parseNumericValue(raw: unknown, fallback = 0): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const val = parseFloat(match[0]);
      if (Number.isFinite(val)) return val;
    }
  }
  return fallback;
}

/**
 * Only explicit major exams (Midterm, Final, or standalone Exam/Test) are single-occurrence 'exam'.
 * Quizzes, Homework, Labs, Projects, Classwork, Practice, Discussions, Attendance, Reports, and
 * all other ongoing coursework items are 'non-exam' so they support setting occurrence count (次数)
 * and Drop Lowest.
 */
export function isExplicitMajorExamName(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  if (!lower) return false;

  // Quizzes and practice/drop-in items always need occurrence count (按次算分)
  if (
    lower.includes('quiz') ||
    lower.includes('homework') ||
    lower.includes('hw') ||
    lower.includes('classwork') ||
    lower.includes('practice') ||
    lower.includes('challenge') ||
    lower.includes('worksheet') ||
    lower.includes('lab') ||
    lower.includes('discussion') ||
    lower.includes('attendance') ||
    lower.includes('participation') ||
    lower.includes('assignment') ||
    lower.includes('checkpoint') ||
    lower.includes('reading') ||
    lower.includes('clicker') ||
    lower.includes('poll')
  ) {
    return false;
  }

  if (lower.includes('midterm') || lower.includes('final')) {
    return true;
  }

  if (/\b(exam|exams|test|tests)\b/i.test(lower)) {
    return true;
  }

  return false;
}

export function inferNormalizedCategory(
  name: string,
  rawCategory?: string
): 'exam' | 'non-exam' {
  if (isExplicitMajorExamName(name)) {
    return 'exam';
  }
  // Everything else (Quizzes, Homework, Labs, Projects, Classwork, Practice, custom coursework)
  // defaults to 'non-exam' so users can always configure total count (次数) and Drop Lowest.
  void rawCategory;
  return 'non-exam';
}

/**
 * Extracts total item count and drop-lowest count for multi-occurrence categories
 * like Quizzes, Homework, Labs, Practice Problems, etc.
 */
export function detectSubItemCountAndDrop(
  name: string,
  notes?: string,
  policyNotes?: string
): { count?: number; dropCount?: number } {
  const combined = [name, notes || ''].join(' ').toLowerCase();
  let count: number | undefined;
  let dropCount: number | undefined;

  // 1. "best K of N" or "best K/N" (e.g. "Quizzes (best 8 of 10)", "Practice Problems (best 5/6)")
  const bestMatch = combined.match(/best\s+(\d+)\s*(?:\/|of|out of)\s*(\d+)/i);
  if (bestMatch) {
    const k = parseInt(bestMatch[1], 10);
    const n = parseInt(bestMatch[2], 10);
    if (n >= 2 && n <= 40 && k >= 1 && k < n) {
      count = n;
      dropCount = n - k;
    }
  }

  // 2. Explicit count in name/notes: "10 Quizzes", "Quizzes (10)", "Weekly Quizzes (12 total)", "8 Homeworks"
  if (!count) {
    const prefixCount = combined.match(
      /\b(\d+)\s+(?:weekly\s+|online\s+|in-class\s+|reading\s+|pop\s+|short\s+|mini\s+)?(?:quiz|quizzes|homework|homeworks|hw|hws|assignment|assignments|lab|labs|worksheet|worksheets|discussion|discussions|project|projects|problem\s+sets?|practice\s+problems?|challenge\s+problems?)\b/i
    );
    if (prefixCount) {
      const n = parseInt(prefixCount[1], 10);
      if (n >= 2 && n <= 40) count = n;
    }
  }

  if (!count) {
    const wordPrefix = combined.match(
      /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:weekly\s+|online\s+|in-class\s+|reading\s+|pop\s+)?(?:quiz|quizzes|homework|homeworks|hw|assignment|assignments|lab|labs|project|projects)\b/i
    );
    if (wordPrefix) {
      const n = WORD_NUMBERS[wordPrefix[1].toLowerCase()];
      if (n && n >= 2) count = n;
    }
  }

  if (!count) {
    const parenCount = combined.match(
      /\(\s*x?(\d+)\s*(?:quizzes|homeworks|assignments|labs|items|total|×|x|@)?\s*\)/i
    );
    if (parenCount) {
      const n = parseInt(parenCount[1], 10);
      if (n >= 2 && n <= 40) count = n;
    }
  }

  // 3. Explicit drop lowest in name/notes or matching policyNotes
  const dropMatch = combined.match(
    /drop\s+(?:the\s+)?lowest\s+(\d+|one|two|three|four)/i
  ) ||
    combined.match(/lowest\s+(\d+|one|two|three)\s+(?:is\s+|are\s+|will\s+be\s+)?dropped/i);
  if (dropMatch) {
    const rawDrop = dropMatch[1].toLowerCase();
    const d = WORD_NUMBERS[rawDrop] ?? parseInt(rawDrop, 10);
    if (Number.isFinite(d) && d >= 1 && d <= 10) {
      dropCount = d;
    }
  } else if (/drop\s+(?:the\s+)?lowest\b/i.test(combined) && dropCount === undefined) {
    dropCount = 1;
  }

  // Check policyNotes if component is Quiz or Homework and dropCount wasn't in name
  if (dropCount === undefined && policyNotes) {
    const lowerName = name.toLowerCase();
    const lowerPolicy = policyNotes.toLowerCase();
    if (lowerName.includes('quiz') && lowerPolicy.includes('quiz')) {
      const m =
        lowerPolicy.match(
          /drop\s+(?:the\s+)?lowest\s+(\d+|one|two|three)\s+quiz/i
        ) ||
        lowerPolicy.match(
          /lowest\s+(\d+|one|two|three)?\s*quiz(?:zes)?\s+(?:score\s+)?(?:is\s+|are\s+|will\s+be\s+)?dropped/i
        );
      if (m) {
        const d = m[1] ? WORD_NUMBERS[m[1].toLowerCase()] ?? parseInt(m[1], 10) : 1;
        if (Number.isFinite(d) && d >= 1) dropCount = d;
      }
    } else if (
      (lowerName.includes('homework') || lowerName.includes('hw')) &&
      (lowerPolicy.includes('homework') || lowerPolicy.includes('hw'))
    ) {
      const m =
        lowerPolicy.match(
          /drop\s+(?:the\s+)?lowest\s+(\d+|one|two|three)\s+(?:homework|hw)/i
        ) ||
        lowerPolicy.match(
          /lowest\s+(\d+|one|two|three)?\s*(?:homework|hw)\s+(?:score\s+)?(?:is\s+|are\s+|will\s+be\s+)?dropped/i
        );
      if (m) {
        const d = m[1] ? WORD_NUMBERS[m[1].toLowerCase()] ?? parseInt(m[1], 10) : 1;
        if (Number.isFinite(d) && d >= 1) dropCount = d;
      }
    }
  }

  return { count, dropCount };
}

function detectMultiExamCountFromName(name: string): {
  count: number;
  dropCount: number;
} | null {
  const lower = name.toLowerCase().trim();

  // Never split Quizzes into separate exam rows; Quizzes use sub-items (Track Each / 按次算分)
  if (lower.includes('quiz')) {
    return null;
  }

  // Do not split if it is already a single numbered item like "Midterm 1", "Exam 2", "Test 3", "Final Exam"
  if (
    /\b(midterm|exam|test)\s+#?\d+\b/i.test(lower) &&
    !/[&,/-]|and|to|through/i.test(lower)
  ) {
    return null;
  }
  if (/\bfinal\b/i.test(lower)) {
    return null;
  }

  // 1. "best K of N" or "best K/N" in exam name, e.g. "Midterms (best 2 of 3)"
  const bestMatch = lower.match(/best\s+(\d+)\s*(?:\/|of|out of)\s*(\d+)/i);
  if (bestMatch) {
    const k = parseInt(bestMatch[1], 10);
    const n = parseInt(bestMatch[2], 10);
    if (n >= 2 && n <= 10 && k >= 1 && k < n) {
      return { count: n, dropCount: n - k };
    }
  }

  // 2. Range or list like "Midterm 1 & 2", "Midterms 1, 2, 3", "Exams 1-3"
  const rangeMatch = lower.match(
    /\b(?:midterm|exam|test)s?\s*1\s*(?:-|–|to|through)\s*(\d+)\b/i
  );
  if (rangeMatch) {
    const n = parseInt(rangeMatch[1], 10);
    if (n >= 2 && n <= 10) return { count: n, dropCount: 0 };
  }

  if (/\b(?:midterm|exam|test)s?\s*1\s*(?:,|&|and)\s*2\s*(?:,|&|and)\s*3\b/i.test(lower)) {
    return { count: 3, dropCount: 0 };
  }
  if (/\b(?:midterm|exam|test)s?\s*1\s*(?:&|and)\s*2\b/i.test(lower)) {
    return { count: 2, dropCount: 0 };
  }

  // 3. Leading or parenthesized number: "3 Midterms", "Midterms (3)", "Exams (x3)", "Two Midterms"
  const numPrefix = lower.match(
    /^(\d+)\s+(?:in-class\s+|hourly\s+|evening\s+)?(?:midterm|exam|test)/i
  );
  if (numPrefix) {
    const n = parseInt(numPrefix[1], 10);
    if (n >= 2 && n <= 10) return { count: n, dropCount: 0 };
  }

  const wordPrefix = lower.match(
    /^(two|three|four|five|six)\s+(?:in-class\s+|hourly\s+|evening\s+)?(?:midterm|exam|test)/i
  );
  if (wordPrefix) {
    const n = WORD_NUMBERS[wordPrefix[1].toLowerCase()];
    if (n) return { count: n, dropCount: 0 };
  }

  const parenCount = lower.match(
    /(?:midterm|exam|test)s?.*?\(\s*x?(\d+)\s*(?:@|×|x|exams|midterms|tests|total|each)?/i
  );
  if (parenCount) {
    const n = parseInt(parenCount[1], 10);
    if (n >= 2 && n <= 10) return { count: n, dropCount: 0 };
  }

  return null;
}

function getSingularExamLabel(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('midterm')) return 'Midterm';
  if (lower.includes('test')) return 'Test';
  return 'Exam';
}

/**
 * Normalizes types, cleans % strings, deduplicates components, and expands multi-exam groups
 */
export function normalizeAndExpandParsedSyllabus(
  raw: Record<string, unknown> | ParsedSyllabusResponse
): ParsedSyllabusResponse {
  const rawCode = typeof raw.courseCode === 'string' ? raw.courseCode.trim() : '';
  const courseCode = /^(unknown|unknown course|n\/a|none|null|not specified|course|syllabus)$/i.test(
    rawCode
  )
    ? ''
    : rawCode;

  const rawTitle = typeof raw.courseTitle === 'string' ? raw.courseTitle.trim() : '';
  const courseTitle = /^(unknown|unknown course|n\/a|none|null|not specified)$/i.test(
    rawTitle
  )
    ? ''
    : rawTitle;

  let examDropCount = Math.max(0, Math.round(parseNumericValue(raw.examDropCount, 0)));
  const policyNotes =
    typeof raw.policyNotes === 'string' ? raw.policyNotes.trim() : undefined;

  const rawComponents = Array.isArray(raw.components) ? raw.components : [];

  // Step 1: Basic normalization + deduplication by base key
  const seenKeys = new Set<string>();
  const normalizedList: Array<{
    name: string;
    weight: number;
    categoryType: 'exam' | 'non-exam';
    maxPoints: number;
    canBeDropped?: boolean;
    isExtraCredit?: boolean;
    totalSubItemsCount: number;
    subDropLowestCount: number;
    notes?: string;
  }> = [];

  for (const item of rawComponents) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!name) continue;

    const dedupeKey = name
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!dedupeKey || seenKeys.has(dedupeKey)) continue;

    const weight = parseNumericValue(rec.weight, 0);
    if (weight <= 0) continue;

    const categoryType = inferNormalizedCategory(
      name,
      typeof rec.categoryType === 'string' ? rec.categoryType : undefined
    );
    const maxPoints = Math.max(1, parseNumericValue(rec.maxPoints, 100));
    const notesStr = typeof rec.notes === 'string' ? rec.notes : undefined;

    const rawSubCount = parseNumericValue(rec.totalSubItemsCount, 0);
    const rawSubDrop = parseNumericValue(rec.subDropLowestCount, 0);

    const detectedSub =
      categoryType === 'non-exam'
        ? detectSubItemCountAndDrop(name, notesStr, policyNotes)
        : {};

    const totalSubItemsCount = Math.max(
      1,
      Math.round(
        detectedSub.count ??
          (rawSubCount >= 2 ? rawSubCount : categoryType === 'non-exam' ? 8 : 1)
      )
    );
    const subDropLowestCount = Math.max(
      0,
      Math.round(detectedSub.dropCount ?? (rawSubDrop > 0 ? rawSubDrop : 0))
    );

    seenKeys.add(dedupeKey);
    normalizedList.push({
      name,
      weight,
      categoryType,
      maxPoints,
      canBeDropped:
        typeof rec.canBeDropped === 'boolean' ? rec.canBeDropped : undefined,
      isExtraCredit: Boolean(rec.isExtraCredit),
      totalSubItemsCount,
      subDropLowestCount,
      notes: notesStr,
    });
  }

  // Step 2: Expand grouped exam items (e.g. "Midterms" with totalSubItemsCount=3 or "3 Midterms")
  const expandedComponents: ParsedSyllabusResponse['components'] = [];
  let groupSpecificDropTriggered = false;

  for (let i = 0; i < normalizedList.length; i++) {
    const comp = normalizedList[i];
    if (comp.categoryType === 'exam') {
      const fromName = detectMultiExamCountFromName(comp.name);
      const fromNotes = comp.notes ? detectMultiExamCountFromName(comp.notes) : null;
      const isSingleNumbered =
        /\b(midterm|exam|test)\s+#?\d+\b/i.test(comp.name) &&
        !/[&,/-]|and|to|through/i.test(comp.name);
      const isFinal = /\bfinal\b/i.test(comp.name);

      const countFromField =
        !isSingleNumbered && !isFinal && comp.totalSubItemsCount >= 2 && comp.totalSubItemsCount <= 10
          ? comp.totalSubItemsCount
          : 1;

      let examCount = fromName
        ? fromName.count
        : fromNotes
        ? fromNotes.count
        : countFromField;

      // If the component name is plural (e.g. "Midterms", "Exams") and examCount is still 1, check policyNotes
      if (
        examCount === 1 &&
        !isSingleNumbered &&
        !isFinal &&
        /\b(midterms|exams|tests)\b/i.test(comp.name) &&
        policyNotes
      ) {
        const fromPolicy = detectMultiExamCountFromName(policyNotes);
        if (fromPolicy) {
          examCount = fromPolicy.count;
        }
      }

      const groupDrop =
        comp.subDropLowestCount > 0
          ? comp.subDropLowestCount
          : fromName?.dropCount || fromNotes?.dropCount || 0;

      if (examCount >= 2 && examCount <= 10) {
        if (groupDrop > 0 && examDropCount === 0) {
          examDropCount = groupDrop;
          groupSpecificDropTriggered = true;
        }

        const countedInGroup =
          groupDrop > 0 && groupDrop < examCount
            ? examCount - groupDrop
            : examCount;

        // Determine if comp.weight is the group total (e.g. 45% for all midterms) or per-exam weight (e.g. 20% each)
        const otherWeightSum = normalizedList
          .filter((_, idx) => idx !== i)
          .reduce((s, c) => s + c.weight, 0);

        const diffIfGroupTotal = Math.abs(otherWeightSum + comp.weight - 100);
        const diffIfPerExam = Math.abs(
          otherWeightSum + comp.weight * countedInGroup - 100
        );

        const eachWeight =
          diffIfPerExam + 1 < diffIfGroupTotal
            ? comp.weight
            : Number((comp.weight / countedInGroup).toFixed(2));

        const baseLabel = getSingularExamLabel(comp.name);
        for (let idx = 1; idx <= examCount; idx++) {
          expandedComponents.push({
            name: `${baseLabel} ${idx}`,
            weight:
              idx === examCount && diffIfGroupTotal <= diffIfPerExam + 1 && groupDrop === 0
                ? Number((comp.weight - eachWeight * (examCount - 1)).toFixed(2))
                : eachWeight,
            categoryType: 'exam',
            maxPoints: comp.maxPoints,
            canBeDropped: groupDrop > 0 ? true : comp.canBeDropped ?? examDropCount > 0,
            isExtraCredit: false,
            totalSubItemsCount: 1,
            subDropLowestCount: 0,
          });
        }
        continue;
      }
    }

    expandedComponents.push({
      name: comp.name,
      weight: comp.weight,
      categoryType: comp.categoryType,
      maxPoints: comp.maxPoints,
      canBeDropped:
        comp.categoryType === 'exam'
          ? groupSpecificDropTriggered && /\bfinal\b/i.test(comp.name)
            ? false
            : comp.canBeDropped ?? true
          : false,
      isExtraCredit: comp.isExtraCredit,
      totalSubItemsCount: comp.totalSubItemsCount,
      subDropLowestCount: comp.subDropLowestCount,
      notes: comp.notes,
    });
  }

  // Step 3: Normalize Grade Scale Cutoffs
  const rawScale = Array.isArray(raw.gradeScale) ? raw.gradeScale : [];
  const gradeScale: Array<{ letter: string; minPercentage: number }> = [];
  const seenLetters = new Set<string>();

  for (const g of rawScale) {
    if (!g || typeof g !== 'object') continue;
    const rec = g as Record<string, unknown>;
    const letter = typeof rec.letter === 'string' ? rec.letter.trim().toUpperCase() : '';
    const minPct = parseNumericValue(rec.minPercentage, NaN);
    if (letter && Number.isFinite(minPct) && minPct > 0 && minPct <= 105 && !seenLetters.has(letter)) {
      seenLetters.add(letter);
      gradeScale.push({
        letter,
        minPercentage: minPct,
      });
    }
  }

  gradeScale.sort((a, b) => b.minPercentage - a.minPercentage);

  return {
    courseCode,
    courseTitle,
    examDropCount,
    policyNotes,
    components: expandedComponents,
    gradeScaleFound: gradeScale.length > 0,
    gradeScale,
  };
}

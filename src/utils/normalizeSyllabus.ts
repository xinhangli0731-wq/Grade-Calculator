import { ParsedSyllabusResponse } from '../types/course';

const WORD_NUMBERS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
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

export function inferNormalizedCategory(
  name: string,
  rawCategory?: string
): 'exam' | 'non-exam' {
  const lower = (name || '').toLowerCase();
  if (
    lower.includes('midterm') ||
    lower.includes('final') ||
    lower.includes('exam') ||
    lower.includes('quiz') ||
    lower.includes('test') ||
    lower.includes('report')
  ) {
    return 'exam';
  }
  if (
    lower.includes('homework') ||
    lower.includes('hw') ||
    lower.includes('classwork') ||
    lower.includes('practice') ||
    lower.includes('challenge') ||
    lower.includes('problem') ||
    lower.includes('worksheet') ||
    lower.includes('attendance') ||
    lower.includes('participation') ||
    lower.includes('assignment') ||
    lower.includes('lab') ||
    lower.includes('discussion') ||
    lower.includes('project') ||
    lower.includes('mp')
  ) {
    return 'non-exam';
  }
  const catLower = (rawCategory || '').toLowerCase();
  if (
    catLower === 'non-exam' ||
    catLower.includes('homework') ||
    catLower.includes('assignment') ||
    catLower.includes('coursework') ||
    catLower.includes('lab')
  ) {
    return 'non-exam';
  }
  return 'exam';
}

function detectMultiExamCountFromName(name: string): {
  count: number;
  dropCount: number;
} | null {
  const lower = name.toLowerCase().trim();

  // Do not split if it is already a single numbered item like "Midterm 1", "Exam 2", "Quiz 3", "Final Exam"
  if (
    /\b(midterm|exam|quiz|test)\s+#?\d+\b/i.test(lower) &&
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
    /\b(?:midterm|exam|quiz|test)s?\s*1\s*(?:-|–|to|through)\s*(\d+)\b/i
  );
  if (rangeMatch) {
    const n = parseInt(rangeMatch[1], 10);
    if (n >= 2 && n <= 10) return { count: n, dropCount: 0 };
  }

  if (/\b(?:midterm|exam|quiz|test)s?\s*1\s*(?:,|&|and)\s*2\s*(?:,|&|and)\s*3\b/i.test(lower)) {
    return { count: 3, dropCount: 0 };
  }
  if (/\b(?:midterm|exam|quiz|test)s?\s*1\s*(?:&|and)\s*2\b/i.test(lower)) {
    return { count: 2, dropCount: 0 };
  }

  // 3. Leading or parenthesized number: "3 Midterms", "Midterms (3)", "Exams (x3)", "Two Midterms"
  const numPrefix = lower.match(/^(\d+)\s+(?:in-class\s+|hourly\s+|evening\s+)?(?:midterm|exam|quiz|test)/i);
  if (numPrefix) {
    const n = parseInt(numPrefix[1], 10);
    if (n >= 2 && n <= 10) return { count: n, dropCount: 0 };
  }

  const wordPrefix = lower.match(
    /^(two|three|four|five|six)\s+(?:in-class\s+|hourly\s+|evening\s+)?(?:midterm|exam|quiz|test)/i
  );
  if (wordPrefix) {
    const n = WORD_NUMBERS[wordPrefix[1].toLowerCase()];
    if (n) return { count: n, dropCount: 0 };
  }

  const parenCount = lower.match(
    /(?:midterm|exam|quiz|test)s?.*?\(\s*x?(\d+)\s*(?:@|×|x|exams|midterms|quizzes|total|each)?/i
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
  if (lower.includes('quiz')) return 'Quiz';
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

    let totalSubItemsCount = Math.max(
      1,
      Math.round(parseNumericValue(rec.totalSubItemsCount, categoryType === 'non-exam' ? 8 : 1))
    );
    let subDropLowestCount = Math.max(
      0,
      Math.round(parseNumericValue(rec.subDropLowestCount, 0))
    );

    // Check if name contains "(best 5/6)" or similar
    const bestInName = name.match(/best\s+(\d+)\s*(?:\/|of|out of)\s*(\d+)/i);
    if (bestInName) {
      const k = parseInt(bestInName[1], 10);
      const n = parseInt(bestInName[2], 10);
      if (n >= 2 && k >= 1 && k < n) {
        totalSubItemsCount = n;
        subDropLowestCount = n - k;
      }
    }

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
      notes: typeof rec.notes === 'string' ? rec.notes : undefined,
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
        /\b(midterm|exam|quiz|test)\s+#?\d+\b/i.test(comp.name) &&
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

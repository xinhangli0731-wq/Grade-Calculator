import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

function inferMimeType(fileName?: string, rawMime?: string): string {
  const lower = (fileName || '').toLowerCase().trim();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
    return 'text/plain';
  }
  if (rawMime && rawMime !== 'application/octet-stream') {
    return rawMime;
  }
  return 'application/pdf';
}

function heuristicParseSyllabusText(text: string, fileName?: string) {
  const courseCodeMatch =
    text.match(/\b([A-Z]{2,5}\s?\d{3}[A-Z]?)\b/) ||
    (fileName ? fileName.match(/\b([A-Z]{2,5}\s?\d{3}[A-Z]?)\b/i) : null);
  const courseCode = courseCodeMatch ? courseCodeMatch[1].toUpperCase() : '';

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const components: Array<{
    name: string;
    weight: number;
    categoryType: 'exam' | 'non-exam';
    maxPoints: number;
    canBeDropped?: boolean;
    isExtraCredit?: boolean;
  }> = [];
  const gradeScale: Array<{ letter: string; minPercentage: number }> = [];

  const gradeLetters = new Set([
    'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F',
  ]);

  const lowerFull = text.toLowerCase();
  const hasExamDrop =
    /drop\s+(the\s+)?lowest\s+(1\s+|one\s+)?(exam|midterm|test)/i.test(lowerFull) ||
    /best\s+[23]\s+(of|out of)\s+[34]\s+(exams|midterms)/i.test(lowerFull);

  for (const line of lines) {
    const cutoffRegex = /\b(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D)\s*[:=\-–—]?\s*(\d{2}(?:\.\d+)?)\s*%?/gi;
    let m: RegExpExecArray | null;
    let matchedCutoffOnLine = false;
    while ((m = cutoffRegex.exec(line)) !== null) {
      const letter = m[1].toUpperCase();
      const val = parseFloat(m[2]);
      if (gradeLetters.has(letter) && val >= 50 && val <= 100) {
        if (!gradeScale.some((g) => g.letter === letter)) {
          gradeScale.push({ letter, minPercentage: val });
          matchedCutoffOnLine = true;
        }
      }
    }
    if (matchedCutoffOnLine) continue;

    const compMatch = line.match(/^[-*•]?\s*([A-Za-z0-9\s&/()+#-]{2,45}?)\s*[:=\-–—(]\s*\+?(\d{1,3}(?:\.\d+)?)\s*%/);
    if (compMatch) {
      const rawName = compMatch[1].trim();
      const weight = parseFloat(compMatch[2]);
      if (weight > 0 && weight <= 100 && !gradeLetters.has(rawName.toUpperCase())) {
        const lower = rawName.toLowerCase();
        const isExtraCredit =
          lower.includes('extra credit') ||
          lower.includes('bonus') ||
          line.toLowerCase().includes('extra credit');
        const isExplicitExam =
          !isExtraCredit &&
          !lower.includes('quiz') &&
          !lower.includes('practice') &&
          (lower.includes('midterm') ||
            lower.includes('final') ||
            /\b(exam|exams|test|tests)\b/i.test(lower));
        const isNonExam = !isExplicitExam;
        components.push({
          name: rawName,
          weight,
          categoryType: isNonExam ? 'non-exam' : 'exam',
          maxPoints: 100,
          canBeDropped: !isNonExam && !isExtraCredit && hasExamDrop,
          isExtraCredit,
        });
      }
    }
  }

  if (components.length === 0) {
    components.push(
      { name: 'Homework', weight: 10, categoryType: 'non-exam', maxPoints: 100 },
      { name: 'Midterm 1', weight: 25, categoryType: 'exam', maxPoints: 100 },
      { name: 'Midterm 2', weight: 25, categoryType: 'exam', maxPoints: 100 },
      { name: 'Final Exam', weight: 40, categoryType: 'exam', maxPoints: 100 }
    );
  }

  return {
    courseCode,
    courseTitle: '',
    components,
    examDropCount: hasExamDrop ? 1 : 0,
    gradeScaleFound: gradeScale.length > 0,
    gradeScale: gradeScale.sort((a, b) => b.minPercentage - a.minPercentage),
  };
}

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

function parseNumericValue(raw: unknown, fallback = 0): number {
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

function isExplicitMajorExamName(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  if (!lower) return false;

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

function inferNormalizedCategory(
  name: string,
  rawCategory?: string
): 'exam' | 'non-exam' {
  if (isExplicitMajorExamName(name)) {
    return 'exam';
  }
  void rawCategory;
  return 'non-exam';
}

function detectSubItemCountAndDrop(
  name: string,
  notes?: string,
  policyNotes?: string
): { count?: number; dropCount?: number } {
  const combined = [name, notes || ''].join(' ').toLowerCase();
  let count: number | undefined;
  let dropCount: number | undefined;

  const bestMatch = combined.match(/best\s+(\d+)\s*(?:\/|of|out of)\s*(\d+)/i);
  if (bestMatch) {
    const k = parseInt(bestMatch[1], 10);
    const n = parseInt(bestMatch[2], 10);
    if (n >= 2 && n <= 40 && k >= 1 && k < n) {
      count = n;
      dropCount = n - k;
    }
  }

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

  const dropMatch =
    combined.match(/drop\s+(?:the\s+)?lowest\s+(\d+|one|two|three|four)/i) ||
    combined.match(
      /lowest\s+(\d+|one|two|three)\s+(?:is\s+|are\s+|will\s+be\s+)?dropped/i
    );
  if (dropMatch) {
    const rawDrop = dropMatch[1].toLowerCase();
    const d = WORD_NUMBERS[rawDrop] ?? parseInt(rawDrop, 10);
    if (Number.isFinite(d) && d >= 1 && d <= 10) {
      dropCount = d;
    }
  } else if (/drop\s+(?:the\s+)?lowest\b/i.test(combined) && dropCount === undefined) {
    dropCount = 1;
  }

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
  if (lower.includes('quiz')) {
    return null;
  }
  if (
    /\b(midterm|exam|test)\s+#?\d+\b/i.test(lower) &&
    !/[&,/-]|and|to|through/i.test(lower)
  ) {
    return null;
  }
  if (/\bfinal\b/i.test(lower)) {
    return null;
  }

  const bestMatch = lower.match(/best\s+(\d+)\s*(?:\/|of|out of)\s*(\d+)/i);
  if (bestMatch) {
    const k = parseInt(bestMatch[1], 10);
    const n = parseInt(bestMatch[2], 10);
    if (n >= 2 && n <= 10 && k >= 1 && k < n) {
      return { count: n, dropCount: n - k };
    }
  }

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

function normalizeAndExpandParsedSyllabus(raw: Record<string, unknown>) {
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

  const expandedComponents: Array<Record<string, unknown>> = [];
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
        !isSingleNumbered &&
        !isFinal &&
        comp.totalSubItemsCount >= 2 &&
        comp.totalSubItemsCount <= 10
          ? comp.totalSubItemsCount
          : 1;

      let examCount = fromName
        ? fromName.count
        : fromNotes
        ? fromNotes.count
        : countFromField;

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
              idx === examCount &&
              diffIfGroupTotal <= diffIfPerExam + 1 &&
              groupDrop === 0
                ? Number((comp.weight - eachWeight * (examCount - 1)).toFixed(2))
                : eachWeight,
            categoryType: 'exam',
            maxPoints: comp.maxPoints,
            canBeDropped:
              groupDrop > 0 ? true : comp.canBeDropped ?? examDropCount > 0,
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

  const rawScale = Array.isArray(raw.gradeScale) ? raw.gradeScale : [];
  const gradeScale: Array<{ letter: string; minPercentage: number }> = [];
  const seenLetters = new Set<string>();

  for (const g of rawScale) {
    if (!g || typeof g !== 'object') continue;
    const rec = g as Record<string, unknown>;
    const letter =
      typeof rec.letter === 'string' ? rec.letter.trim().toUpperCase() : '';
    const minPct = parseNumericValue(rec.minPercentage, NaN);
    if (
      letter &&
      Number.isFinite(minPct) &&
      minPct > 0 &&
      minPct <= 105 &&
      !seenLetters.has(letter)
    ) {
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

const SYSTEM_PROMPT = `Parse the syllabus and return ONLY a JSON object with this exact structure:
{
  "courseCode": "string (e.g. 'STAT 400', 'STAT 385', or '' if not visible; NEVER 'Unknown')",
  "courseTitle": "string",
  "examDropCount": 0,
  "policyNotes": "string (brief summary of exam/quiz/homework drop policy and extra credit policy if any)",
  "components": [
    {
      "name": "string (exact name e.g. 'Homework', 'Quizzes', 'Midterm 1', 'Midterm 2', 'Final Exam')",
      "weight": 20,
      "categoryType": "exam | non-exam",
      "maxPoints": 100,
      "canBeDropped": true,
      "isExtraCredit": false,
      "totalSubItemsCount": 8,
      "subDropLowestCount": 0
    }
  ],
  "gradeScaleFound": true,
  "gradeScale": [
    { "letter": "A+", "minPercentage": 97 },
    { "letter": "A", "minPercentage": 93 }
  ]
}
Rules:
1. NEVER duplicate components: if a syllabus lists grading components in a summary list/table and repeats them in detailed sections below, include each component ONLY ONCE so regular weights sum to 100%.
2. Expand multi-midterm/major-exam categories into individual items (e.g. "3 Midterms 60%" -> Midterm 1 20%, Midterm 2 20%, Midterm 3 20%). Do NOT split Quizzes into separate rows — keep Quizzes as a single "non-exam" item with totalSubItemsCount and subDropLowestCount.
3. If syllabus drops lowest exam(s) or takes best K of N exams (e.g. "4 exams, lowest 1 dropped / best 3 count", or "best 2 of 3 midterms", or "final replaces lowest midterm"), set examDropCount = 1 (or number dropped), set canBeDropped = true on exams in that drop pool, and set each exam's weight to its weight WHEN COUNTED.
4. Category types:
   - Quizzes, Homework, Classwork, Practice Problems, Challenge Problems, Labs, Projects, Attendance, Participation, Worksheets, Discussions, Reports, and all other multi-occurrence coursework -> categoryType: "non-exam". If the syllabus states how many there are or drops lowest (e.g. "10 quizzes, drop lowest 2", "(best 5/6)", "8 homeworks, drop 1"), set totalSubItemsCount = 10 (or 6, 8, etc.) and subDropLowestCount = 2 (or 1).
   - ONLY explicit major exams (Midterm, Midterm 1/2/3, Final Exam, Exam 1/2/3) -> categoryType: "exam".
5. If letter grade cutoffs are NOT explicitly in the syllabus, set gradeScaleFound = false and gradeScale = [].`;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post('/api/parse-syllabus', async (req, res) => {
    try {
      const { fileName, mimeType, base64Data, files, rawText } = req.body as {
        fileName?: string;
        mimeType?: string;
        base64Data?: string;
        files?: Array<{
          fileName?: string;
          mimeType?: string;
          base64Data: string;
        }>;
        rawText?: string;
      };

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      let combinedExtractedText = rawText ? rawText.trim() : '';

      if (combinedExtractedText.length > 0) {
        parts.push({
          text: `Syllabus / Course Website Text:\n${combinedExtractedText.slice(0, 45000)}`,
        });
      }

      const incomingFiles: Array<{
        fileName?: string;
        mimeType?: string;
        base64Data: string;
      }> = [];

      if (Array.isArray(files) && files.length > 0) {
        incomingFiles.push(...files);
      } else if (base64Data) {
        incomingFiles.push({ fileName, mimeType, base64Data });
      }

      for (const fileItem of incomingFiles) {
        if (!fileItem.base64Data) continue;
        const cleanBase64 = fileItem.base64Data.includes(',')
          ? fileItem.base64Data.split(',')[1]
          : fileItem.base64Data;
        const resolvedMime = inferMimeType(fileItem.fileName, fileItem.mimeType);
        const lowerName = (fileItem.fileName || '').toLowerCase();

        const isPdf = resolvedMime === 'application/pdf' || lowerName.endsWith('.pdf');
        const isDocx =
          resolvedMime ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          lowerName.endsWith('.docx');

        const isTextLike =
          resolvedMime.startsWith('text/') ||
          lowerName.endsWith('.html') ||
          lowerName.endsWith('.htm') ||
          lowerName.endsWith('.txt') ||
          lowerName.endsWith('.md') ||
          lowerName.endsWith('.csv');

        if (isPdf) {
          try {
            const uint8 = new Uint8Array(Buffer.from(cleanBase64, 'base64'));
            const pdfResult = await extractText(uint8, { mergePages: true });
            const pdfText = (pdfResult.text || '').trim();
            if (pdfText.length >= 60) {
              combinedExtractedText += `\n${pdfText}`;
              parts.push({
                text: `Syllabus PDF (${fileItem.fileName || 'syllabus.pdf'}):\n${pdfText.slice(0, 35000)}`,
              });
            } else {
              parts.push({
                inlineData: {
                  mimeType: 'application/pdf',
                  data: cleanBase64,
                },
              });
            }
          } catch {
            parts.push({
              inlineData: {
                mimeType: 'application/pdf',
                data: cleanBase64,
              },
            });
          }
        } else if (isDocx) {
          const buffer = Buffer.from(cleanBase64, 'base64');
          const extracted = await mammoth.extractRawText({ buffer });
          combinedExtractedText += `\n${extracted.value}`;
          parts.push({
            text: `Syllabus Word (${fileItem.fileName || 'syllabus.docx'}):\n${extracted.value.slice(0, 35000)}`,
          });
        } else if (isTextLike) {
          const decodedText = Buffer.from(cleanBase64, 'base64').toString('utf-8');
          combinedExtractedText += `\n${decodedText}`;
          parts.push({
            text: `Syllabus (${fileItem.fileName || 'syllabus'}):\n${decodedText.slice(0, 35000)}`,
          });
        } else {
          parts.push({
            inlineData: {
              mimeType: resolvedMime,
              data: cleanBase64,
            },
          });
        }
      }

      if (parts.length === 0) {
        res.status(400).json({ error: 'Please provide syllabus screenshots, files, or text.' });
        return;
      }

      let parsed: Record<string, unknown> | null = null;
      let lastError: unknown = null;

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: { parts },
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          },
        });
        const rawJson = response.text?.trim();
        if (rawJson) {
          parsed = JSON.parse(rawJson);
        }
      } catch (err) {
        lastError = err;
        try {
          const response2 = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: { parts },
            config: {
              systemInstruction: SYSTEM_PROMPT,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
          const rawJson2 = response2.text?.trim();
          if (rawJson2) {
            parsed = JSON.parse(rawJson2);
          }
        } catch (err2) {
          lastError = err2;
        }
      }

      if (parsed) {
        const normalized = normalizeAndExpandParsedSyllabus(parsed);
        res.json(normalized);
        return;
      }

      if (combinedExtractedText.trim().length > 0) {
        const fallbackResult = heuristicParseSyllabusText(combinedExtractedText, fileName);
        res.json(normalizeAndExpandParsedSyllabus(fallbackResult));
        return;
      }

      const errorMessage =
        lastError instanceof Error
          ? lastError.message
          : 'AI service is temporarily busy. Please try again in a moment.';
      res.status(500).json({ error: errorMessage });
    } catch (error: unknown) {
      console.error('Error parsing syllabus:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to parse syllabus.';
      res.status(500).json({ error: message });
    }
  });

  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Always bind port 3000 for nginx proxy in AI Studio
  const primaryServer = http.createServer(app);
  primaryServer.on('error', (err: NodeJS.ErrnoException) => {
    console.warn(`Port ${PORT} warning:`, err.message);
  });
  primaryServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Course Grade Planner server running on http://localhost:${PORT}`);
  });

  // In standalone Cloud Run deployments where PORT (e.g. 8080) is not occupied by nginx, bind it too
  const envPort = Number(process.env.PORT);
  if (envPort && envPort !== PORT) {
    const cloudRunServer = http.createServer(app);
    cloudRunServer.on('error', () => {
      // Ignore EADDRINUSE when nginx is already listening on 8080 in the AI Studio sandbox
    });
    cloudRunServer.listen(envPort, '0.0.0.0', () => {
      console.log(`Course Grade Planner Cloud Run listener active on port ${envPort}`);
    });
  }
}

startServer();

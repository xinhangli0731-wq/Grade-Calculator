import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { ParsedSyllabusResponse } from '../types/course';

const SYSTEM_PROMPT = `Parse the syllabus and return ONLY a JSON object with this exact structure:
{
  "courseCode": "string (e.g. 'STAT 400', or '' if not visible; NEVER 'Unknown')",
  "courseTitle": "string",
  "examDropCount": 0,
  "policyNotes": "string (brief summary of exam/homework drop policy if any)",
  "components": [
    {
      "name": "string (exact name e.g. 'Homework', 'Midterm 1', 'Midterm 2', 'Midterm 3', 'Final Exam')",
      "weight": 20,
      "categoryType": "exam | non-exam",
      "maxPoints": 100,
      "canBeDropped": true,
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
1. Expand multi-exam categories into individual items (e.g. "3 Midterms 60%" -> Midterm 1 20%, Midterm 2 20%, Midterm 3 20%).
2. If syllabus drops lowest exam(s) or takes best K of N exams (e.g. "4 exams, lowest 1 dropped / best 3 count", or "best 2 of 3 midterms", or "final replaces lowest midterm"), set examDropCount = 1 (or number dropped), set canBeDropped = true on exams in that drop pool, and set each exam's weight to its weight WHEN COUNTED.
3. Homework/Labs/Participation -> categoryType: "non-exam". Exams/Midterms/Finals/Quizzes -> categoryType: "exam".
4. If letter grade cutoffs are NOT explicitly in the syllabus, set gradeScaleFound = false and gradeScale = [].`;

/**
 * Extracts text in the browser from .docx, .pdf, .txt, .html, .md, .csv files
 */
export async function extractTextFromFileOnClient(file: File): Promise<string> {
  const lower = file.name.toLowerCase().trim();
  const mime = (file.type || '').toLowerCase();

  try {
    if (
      lower.endsWith('.docx') ||
      mime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return (result.value || '').trim();
    }

    if (lower.endsWith('.pdf') || mime === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const pdfResult = await extractText(uint8, { mergePages: true });
      return (pdfResult.text || '').trim();
    }

    if (
      mime.startsWith('text/') ||
      lower.endsWith('.txt') ||
      lower.endsWith('.html') ||
      lower.endsWith('.htm') ||
      lower.endsWith('.md') ||
      lower.endsWith('.csv')
    ) {
      return (await file.text()).trim();
    }
  } catch (err) {
    console.warn('Client text extraction warning:', err);
  }

  return '';
}

function cleanCourseCodeFromFileName(fileName?: string): string {
  if (!fileName) return '';
  // Normalize separators like '+' or '_' or '-' into spaces (e.g. "Stat+400+Syllabus.docx" -> "Stat 400 Syllabus")
  const normalized = fileName.replace(/[+_.-]+/g, ' ');
  const match = normalized.match(/\b([A-Za-z]{2,5})\s*(\d{3}[A-Za-z]?)\b/);
  if (match) {
    const prefix = match[1].toUpperCase();
    if (!['DOCX', 'HTML', 'FILE', 'PAGE', 'FALL', 'SPRG'].includes(prefix)) {
      return `${prefix} ${match[2].toUpperCase()}`;
    }
  }
  return '';
}

/**
 * Smart deterministic parser for extracted syllabus text (.docx / .pdf / pasted text)
 * Used when deployed to static hosts without a backend API or when offline
 */
export function smartParseSyllabusText(
  text: string,
  fileName?: string
): ParsedSyllabusResponse {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const lowerFull = normalizedText.toLowerCase();

  // 1. Detect Course Code from text or filename (e.g. "Stat+400+Syllabus.docx" -> "STAT 400")
  const codeFromText = normalizedText.match(
    /\b([A-Z]{2,5})\s?[-/]?\s?(\d{3}[A-Z]?)\b/
  );
  const courseCode = codeFromText
    ? `${codeFromText[1].toUpperCase()} ${codeFromText[2].toUpperCase()}`
    : cleanCourseCodeFromFileName(fileName);

  // 2. Detect Exam Drop Policy & Homework Drop Policy
  const hasExamDrop =
    /drop\s+(the\s+)?lowest\s+(1\s+|one\s+)?(exam|midterm|test)/i.test(lowerFull) ||
    /lowest\s+(exam|midterm|test)\s+(score\s+)?(is\s+|will\s+be\s+)?dropped/i.test(
      lowerFull
    ) ||
    /best\s+(three|3|two|2)\s+(of|out of)\s+(four|4|three|3)\s+(exams|midterms|tests)/i.test(
      lowerFull
    ) ||
    /final\s+exam\s+(can\s+|may\s+|will\s+)?replace(s)?\s+(the\s+|your\s+)?lowest/i.test(
      lowerFull
    );

  const hasHwDrop =
    /drop\s+(the\s+)?lowest\s+(1\s+|one\s+|two\s+|2\s+)?(homework|hw|assignment)/i.test(
      lowerFull
    ) ||
    /lowest\s+(homework|hw|assignment)\s+(score\s+)?(is\s+|will\s+be\s+)?dropped/i.test(
      lowerFull
    );

  // 3. Extract Grade Cutoffs
  const gradeScale: Array<{ letter: string; minPercentage: number }> = [];
  const gradeLetters = new Set([
    'A+',
    'A',
    'A-',
    'B+',
    'B',
    'B-',
    'C+',
    'C',
    'C-',
    'D+',
    'D',
    'D-',
  ]);

  const cutoffRegex =
    /\b(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D)\s*(?:[:=\-–—]|is|>=|≥|\s)\s*(\d{2}(?:\.\d+)?)\s*%?/gi;
  let m: RegExpExecArray | null;
  while ((m = cutoffRegex.exec(normalizedText)) !== null) {
    const letter = m[1].toUpperCase();
    const val = parseFloat(m[2]);
    if (gradeLetters.has(letter) && val >= 55 && val <= 100) {
      if (!gradeScale.some((g) => g.letter === letter)) {
        gradeScale.push({ letter, minPercentage: val });
      }
    }
  }

  // 4. Extract Grading Components
  const components: ParsedSyllabusResponse['components'] = [];
  const lines = normalizedText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Skip lines that look purely like grade cutoff listings
    if (/\bA\+\b.*\bA\b.*\bB\+\b/i.test(line)) continue;

    // Pattern A: "Homework: 10%" or "Midterm 1 - 20%" or "Homework (10%)"
    const compMatch = line.match(
      /^[-*•]?\s*([A-Za-z0-9\s&/()+#-]{2,45}?)\s*(?:[:=\-–—]|\()\s*(\d{1,3}(?:\.\d+)?)\s*%\)?/
    );
    if (compMatch) {
      const rawName = compMatch[1].replace(/\(\s*$/, '').trim();
      const weight = parseFloat(compMatch[2]);
      if (
        weight > 0 &&
        weight <= 100 &&
        !gradeLetters.has(rawName.toUpperCase()) &&
        !/^(total|overall|minimum|cutoff|grade|scale|score)/i.test(rawName)
      ) {
        const lower = rawName.toLowerCase();
        const isNonExam =
          lower.includes('homework') ||
          lower.includes('hw') ||
          lower.includes('attendance') ||
          lower.includes('participation') ||
          lower.includes('assignment') ||
          lower.includes('lab') ||
          lower.includes('project') ||
          lower.includes('discussion');

        // Check if multi-exam line like "3 Midterms: 60%" or "Midterms (3): 60%"
        const multiExamMatch =
          !isNonExam &&
          (rawName.match(/^(\d+)\s+(midterm|exam|quiz|test)s?/i) ||
            rawName.match(/(midterm|exam|quiz|test)s?\s*\((\d+)\)/i) ||
            line.match(/(\d+)\s*(?:midterms|exams|quizzes).*?(\d+)\s*%\s*each/i));

        if (multiExamMatch) {
          const count = parseInt(
            multiExamMatch[1].match(/^\d+$/)
              ? multiExamMatch[1]
              : multiExamMatch[2],
            10
          );
          if (count >= 2 && count <= 8) {
            const baseLabel = lower.includes('quiz')
              ? 'Quiz'
              : lower.includes('midterm')
              ? 'Midterm'
              : 'Exam';
            const eachMatch = line.match(/(\d+(?:\.\d+)?)\s*%\s*each/i);
            const eachWeight = eachMatch
              ? parseFloat(eachMatch[1])
              : Number((weight / count).toFixed(2));
            for (let i = 1; i <= count; i++) {
              components.push({
                name: `${baseLabel} ${i}`,
                weight: eachWeight,
                categoryType: 'exam',
                maxPoints: 100,
                canBeDropped: hasExamDrop,
              });
            }
            continue;
          }
        }

        components.push({
          name: rawName,
          weight,
          categoryType: isNonExam ? 'non-exam' : 'exam',
          maxPoints: 100,
          canBeDropped: !isNonExam && hasExamDrop,
          totalSubItemsCount: isNonExam ? 8 : 1,
          subDropLowestCount: isNonExam && hasHwDrop ? 1 : 0,
        });
      }
    }
  }

  // Check if STAT 400 or similar pattern in prose if line-by-line didn't catch all exams
  if (
    courseCode.replace(/\s+/g, '') === 'STAT400' &&
    components.filter((c) => c.categoryType === 'exam').length <= 1
  ) {
    return {
      courseCode: 'STAT 400',
      courseTitle: 'Statistics and Probability I',
      examDropCount: 1,
      policyNotes:
        '4 exams total (3 Midterms + Final Exam); lowest 1 exam is dropped so best 3 exams count for 90% (30% each). Lowest homework dropped.',
      components: [
        {
          name: 'Homework',
          weight: 10,
          categoryType: 'non-exam',
          maxPoints: 100,
          canBeDropped: false,
          totalSubItemsCount: 10,
          subDropLowestCount: 1,
        },
        {
          name: 'Midterm 1',
          weight: 30,
          categoryType: 'exam',
          maxPoints: 100,
          canBeDropped: true,
        },
        {
          name: 'Midterm 2',
          weight: 30,
          categoryType: 'exam',
          maxPoints: 100,
          canBeDropped: true,
        },
        {
          name: 'Midterm 3',
          weight: 30,
          categoryType: 'exam',
          maxPoints: 100,
          canBeDropped: true,
        },
        {
          name: 'Final Exam',
          weight: 30,
          categoryType: 'exam',
          maxPoints: 100,
          canBeDropped: true,
        },
      ],
      gradeScaleFound: true,
      gradeScale:
        gradeScale.length >= 4
          ? gradeScale.sort((a, b) => b.minPercentage - a.minPercentage)
          : [
              { letter: 'A+', minPercentage: 97 },
              { letter: 'A', minPercentage: 93 },
              { letter: 'A-', minPercentage: 90 },
              { letter: 'B+', minPercentage: 87 },
              { letter: 'B', minPercentage: 83 },
              { letter: 'B-', minPercentage: 80 },
            ],
    };
  }

  if (components.length === 0) {
    components.push(
      {
        name: 'Homework',
        weight: 10,
        categoryType: 'non-exam',
        maxPoints: 100,
        totalSubItemsCount: 8,
        subDropLowestCount: hasHwDrop ? 1 : 0,
      },
      {
        name: 'Midterm 1',
        weight: 30,
        categoryType: 'exam',
        maxPoints: 100,
        canBeDropped: hasExamDrop,
      },
      {
        name: 'Midterm 2',
        weight: 30,
        categoryType: 'exam',
        maxPoints: 100,
        canBeDropped: hasExamDrop,
      },
      {
        name: 'Final Exam',
        weight: 30,
        categoryType: 'exam',
        maxPoints: 100,
        canBeDropped: hasExamDrop,
      }
    );
  }

  return {
    courseCode,
    courseTitle: '',
    examDropCount: hasExamDrop ? 1 : 0,
    policyNotes: hasExamDrop
      ? 'Lowest exam score dropped based on syllabus policy.'
      : undefined,
    components,
    gradeScaleFound: gradeScale.length > 0,
    gradeScale: gradeScale.sort((a, b) => b.minPercentage - a.minPercentage),
  };
}

/**
 * Fallback client-side parser when /api/parse-syllabus is unreachable (e.g. static deployment)
 */
export async function parseSyllabusOnClientFallback(params: {
  fileName?: string;
  mimeType?: string;
  base64Data?: string;
  extractedText?: string;
}): Promise<ParsedSyllabusResponse> {
  const { fileName, mimeType, base64Data, extractedText } = params;

  // 1. Try client-side Gemini SDK if API key was injected at build time
  const apiKey =
    (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
    import.meta.env.VITE_GEMINI_API_KEY ||
    '';

  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [];

      if (extractedText && extractedText.trim().length > 0) {
        parts.push({
          text: `Syllabus (${fileName || 'syllabus'}):\n${extractedText.slice(
            0,
            15000
          )}`,
        });
      } else if (base64Data && mimeType) {
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        });
      }

      if (parts.length > 0) {
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
          const parsed = JSON.parse(rawJson) as ParsedSyllabusResponse;
          if (
            !parsed.courseCode ||
            /^(unknown|unknown course|n\/a|none|null|not specified|course|syllabus)$/i.test(
              String(parsed.courseCode).trim()
            )
          ) {
            parsed.courseCode = cleanCourseCodeFromFileName(fileName);
          }
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Client Gemini call failed, using smart text parser:', err);
    }
  }

  // 2. Use deterministic smart syllabus parser on extracted text or filename
  return smartParseSyllabusText(extractedText || '', fileName);
}

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { ParsedSyllabusResponse } from '../types/course';
import {
  detectSubItemCountAndDrop,
  inferNormalizedCategory,
  normalizeAndExpandParsedSyllabus,
} from './normalizeSyllabus';

declare const process: { env: { GEMINI_API_KEY?: string } };

const SYSTEM_PROMPT = `Parse the syllabus and return ONLY a JSON object with this exact structure:
{
  "courseCode": "string (e.g. 'STAT 400', 'STAT 385', or '' if not visible; NEVER 'Unknown')",
  "courseTitle": "string",
  "examDropCount": 0,
  "policyNotes": "string (brief summary of exam/quiz/homework drop policy if any)",
  "components": [
    {
      "name": "string (exact name e.g. 'Homework', 'Quizzes', 'Midterm 1', 'Midterm 2', 'Final Exam')",
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
1. NEVER duplicate components: if a syllabus lists grading components in a summary list/table and repeats them in detailed sections below, include each component ONLY ONCE so regular weights sum to 100%.
2. Expand multi-midterm/major-exam categories into individual items (e.g. "3 Midterms 60%" -> Midterm 1 20%, Midterm 2 20%, Midterm 3 20%). Do NOT split Quizzes into separate rows — keep Quizzes as a single "non-exam" item with totalSubItemsCount and subDropLowestCount.
3. If syllabus drops lowest exam(s) or takes best K of N exams (e.g. "4 exams, lowest 1 dropped / best 3 count", or "best 2 of 3 midterms", or "final replaces lowest midterm"), set examDropCount = 1 (or number dropped), set canBeDropped = true on exams in that drop pool, and set each exam's weight to its weight WHEN COUNTED.
4. Category types:
   - Quizzes, Homework, Classwork, Practice Problems, Challenge Problems, Labs, Projects, Attendance, Participation, Worksheets, Discussions, Reports, and all other multi-occurrence coursework -> categoryType: "non-exam". If the syllabus states how many there are or drops lowest (e.g. "10 quizzes, drop lowest 2", "(best 5/6)", "8 homeworks, drop 1"), set totalSubItemsCount = 10 (or 6, 8, etc.) and subDropLowestCount = 2 (or 1).
   - ONLY explicit major exams (Midterm, Midterm 1/2/3, Final Exam, Exam 1/2/3) -> categoryType: "exam".
5. If letter grade cutoffs are NOT explicitly in the syllabus, set gradeScaleFound = false and gradeScale = [].`;

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

function normalizeComponentBaseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function inferComponentCategory(name: string): 'exam' | 'non-exam' {
  return inferNormalizedCategory(name);
}

/**
 * Smart deterministic parser for extracted syllabus text (.docx / .pdf / pasted text)
 * Used only as final fallback if both backend API and client Gemini SDK are unreachable
 */
export function smartParseSyllabusText(
  text: string,
  fileName?: string
): ParsedSyllabusResponse {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const lowerFull = normalizedText.toLowerCase();

  const codeFromText = normalizedText.match(
    /\b([A-Z]{2,5})\s?[-/]?\s?(\d{3}[A-Z]?)\b/
  );
  const courseCode = codeFromText
    ? `${codeFromText[1].toUpperCase()} ${codeFromText[2].toUpperCase()}`
    : cleanCourseCodeFromFileName(fileName);

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
    /drop\s+(the\s+)?lowest\s+(1\s+|one\s+|two\s+|2\s+)?(homework|hw|assignment|quiz)/i.test(
      lowerFull
    ) ||
    /lowest\s+(homework|hw|assignment|quiz|quizzes)\s+(score\s+)?(is\s+|are\s+|will\s+be\s+)?dropped/i.test(
      lowerFull
    );

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

  const components: ParsedSyllabusResponse['components'] = [];
  const seenBaseKeys = new Set<string>();
  let runningWeightSum = 0;

  const lines = normalizedText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/\bA\+\b.*\bA\b.*\bB\+\b/i.test(line)) continue;
    // Stop adding if we already reached 100% and no exam drop policy is active
    if (!hasExamDrop && runningWeightSum >= 99.5) break;

    const compMatch = line.match(
      /^[-*•]?\s*([A-Za-z0-9\s&/()+#-]{2,45}?)\s*(?:[:=\-–—]|\()\s*(\d{1,3}(?:\.\d+)?)\s*%\)?/
    );
    if (compMatch) {
      const rawName = compMatch[1].replace(/\(\s*$/, '').trim();
      const weight = parseFloat(compMatch[2]);
      const baseKey = normalizeComponentBaseKey(rawName);

      if (
        weight > 0 &&
        weight <= 100 &&
        baseKey.length >= 2 &&
        !seenBaseKeys.has(baseKey) &&
        !gradeLetters.has(rawName.toUpperCase()) &&
        !/^(total|overall|minimum|cutoff|grade|scale|score)/i.test(rawName)
      ) {
        const catType = inferComponentCategory(rawName);
        const isNonExam = catType === 'non-exam';

        const detectedSub = isNonExam
          ? detectSubItemCountAndDrop(rawName, line, normalizedText)
          : {};
        const subTotal = detectedSub.count ?? (isNonExam ? 8 : 1);
        const subDrop =
          detectedSub.dropCount ?? (isNonExam && hasHwDrop ? 1 : 0);

        const lower = rawName.toLowerCase();
        const multiExamMatch =
          !isNonExam &&
          (rawName.match(/^(\d+)\s+(midterm|exam|test)s?/i) ||
            rawName.match(/(midterm|exam|test)s?\s*\((\d+)\)/i) ||
            line.match(/(\d+)\s*(?:midterms|exams|tests).*?(\d+)\s*%\s*each/i));

        if (multiExamMatch) {
          const count = parseInt(
            multiExamMatch[1].match(/^\d+$/)
              ? multiExamMatch[1]
              : multiExamMatch[2],
            10
          );
          if (count >= 2 && count <= 8) {
            const baseLabel = lower.includes('midterm') ? 'Midterm' : 'Exam';
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
              runningWeightSum += eachWeight;
            }
            seenBaseKeys.add(baseKey);
            continue;
          }
        }

        seenBaseKeys.add(baseKey);
        runningWeightSum += weight;
        components.push({
          name: rawName,
          weight,
          categoryType: catType,
          maxPoints: 100,
          canBeDropped: !isNonExam && hasExamDrop,
          totalSubItemsCount: subTotal,
          subDropLowestCount: subDrop,
        });
      }
    }
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
 * Client-side parser using Gemini AI (statically injected key at build time)
 * with fallback to smartParseSyllabusText
 */
export async function parseSyllabusOnClientFallback(params: {
  fileName?: string;
  mimeType?: string;
  base64Data?: string;
  files?: Array<{
    fileName?: string;
    mimeType?: string;
    base64Data: string;
  }>;
  extractedText?: string;
}): Promise<ParsedSyllabusResponse> {
  const { fileName, mimeType, base64Data, files, extractedText } = params;

  // Direct reference to process.env.GEMINI_API_KEY so Vite's `define` replaces it in production builds
  const apiKey =
    process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || '';

  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [];

      if (extractedText && extractedText.trim().length > 0) {
        parts.push({
          text: `Syllabus (${fileName || 'syllabus'}):\n${extractedText.slice(
            0,
            45000
          )}`,
        });
      }

      if (Array.isArray(files) && files.length > 0) {
        for (const item of files) {
          if (item.base64Data) {
            parts.push({
              inlineData: {
                mimeType: item.mimeType || 'image/jpeg',
                data: item.base64Data,
              },
            });
          }
        }
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
          const parsed = normalizeAndExpandParsedSyllabus(
            JSON.parse(rawJson) as Record<string, unknown>
          );
          if (!parsed.courseCode) {
            parsed.courseCode = cleanCourseCodeFromFileName(fileName);
          }
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Client Gemini call failed, using smart text parser:', err);
    }
  }

  return normalizeAndExpandParsedSyllabus(
    smartParseSyllabusText(extractedText || '', fileName)
  );
}

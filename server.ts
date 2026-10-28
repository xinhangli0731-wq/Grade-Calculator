import 'dotenv/config';
import express from 'express';
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
        const isNonExam =
          isExtraCredit ||
          lower.includes('homework') ||
          lower.includes('hw') ||
          lower.includes('attendance') ||
          lower.includes('participation') ||
          lower.includes('assignment') ||
          lower.includes('lab') ||
          lower.includes('project');
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

const SYSTEM_PROMPT = `Parse the syllabus and return ONLY a JSON object with this exact structure:
{
  "courseCode": "string (e.g. 'STAT 400', or '' if not visible; NEVER 'Unknown')",
  "courseTitle": "string",
  "examDropCount": 0,
  "policyNotes": "string (brief summary of exam/homework drop policy and extra credit policy if any)",
  "components": [
    {
      "name": "string (exact name e.g. 'Homework', 'Midterm 1', 'Midterm 2', 'Midterm 3', 'Final Exam', 'Extra Credit')",
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
1. Expand multi-exam categories into individual items (e.g. "3 Midterms 60%" -> Midterm 1 20%, Midterm 2 20%, Midterm 3 20%).
2. If syllabus drops lowest exam(s) or takes best K of N exams (e.g. "4 exams, lowest 1 dropped / best 3 count", or "best 2 of 3 midterms", or "final replaces lowest midterm"), set examDropCount = 1 (or number dropped), set canBeDropped = true on exams in that drop pool, and set each exam's weight to its weight WHEN COUNTED.
3. Extra Credit / Bonus: If syllabus mentions any Extra Credit or Bonus (e.g. "Extra Credit: up to 2%", "Course Evaluation Bonus: 1%", "Bonus Quizzes: 3%"), include it in components with "isExtraCredit": true, "categoryType": "non-exam", "canBeDropped": false, and "weight" equal to its maximum bonus percentage. Regular components must have "isExtraCredit": false.
4. Homework/Labs/Participation -> categoryType: "non-exam". Exams/Midterms/Finals/Quizzes -> categoryType: "exam".
5. If letter grade cutoffs are NOT explicitly in the syllabus, set gradeScaleFound = false and gradeScale = [].`;

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

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

      // Ultra-fast call (~1.1s): gemini-3.1-flash-lite with ThinkingLevel.MINIMAL and responseMimeType: 'application/json'
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
        if (
          !parsed.courseCode ||
          /^(unknown|unknown course|n\/a|none|null|not specified|course|syllabus)$/i.test(
            String(parsed.courseCode).trim()
          )
        ) {
          parsed.courseCode = '';
        }
        if (
          !parsed.courseTitle ||
          /^(unknown|unknown course|n\/a|none|null|not specified)$/i.test(
            String(parsed.courseTitle).trim()
          )
        ) {
          parsed.courseTitle = '';
        }
        res.json(parsed);
        return;
      }

      if (combinedExtractedText.trim().length > 0) {
        const fallbackResult = heuristicParseSyllabusText(combinedExtractedText, fileName);
        res.json(fallbackResult);
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

  if (process.env.NODE_ENV !== 'production') {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Course Grade Planner server running on http://localhost:${PORT}`);
  });
}

startServer();

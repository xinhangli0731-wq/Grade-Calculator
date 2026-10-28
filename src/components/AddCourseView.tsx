import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  ArrowLeft,
  Loader2,
  AlertCircle,
  FileCheck,
  X,
  Plus,
  ClipboardPaste,
} from 'lucide-react';
import { ParsedSyllabusResponse } from '../types/course';
import { SAMPLE_SYLLABI, SampleSyllabusPreset } from '../data/initialCourses';
import {
  extractTextFromFileOnClient,
  parseSyllabusOnClientFallback,
} from '../utils/clientSyllabusParser';

interface AddCourseViewProps {
  onBack: () => void;
  onParsedSuccess: (parsed: ParsedSyllabusResponse) => void;
  onManualStart: () => void;
}

interface AttachedFileItem {
  id: string;
  file: File;
  previewUrl: string | null;
}

/**
 * Compresses large images on the client so multiple screenshots upload rapidly
 */
async function fileToOptimizedBase64(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  const lower = file.name.toLowerCase();
  const isImage =
    file.type.startsWith('image/') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp');

  if (isImage) {
    try {
      const bitmap = await createImageBitmap(file);
      const maxDim = 1280;
      let width = bitmap.width;
      let height = bitmap.height;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        return {
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg',
        };
      }
    } catch {
      // Fall back to standard FileReader below if createImageBitmap fails
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve({
        base64,
        mimeType: file.type || 'application/octet-stream',
      });
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export const AddCourseView: React.FC<AddCourseViewProps> = ({
  onBack,
  onParsedSuccess,
  onManualStart,
}) => {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const appendFiles = (newFiles: FileList | File[]) => {
    setErrorMsg(null);
    const list = Array.from(newFiles);
    if (list.length === 0) return;

    const addedItems: AttachedFileItem[] = list.map((file, idx) => {
      const isImg =
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif)$/i.test(file.name);
      return {
        id: `file-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: isImg ? URL.createObjectURL(file) : null,
      };
    });

    setAttachedFiles((prev) => [...prev, ...addedItems]);
  };

  const removeAttachedFile = (id: string) => {
    setAttachedFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const clearAllFiles = () => {
    for (const item of attachedFiles) {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
    setAttachedFiles([]);
  };

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (isParsing) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedImageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const ext = item.type.split('/')[1] || 'png';
            pastedImageFiles.push(
              new File(
                [blob],
                `screenshot-${attachedFiles.length + pastedImageFiles.length + 1}.${ext}`,
                { type: item.type }
              )
            );
          }
        }
      }

      if (pastedImageFiles.length > 0) {
        e.preventDefault();
        appendFiles(pastedImageFiles);
        return;
      }

      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        e.preventDefault();
        appendFiles(e.clipboardData.files);
        return;
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag !== 'textarea' && activeTag !== 'input') {
        const text = e.clipboardData?.getData('text/plain');
        if (text && text.trim()) {
          e.preventDefault();
          setErrorMsg(null);
          setPastedText((prev) => (prev ? `${prev}\n\n${text}` : text));
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [isParsing, attachedFiles.length]);

  const handleParse = async () => {
    setErrorMsg(null);

    if (attachedFiles.length === 0 && !pastedText.trim()) {
      setErrorMsg(
        'Please upload or paste at least one screenshot/file, or paste course website text.'
      );
      return;
    }

    setIsParsing(true);
    try {
      let clientExtractedText = pastedText.trim();
      const binaryFilesPayload: Array<{
        fileName: string;
        mimeType: string;
        base64Data: string;
      }> = [];

      for (const item of attachedFiles) {
        const extractedFromDoc = await extractTextFromFileOnClient(item.file);
        if (extractedFromDoc && extractedFromDoc.length >= 30) {
          clientExtractedText = clientExtractedText
            ? `${clientExtractedText}\n\n--- ${item.file.name} ---\n${extractedFromDoc}`
            : extractedFromDoc;
        } else {
          const optimized = await fileToOptimizedBase64(item.file);
          binaryFilesPayload.push({
            fileName: item.file.name,
            mimeType: optimized.mimeType,
            base64Data: optimized.base64,
          });
        }
      }

      const primaryFileName = attachedFiles[0]?.file.name;

      const payload: {
        fileName?: string;
        files?: Array<{
          fileName: string;
          mimeType: string;
          base64Data: string;
        }>;
        rawText?: string;
      } = {
        fileName: primaryFileName,
      };

      if (binaryFilesPayload.length > 0) {
        payload.files = binaryFilesPayload;
      }
      if (clientExtractedText) {
        payload.rawText = clientExtractedText;
      }

      // 1. Try Backend API (/api/parse-syllabus)
      try {
        const response = await fetch('/api/parse-syllabus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const data = (await response.json()) as ParsedSyllabusResponse;
          onParsedSuccess(data);
          return;
        }
      } catch {
        // Backend route unreachable (e.g. static deployment); fall through to client parser
      }

      // 2. Fallback: Client-side Gemini or Smart Syllabus Parser
      const fallbackResult = await parseSyllabusOnClientFallback({
        fileName: primaryFileName,
        files: binaryFilesPayload,
        extractedText: clientExtractedText,
      });

      onParsedSuccess(fallbackResult);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unable to parse syllabus. Please try again.'
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleSampleClick = (preset: SampleSyllabusPreset) => {
    setErrorMsg(null);
    onParsedSuccess(preset.fallbackParsed);
  };

  return (
    <div className="max-w-[720px] mx-auto px-6 py-12">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 mb-6 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 font-display">
          Add Course · 添加课程
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Support multiple screenshots (<kbd className="px-1.5 py-0.5 text-xs font-mono bg-white border border-slate-200 rounded">⌘V</kbd> / <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white border border-slate-200 rounded">Ctrl+V</kbd> repeatedly), PDF/Word files, or pasting long text directly from your course website.
        </p>
      </div>

      <div className="bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl p-6 space-y-6 shadow-2xs">
        {/* Multi-Screenshot / Multi-File Drop & Paste Zone */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700">
              1. Upload or Paste Multiple Screenshots / Files · 上传或连续粘贴多张截图/文件
            </span>
            {attachedFiles.length > 0 && (
              <button
                type="button"
                onClick={clearAllFiles}
                className="text-xs text-slate-400 hover:text-rose-600 cursor-pointer"
              >
                Clear all ({attachedFiles.length})
              </button>
            )}
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                appendFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => {
              if (attachedFiles.length === 0) {
                fileInputRef.current?.click();
              }
            }}
            className={`border-2 border-dashed rounded-xl p-6 transition-colors ${
              isDragging
                ? 'border-indigo-600 bg-indigo-50/40'
                : attachedFiles.length > 0
                ? 'border-indigo-300 bg-indigo-50/20'
                : 'border-slate-300 hover:border-indigo-400 bg-slate-50/40 cursor-pointer text-center py-8'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  appendFiles(e.target.files);
                  e.target.value = '';
                }
              }}
              className="hidden"
            />

            {attachedFiles.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {attachedFiles.map((item, index) => (
                    <div
                      key={item.id}
                      className="relative group bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between shadow-2xs"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAttachedFile(item.id);
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center hover:bg-rose-600 shadow-xs cursor-pointer z-10"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>

                      {item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt={`Screenshot ${index + 1}`}
                          referrerPolicy="no-referrer"
                          className="h-24 w-full object-cover rounded border border-slate-100"
                        />
                      ) : (
                        <div className="h-24 w-full flex flex-col items-center justify-center bg-emerald-50/50 rounded border border-emerald-100">
                          <FileCheck className="w-7 h-7 text-emerald-600" />
                        </div>
                      )}

                      <p className="text-[11px] font-medium text-slate-700 truncate mt-2 text-center">
                        {item.file.name}
                      </p>
                    </div>
                  ))}

                  {/* Add More Button Card */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="min-h-[126px] border-2 border-dashed border-indigo-200 hover:border-indigo-500 bg-white/70 hover:bg-indigo-50/40 rounded-lg flex flex-col items-center justify-center gap-1.5 text-indigo-600 transition-colors cursor-pointer p-3"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="text-xs font-semibold">Add More · 继续添加</span>
                    <span className="text-[10px] text-slate-400">
                      or press ⌘V / Ctrl+V
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <Upload className="w-8 h-8 text-indigo-500 mx-auto mb-2.5" />
                <p className="text-base font-semibold text-slate-900 font-display">
                  Click to select files or press{' '}
                  <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white border border-slate-300 rounded">
                    ⌘V
                  </kbd>{' '}
                  /{' '}
                  <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white border border-slate-300 rounded">
                    Ctrl+V
                  </kbd>{' '}
                  to paste multiple screenshots
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  You can paste several screenshots one after another (e.g. weights + grade scale) or upload PDF / Word (.docx)
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Large Course Website / Syllabus Text Paste Box */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="syllabus-text-input"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-indigo-600" />
              2. Or Paste Course Website / Syllabus Text · 或直接粘贴课程网页大段文字:
            </label>
            <div className="flex items-center gap-3">
              {pastedText && (
                <>
                  <span className="text-[11px] font-mono text-slate-400">
                    {pastedText.length.toLocaleString()} chars
                  </span>
                  <button
                    type="button"
                    onClick={() => setPastedText('')}
                    className="text-xs text-slate-400 hover:text-rose-600 cursor-pointer"
                  >
                    Clear text
                  </button>
                </>
              )}
            </div>
          </div>
          <textarea
            id="syllabus-text-input"
            rows={6}
            value={pastedText}
            onChange={(e) => {
              setErrorMsg(null);
              setPastedText(e.target.value);
            }}
            placeholder="Copy & paste directly from your course website (Canvas, PrairieLearn, Syllabus webpage, etc.) — you can paste an entire webpage (Ctrl+A, Ctrl+C, Ctrl+V) and AI will extract the grading policy, drop rules, and cutoffs automatically..."
            className="w-full p-3.5 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 leading-relaxed"
          />
        </div>

        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleParse}
          disabled={isParsing}
          className="w-full py-3 px-5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
        >
          {isParsing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Reading syllabus...
            </>
          ) : (
            'Analyze Syllabus · 智能识别课程规则'
          )}
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span>Try example:</span>
          {SAMPLE_SYLLABI.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={isParsing}
              onClick={() => handleSampleClick(preset)}
              className="text-slate-700 hover:text-indigo-600 underline underline-offset-2 cursor-pointer"
            >
              {preset.fallbackParsed.courseCode}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onManualStart}
          className="text-slate-600 hover:text-indigo-600 underline underline-offset-2 cursor-pointer"
        >
          Enter manually without syllabus · 手动输入
        </button>
      </div>
    </div>
  );
};

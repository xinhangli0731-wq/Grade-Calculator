import React, { useState, useRef, useEffect } from 'react';
import { Upload, ArrowLeft, Loader2, AlertCircle, FileCheck, X } from 'lucide-react';
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

/**
 * Compresses large images on the client so screenshots upload rapidly and never hit payload/timeout limits
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File | null) => {
    setErrorMsg(null);
    if (!file) {
      setSelectedFile(null);
      setImagePreviewUrl(null);
      return;
    }
    setSelectedFile(file);
    if (
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif)$/i.test(file.name)
    ) {
      const url = URL.createObjectURL(file);
      setImagePreviewUrl(url);
    } else {
      setImagePreviewUrl(null);
    }
  };

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (isParsing) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            const ext = item.type.split('/')[1] || 'png';
            const pastedFile = new File([blob], `pasted-screenshot.${ext}`, {
              type: item.type,
            });
            handleFileSelect(pastedFile);
            return;
          }
        }
      }

      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        e.preventDefault();
        handleFileSelect(e.clipboardData.files[0]);
        return;
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag !== 'textarea' && activeTag !== 'input') {
        const text = e.clipboardData?.getData('text/plain');
        if (text && text.trim()) {
          e.preventDefault();
          setErrorMsg(null);
          setPastedText((prev) => (prev ? `${prev}\n${text}` : text));
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [isParsing]);

  const handleParse = async () => {
    setErrorMsg(null);

    if (!selectedFile && !pastedText.trim()) {
      setErrorMsg('Please upload a file, paste a screenshot (⌘V / Ctrl+V), or paste syllabus text.');
      return;
    }

    setIsParsing(true);
    try {
      const payload: {
        fileName?: string;
        mimeType?: string;
        base64Data?: string;
        rawText?: string;
      } = {};

      let clientExtractedText = pastedText.trim();

      if (selectedFile) {
        payload.fileName = selectedFile.name;
        const extractedFromDoc = await extractTextFromFileOnClient(selectedFile);
        if (extractedFromDoc && extractedFromDoc.length >= 30) {
          clientExtractedText = clientExtractedText
            ? `${clientExtractedText}\n\n${extractedFromDoc}`
            : extractedFromDoc;
        } else {
          const optimized = await fileToOptimizedBase64(selectedFile);
          payload.mimeType = optimized.mimeType;
          payload.base64Data = optimized.base64;
        }
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

      // 2. Fallback: Client-side Gemini or Smart Syllabus Parser (works on any static host)
      const fallbackResult = await parseSyllabusOnClientFallback({
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        base64Data: payload.base64Data,
        extractedText: clientExtractedText,
      });

      onParsedSuccess(fallbackResult);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to parse syllabus. Please try again.'
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
    <div className="max-w-[680px] mx-auto px-6 py-12">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 mb-6 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <h1 className="text-2xl font-bold text-slate-900 font-display mb-6">
        Add Course
      </h1>

      <div className="bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl p-6 space-y-5 shadow-2xs">
        {/* Drop / Click / Paste Image Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.[0]) {
              handleFileSelect(e.dataTransfer.files[0]);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
            isDragging
              ? 'border-indigo-600 bg-indigo-50/40'
              : selectedFile
              ? 'border-indigo-500 bg-indigo-50/30'
              : 'border-slate-300 hover:border-indigo-400 bg-slate-50/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
            className="hidden"
          />

          {selectedFile ? (
            <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
              {imagePreviewUrl ? (
                <div className="relative inline-block">
                  <img
                    src={imagePreviewUrl}
                    alt="Pasted syllabus screenshot"
                    referrerPolicy="no-referrer"
                    className="max-h-44 rounded-lg border border-slate-200 mx-auto object-contain"
                  />
                </div>
              ) : (
                <FileCheck className="w-8 h-8 text-emerald-600 mx-auto" />
              )}
              <div className="flex items-center justify-center gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {selectedFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleFileSelect(null)}
                  className="p-1 text-slate-400 hover:text-slate-800 rounded cursor-pointer"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div>
              <Upload className="w-8 h-8 text-indigo-500 mx-auto mb-2.5" />
              <p className="text-base font-semibold text-slate-900 font-display">
                Upload syllabus or press <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white border border-slate-300 rounded">⌘V</kbd> / <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white border border-slate-300 rounded">Ctrl+V</kbd> to paste screenshot
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Supports Screenshot, Image, PDF, Word (.docx), or HTML
              </p>
            </div>
          )}
        </div>

        {/* Direct Paste Text Box */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="syllabus-text-input" className="text-xs font-medium text-slate-600">
              Or paste syllabus text directly:
            </label>
            {pastedText && (
              <button
                type="button"
                onClick={() => setPastedText('')}
                className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            id="syllabus-text-input"
            rows={4}
            value={pastedText}
            onChange={(e) => {
              setErrorMsg(null);
              setPastedText(e.target.value);
            }}
            placeholder="Paste grading breakdown here (e.g. Homework 10%, Midterm 1 20%, Midterm 2 20%, Final 50%...)"
            className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600"
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
            'Analyze Syllabus'
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
              className="text-slate-700 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
            >
              {preset.fallbackParsed.courseCode}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onManualStart}
          className="text-slate-600 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
        >
          Enter manually without syllabus
        </button>
      </div>
    </div>
  );
};

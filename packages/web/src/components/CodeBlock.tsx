import { useEffect, useState } from "react";

type CodeBlockProps = {
  code: string;
  language?: string;
};

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [clipboardAvailable, setClipboardAvailable] = useState(false);

  useEffect(() => {
    setClipboardAvailable(
      typeof navigator !== "undefined" &&
        typeof navigator.clipboard?.writeText === "function",
    );
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Silently fail if clipboard write is denied at runtime
    }
  };

  return (
    <div className="relative bg-gray-900 rounded-lg overflow-hidden">
      {clipboardAvailable && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 cursor-pointer transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      )}
      <pre
        className="p-4 pr-20 overflow-x-auto text-sm text-gray-100 font-mono m-0"
        data-language={language}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

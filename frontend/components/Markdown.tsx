'use client';

import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  language: string;
  code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg overflow-hidden my-4">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 dark:bg-gray-950 text-gray-400 text-xs">
        <span className="font-mono">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0 0 0.5rem 0.5rem',
          padding: '1rem',
          fontSize: '0.875rem',
          background: '#1a1b26',
        }}
        showLineNumbers
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function LazyImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative w-full h-64 my-4 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
      {/* 模糊占位符 */}
      <div
        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-500 ${
          loaded ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ backgroundImage: `url(${src})`, filter: 'blur(20px)', transform: 'scale(1.1)' }}
      />
      {/* 实际图片 */}
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 w-full h-full object-cover rounded-lg transition-opacity duration-500 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export default function Markdown({ content }: MarkdownProps) {
  // 提取代码块
  const codeBlocks: { lang: string; code: string }[] = [];
  let processedContent = content.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => {
      codeBlocks.push({ lang: lang || 'text', code: code.trim() });
      return `<div class="code-block-placeholder" data-index="${codeBlocks.length - 1}"></div>`;
    }
  );

  // 处理图片 - 使用 LazyImage 组件
  const images: { src: string; alt: string }[] = [];
  processedContent = processedContent.replace(
    /<img src="(.*?)" alt="(.*?)" \/>/g,
    (_, src, alt) => {
      images.push({ src, alt });
      return `<div class="image-placeholder" data-index="${images.length - 1}"></div>`;
    }
  );

  // 简单的 markdown 转换
  processedContent = processedContent
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-600 hover:underline">$1</a>')
    .replace(/^### (.+)$/gm, '<h3 id="$1" class="text-xl font-bold mt-6 mb-3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 id="$1" class="text-2xl font-bold mt-8 mb-4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 id="$1" class="text-3xl font-bold mt-8 mb-4">$1</h1>')
    .replace(/^\* (.+)$/gm, '<li class="ml-4">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/\n\n/g, '</p><p class="my-4">');

  return (
    <div className="prose dark:prose-invert max-w-none">
      <div dangerouslySetInnerHTML={{ __html: processedContent }} />
      {codeBlocks.map((block, index) => (
        <CodeBlock key={index} language={block.lang} code={block.code} />
      ))}
      {images.map((img, index) => (
        <LazyImage key={index} src={img.src} alt={img.alt} />
      ))}
    </div>
  );
}

// TOC 提取函数
export function extractToc(content: string) {
  const toc: { id: string; text: string; level: number }[] = [];
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    toc.push({ id, text, level });
  }

  return toc;
}

export interface TocItem {
  id: string;
  text: string;
  level: number;
}
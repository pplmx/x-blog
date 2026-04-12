'use client';

import { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';
import mermaid from 'mermaid';
import katex from 'katex';

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

function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
    });

    const renderMermaid = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).substring(7)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        setSvg(rendered);
        setError('');
      } catch (err) {
        setError('图表渲染失败');
        console.error('Mermaid error:', err);
      }
    };

    if (code) {
      renderMermaid();
    }
  }, [code]);

  if (error) {
    return (
      <div className="p-4 my-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
        <pre className="whitespace-pre-wrap">{code}</pre>
        <p className="mt-2 font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div
      className="my-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-x-auto flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// KaTeX 公式组件
function KatexFormula({ formula, displayMode }: { formula: string; displayMode: boolean }) {
  const [html, setHtml] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    try {
      const rendered = katex.renderToString(formula, {
        displayMode,
        throwOnError: false,
        trust: true,
      });
      setHtml(rendered);
      setError('');
    } catch (err) {
      setError('公式渲染失败');
      console.error('KaTeX error:', err);
    }
  }, [formula, displayMode]);

  if (error) {
    return (
      <div className="p-2 my-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 text-sm">
        {formula}
      </div>
    );
  }

  return (
    <span
      className={displayMode ? 'block my-4 text-center' : 'inline'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function LazyImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative w-full h-64 my-4 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
      <div
        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-500 ${
          loaded ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ backgroundImage: `url(${src})`, filter: 'blur(20px)', transform: 'scale(1.1)' }}
      />
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

// 处理数学公式
function processMathContent(content: string): { hasMath: boolean; blocks: { formula: string; displayMode: boolean }[] } {
  const mathBlocks: { formula: string; displayMode: boolean }[] = [];
  let hasMath = false;

  // 检测块级公式 $$...$$
  content = content.replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => {
    hasMath = true;
    mathBlocks.push({ formula: formula.trim(), displayMode: true });
    return `<div class="math-block-placeholder" data-index="${mathBlocks.length - 1}"></div>`;
  });

  // 检测行内公式 $...$ (但不匹配 $$)
  content = content.replace(/\$([^\$\n]+?)\$/g, (_, formula) => {
    hasMath = true;
    mathBlocks.push({ formula: formula.trim(), displayMode: false });
    return `<span class="math-inline-placeholder" data-index="${mathBlocks.length - 1}"></span>`;
  });

  return { hasMath, blocks: mathBlocks };
}

export default function Markdown({ content }: MarkdownProps) {
  // 处理数学公式
  const { blocks: mathBlocks } = processMathContent(content);

  // 提取 mermaid 代码块
  const mermaidBlocks: string[] = [];
  let processedContent = content.replace(
    /```mermaid\n([\s\S]*?)```/g,
    (_, code) => {
      mermaidBlocks.push(code.trim());
      return `<div class="mermaid-placeholder" data-index="${mermaidBlocks.length - 1}"></div>`;
    }
  );

  // 提取代码块
  const codeBlocks: { lang: string; code: string }[] = [];
  processedContent = processedContent.replace(
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
      {mathBlocks.map((block, index) => (
        <KatexFormula key={`math-${index}`} formula={block.formula} displayMode={block.displayMode} />
      ))}
      {mermaidBlocks.map((code, index) => (
        <MermaidBlock key={`mermaid-${index}`} code={code} />
      ))}
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

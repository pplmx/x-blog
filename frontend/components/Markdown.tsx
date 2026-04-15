'use client';

import { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, FileCode } from 'lucide-react';
import mermaid from 'mermaid';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { useImageLightbox } from './ImageLightboxContext';

// Allowed URL schemes and hostname whitelist (blog's own domain)
const ALLOWED_SCHEMES = ['https:', 'http:', 'mailto:'];
const ALLOWED_HOSTNAMES = [window.location.hostname];

/** Sanitize a URL: reject javascript:, data:, vbscript: and external hosts */
function sanitizeUrl(href: string): string {
  try {
    const url = new URL(href, window.location.origin);
    if (!ALLOWED_SCHEMES.includes(url.protocol)) return '#blocked';
    if (url.hostname !== window.location.hostname) return '#external';
    return url.href;
  } catch {
    return '#invalid';
  }
}

interface CodeBlockProps {
  language: string;
  code: string;
  highlightLines?: number[];
}

function CodeBlock({ language, code, highlightLines = [] }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  // Generate line numbers
  const lineCount = code.split('\n').length;

  return (
    <div className="relative group rounded-lg overflow-hidden my-4 border border-gray-200 dark:border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 dark:bg-gray-950 text-gray-300 text-sm border-b border-gray-700">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 opacity-60" />
          <span className="font-mono font-medium">{language || 'text'}</span>
        </div>
        <button
          onClick={handleCopy}
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
            transition-all duration-200
            ${
              copied
                ? 'bg-green-600/20 text-green-400'
                : 'hover:bg-gray-700 hover:text-white text-gray-400'
            }
          `}
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* Code content with line numbers */}
      <div className="flex bg-[#1a1b26]">
        {/* Line numbers */}
        <div
          className="py-4 pr-4 pl-4 text-right select-none text-gray-500 text-xs font-mono leading-6 border-r border-gray-700/50"
          aria-hidden="true"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className={
                highlightLines.includes(i + 1) ? 'bg-yellow-900/20 -mx-4 px-4 text-gray-300' : ''
              }
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code */}
        <div className="flex-1 overflow-x-auto">
          <SyntaxHighlighter
            ref={codeRef as React.RefObject<never>}
            language={language || 'text'}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: '1rem',
              paddingLeft: '1.5rem',
              fontSize: '0.875rem',
              lineHeight: '1.5rem',
              background: 'transparent',
            }}
            showLineNumbers={false}
            wrapLines
            lineProps={{
              style: { display: 'block' },
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
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

function LazyImage({
  src,
  alt,
  index,
  images,
}: {
  src: string;
  alt: string;
  index: number;
  images: { src: string; alt: string }[];
}) {
  const [loaded, setLoaded] = useState(false);
  const { openLightbox } = useImageLightbox();

  const handleClick = () => {
    openLightbox(images, index);
  };

  return (
    <button
      type="button"
      aria-label={`查看图片: ${alt}`}
      className="relative w-full h-64 my-4 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 cursor-zoom-in border-0 p-0"
      onClick={handleClick}
    >
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
    </button>
  );
}

// 处理数学公式
function processMathContent(content: string): {
  hasMath: boolean;
  blocks: { formula: string; displayMode: boolean }[];
} {
  const mathBlocks: { formula: string; displayMode: boolean }[] = [];
  let hasMath = false;

  // 检测块级公式 $$...$$
  content = content.replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => {
    hasMath = true;
    mathBlocks.push({ formula: formula.trim(), displayMode: true });
    return `<div class="math-block-placeholder" data-index="${mathBlocks.length - 1}"></div>`;
  });

  // 检测行内公式 $...$ (但不匹配 $$)
  content = content.replace(/\$([^$\n]+?)\$/g, (_, formula) => {
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
  let processedContent = content.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    mermaidBlocks.push(code.trim());
    return `<div class="mermaid-placeholder" data-index="${mermaidBlocks.length - 1}"></div>`;
  });

  // 提取代码块
  const codeBlocks: { lang: string; code: string }[] = [];
  processedContent = processedContent.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang: lang || 'text', code: code.trim() });
    return `<div class="code-block-placeholder" data-index="${codeBlocks.length - 1}"></div>`;
  });

  // 处理图片 - 使用 LazyImage 组件
  const images: { src: string; alt: string }[] = [];
  processedContent = processedContent.replace(
    /<img src="(.*?)" alt="(.*?)" \/>/g,
    (_, src, alt) => {
      images.push({ src, alt });
      return `<div class="image-placeholder" data-index="${images.length - 1}"></div>`;
    }
  );

  // Markdown 转换（链接走白名单）
  processedContent = processedContent
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, text, href) => {
      const safe = sanitizeUrl(href);
      if (safe === '#external') {
        return `<a href="${safe}" class="text-blue-600 hover:underline" rel="noopener noreferrer nofollow" target="_blank">${text}</a>`;
      }
      return `<a href="${safe}" class="text-blue-600 hover:underline">${text}</a>`;
    })
    .replace(/^### (.+)$/gm, '<h3 id="$1" class="text-xl font-bold mt-6 mb-3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 id="$1" class="text-2xl font-bold mt-8 mb-4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 id="$1" class="text-3xl font-bold mt-8 mb-4">$1</h1>')
    .replace(/^\* (.+)$/gm, '<li class="ml-4">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/\n\n/g, '</p><p class="my-4">');

  // DOMPurify 二次净化（防御遗漏的 XSS 向量）
  const sanitizedHtml = DOMPurify.sanitize(processedContent, {
    ALLOWED_TAGS: [
      'p',
      'strong',
      'em',
      'a',
      'h1',
      'h2',
      'h3',
      'li',
      'ul',
      'ol',
      'blockquote',
      'code',
      'pre',
      'br',
      'hr',
    ],
    ALLOWED_ATTR: ['href', 'class', 'id', 'target', 'rel', 'data-index'],
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus'],
  });

  return (
    <div className="prose dark:prose-invert max-w-none">
      <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
      {mathBlocks.map((block, index) => (
        <KatexFormula
          key={`math-${index}`}
          formula={block.formula}
          displayMode={block.displayMode}
        />
      ))}
      {mermaidBlocks.map((code, index) => (
        <MermaidBlock key={`mermaid-${index}`} code={code} />
      ))}
      {codeBlocks.map((block, index) => (
        <CodeBlock key={index} language={block.lang} code={block.code} />
      ))}
      {images.map((img, index) => (
        <LazyImage key={index} src={img.src} alt={img.alt} index={index} images={images} />
      ))}
    </div>
  );
}

// TOC 提取函数
export function extractToc(content: string) {
  const toc: { id: string; text: string; level: number }[] = [];
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  let match;
  const lastIndex = 0;
  const results: { level: number; text: string; id: string }[] = [];

  while (true) {
    match = headingRegex.exec(content);
    if (!match) break;

    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    results.push({ level, text, id });
  }

  return results;
}

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

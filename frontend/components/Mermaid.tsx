'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidProps {
  code: string;
}

export default function Mermaid({ code }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
    });
  }, []);

  useEffect(() => {
    const renderMermaid = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).substring(7)}`;
        const { svg } = await mermaid.render(id, code);
        setSvg(svg);
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
      ref={containerRef}
      className="my-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
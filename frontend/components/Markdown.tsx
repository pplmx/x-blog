import { marked } from 'marked';
import Image from 'next/image';

interface MarkdownProps {
  content: string;
}

export default function Markdown({ content }: MarkdownProps) {
  const html = marked.parse(content) as string;

  const processedHtml = html.replace(
    /<img src="(.*?)" alt="(.*?)" \/>/g,
    `<div class="relative w-full h-64 my-4">
      <Image 
        src="$1" 
        alt="$2" 
        fill
        className="object-cover rounded-lg"
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
      />
    </div>`
  );

  return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: processedHtml }} />;
}

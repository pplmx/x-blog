import { marked } from "marked";

interface MarkdownProps {
  content: string;
}

export default function Markdown({ content }: MarkdownProps) {
  const html = marked(content);
  return (
    <div
      className="prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
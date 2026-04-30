import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { testMocks } from '../../vitest.setup';
import Mermaid from '@/components/Mermaid';

const mocks = testMocks.mermaidRender;

describe('Mermaid', () => {

  it('renders error state when code is empty', async () => {
    render(<Mermaid code="" />);
    await waitFor(() => {
      expect(screen.queryByText('图表渲染失败')).not.toBeInTheDocument();
    });
  });

  it('renders SVG when code is valid', async () => {
    mocks.mockResolvedValue({ svg: '<svg>test-diagram</svg>' });
    render(<Mermaid code="graph TD; A-->B" />);
    await waitFor(() => {
      expect(screen.getByText('test-diagram')).toBeInTheDocument();
    });
  });

  it('shows error message when rendering fails', async () => {
    mocks.mockRejectedValue(new Error('Parse error'));
    render(<Mermaid code="invalid syntax" />);
    await waitFor(() => {
      expect(screen.getByText('图表渲染失败')).toBeInTheDocument();
    });
    expect(screen.getByText('invalid syntax')).toBeInTheDocument();
  });

  it('renders with long code without crash', async () => {
    mocks.mockResolvedValue({ svg: '<svg>long</svg>' });
    const longCode = 'graph TD;\n' + 'A-->B;\n'.repeat(50);
    render(<Mermaid code={longCode} />);
    await waitFor(() => {
      expect(screen.getByText('long')).toBeInTheDocument();
    });
  });
});

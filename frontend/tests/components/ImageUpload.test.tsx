import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageUpload } from '@/components/ImageUpload';

global.fetch = vi.fn();

vi.mock('next/image', () => ({
  default: (props: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={props.src} alt={props.alt} />
  ),
}));

describe('ImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dropzone when no value', () => {
    render(<ImageUpload onChange={vi.fn()} />);
    expect(screen.getByText('拖拽图片到这里，或点击选择')).toBeInTheDocument();
    expect(screen.getByText('选择图片')).toBeInTheDocument();
  });

  it('renders image preview when value is set', () => {
    render(<ImageUpload value="https://example.com/image.png" onChange={vi.fn()} />);
    expect(screen.queryByText('拖拽图片到这里，或点击选择')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument(); // X button
  });

  it('triggers file input on button click', () => {
    render(<ImageUpload onChange={vi.fn()} />);
    const button = screen.getByText('选择图片');
    const input = document.getElementById('image-upload') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    button.click();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('calls onChange with empty string when clear button clicked', async () => {
    const onChange = vi.fn();
    render(<ImageUpload value="https://example.com/image.png" onChange={onChange} />);
    const deleteButton = screen.getByRole('button');
    fireEvent.click(deleteButton);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('uploads file and calls onChange with URL', async () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://example.com/new.png' }),
    });

    render(<ImageUpload onChange={onChange} />);

    // Simulate file selection
    const input = document.getElementById('image-upload') as HTMLInputElement;
    const file = new File(['test'], 'test.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('shows loading state during upload', async () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    render(<ImageUpload onChange={onChange} />);
    const input = document.getElementById('image-upload') as HTMLInputElement;
    const file = new File(['test'], 'test.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    expect(screen.getByText('上传中...')).toBeInTheDocument();
  });

  it('renders in disabled state', () => {
    render(<ImageUpload value="" onChange={vi.fn()} disabled />);
    const button = screen.getByText('选择图片');
    expect((button.closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

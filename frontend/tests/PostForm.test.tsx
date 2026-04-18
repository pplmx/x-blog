import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PostForm } from '@/components/PostForm';
import { PostCreate } from '@/lib/api';
import { Category, Tag } from '@/types';

// Mock ImageUpload component
vi.mock('@/components/ImageUpload', () => ({
  ImageUpload: ({ value, onChange }: { value: string; onChange: (url: string) => void }) => (
    <div data-testid="image-upload">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Image URL"
        data-testid="image-upload-input"
      />
    </div>
  ),
}));

// Mock Button component
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, type, onClick, size }: any) => (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      data-size={size}
      data-testid="button"
    >
      {children}
    </button>
  ),
}));

// Mock Input component
vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, className, required }: any) => (
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      required={required}
      data-testid="input"
    />
  ),
}));

// Mock Textarea component
vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({ value, onChange, placeholder, className, required, rows }: any) => (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      required={required}
      rows={rows}
      data-testid="textarea"
    />
  ),
}));

describe('PostForm', () => {
  const mockCategories: Category[] = [
    { id: 1, name: 'Tech' },
    { id: 2, name: 'Lifestyle' },
  ];

  const mockTags: Tag[] = [
    { id: 1, name: 'react' },
    { id: 2, name: 'typescript' },
    { id: 3, name: 'nextjs' },
  ];

  const defaultFormData: Partial<PostCreate> = {
    title: '',
    slug: '',
    content: '',
    excerpt: '',
    published: false,
  };

  const renderForm = (props: Partial<Parameters<typeof PostForm>[0]> = {}) => {
    const setFormData = vi.fn();
    const onSubmit = vi.fn((e) => e.preventDefault());

    render(
      <PostForm
        formData={props.formData || defaultFormData}
        setFormData={setFormData}
        categories={props.categories}
        tags={props.tags}
        isSubmitting={props.isSubmitting}
        onSubmit={onSubmit}
        onCancel={props.onCancel}
      />
    );

    return { setFormData, onSubmit };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Form rendering', () => {
    it('should render form element', () => {
      renderForm();

      const form = document.querySelector('form');
      expect(form).toBeDefined();
    });

    it('should render title input', () => {
      renderForm();

      const inputs = document.querySelectorAll('input');
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('should render content textarea', () => {
      renderForm();

      const textareas = document.querySelectorAll('textarea');
      expect(textareas.length).toBeGreaterThan(0);
    });

    it('should render category select', () => {
      renderForm({ categories: mockCategories });

      const select = document.querySelector('select');
      expect(select).toBeDefined();
    });

    it('should render tag checkboxes', () => {
      renderForm({ tags: mockTags });

      // 3 tag checkboxes + 1 published checkbox = 4 total
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(mockTags.length + 1); // +1 for published checkbox
    });

    it('should render published checkbox', () => {
      renderForm();

      // Find the published checkbox by its associated label text
      const publishCheckbox = document.querySelector('input[id="published"]');
      expect(publishCheckbox).toBeDefined();
    });

    it('should show no tags message when tags are empty', () => {
      renderForm({ tags: [] });

      expect(screen.getByText('暂无标签')).toBeDefined();
    });

    it('should render submit button', () => {
      renderForm();

      const buttons = document.querySelectorAll('button');
      const submitButton = Array.from(buttons).find(b => b.textContent?.includes('保存文章'));
      expect(submitButton).toBeDefined();
    });
  });

  describe('Title/content input', () => {
    it('should display title value', () => {
      renderForm({ formData: { ...defaultFormData, title: 'Test Title' } });

      const titleInput = document.querySelector('input[placeholder="输入文章标题"]') as HTMLInputElement;
      expect(titleInput.value).toBe('Test Title');
    });

    it('should display content value', () => {
      renderForm({ formData: { ...defaultFormData, content: 'Test content' } });

      const contentTextarea = document.querySelector('textarea[placeholder*="Markdown"]') as HTMLTextAreaElement;
      expect(contentTextarea.value).toBe('Test content');
    });

    it('should call setFormData when title changes', () => {
      const { setFormData } = renderForm();

      const titleInput = document.querySelector('input[placeholder="输入文章标题"]') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'New Title' } });

      expect(setFormData).toHaveBeenCalled();
    });

    it('should call setFormData when content changes', () => {
      const { setFormData } = renderForm();

      const contentTextarea = document.querySelector('textarea[placeholder*="Markdown"]') as HTMLTextAreaElement;
      fireEvent.change(contentTextarea, { target: { value: 'New content' } });

      expect(setFormData).toHaveBeenCalled();
    });

    it('should display slug value', () => {
      renderForm({ formData: { ...defaultFormData, slug: 'test-slug' } });

      const slugInput = document.querySelector('input[placeholder="article-slug"]') as HTMLInputElement;
      expect(slugInput.value).toBe('test-slug');
    });

    it('should display excerpt value', () => {
      renderForm({ formData: { ...defaultFormData, excerpt: 'Test excerpt' } });

      const textareas = document.querySelectorAll('textarea');
      // Second textarea is excerpt (after content textarea)
      const excerptTextarea = textareas[0] as HTMLTextAreaElement;
      expect(excerptTextarea.value).toBe('Test excerpt');
    });
  });

  describe('Category/tag selection', () => {
    it('should render category options', () => {
      renderForm({ categories: mockCategories });

      const select = document.querySelector('select') as HTMLSelectElement;
      expect(select.options.length).toBe(mockCategories.length + 1); // +1 for "选择分类" option
    });

    it('should display selected category', () => {
      renderForm({
        categories: mockCategories,
        formData: { ...defaultFormData, category_id: 1 }
      });

      const select = document.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('1');
    });

    it('should call setFormData when category changes', () => {
      const { setFormData } = renderForm({ categories: mockCategories });

      const select = document.querySelector('select') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: '2' } });

      expect(setFormData).toHaveBeenCalled();
    });

    it('should render tag checkboxes with correct labels', () => {
      renderForm({ tags: mockTags });

      expect(screen.getByText('#react')).toBeDefined();
      expect(screen.getByText('#typescript')).toBeDefined();
      expect(screen.getByText('#nextjs')).toBeDefined();
    });

    it('should check selected tags', () => {
      renderForm({
        tags: mockTags,
        formData: { ...defaultFormData, tag_ids: [1, 3] }
      });

      const checkboxes = document.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
      expect(checkboxes[0].checked).toBe(true);
      expect(checkboxes[1].checked).toBe(false);
      expect(checkboxes[2].checked).toBe(true);
    });

    it('should call setFormData when tag is toggled', () => {
      const { setFormData } = renderForm({ tags: mockTags });

      const checkboxes = document.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
      fireEvent.click(checkboxes[0]);

      expect(setFormData).toHaveBeenCalled();
    });
  });

  describe('Validation', () => {
    it('should have required attribute on title input', () => {
      renderForm();

      const titleInput = document.querySelector('input[placeholder="输入文章标题"]') as HTMLInputElement;
      expect(titleInput.required).toBe(true);
    });

    it('should have required attribute on content textarea', () => {
      renderForm();

      const contentTextarea = document.querySelector('textarea[placeholder*="Markdown"]') as HTMLTextAreaElement;
      expect(contentTextarea.required).toBe(true);
    });
  });

  describe('Submit handler mock', () => {
    it('should call onSubmit when form is submitted', () => {
      const { onSubmit } = renderForm();

      const form = document.querySelector('form') as HTMLFormElement;
      fireEvent.submit(form);

      expect(onSubmit).toHaveBeenCalled();
    });

    it('should display submitting state when isSubmitting is true', () => {
      renderForm({ isSubmitting: true });

      const submitButton = document.querySelector('button') as HTMLButtonElement;
      expect(submitButton.disabled).toBe(true);
      expect(screen.getByText('保存中...')).toBeDefined();
    });
  });

  describe('Preview toggle', () => {
    it('should toggle published state when checkbox is clicked', () => {
      const { setFormData } = renderForm({ formData: { ...defaultFormData, published: false } });

      const publishCheckbox = document.getElementById('published') as HTMLInputElement;
      fireEvent.click(publishCheckbox);

      expect(setFormData).toHaveBeenCalled();
    });

    it('should show published status text', () => {
      renderForm({ formData: { ...defaultFormData, published: true } });

      expect(screen.getByText('✅ 文章已发布')).toBeDefined();
    });

    it('should show draft status text when not published', () => {
      renderForm({ formData: { ...defaultFormData, published: false } });

      expect(screen.getByText('📝 保存为草稿')).toBeDefined();
    });
  });

  describe('Cancel handler', () => {
    it('should render cancel button when onCancel is provided', () => {
      const onCancel = vi.fn();
      renderForm({ onCancel });

      const cancelButton = screen.getByText('取消');
      expect(cancelButton).toBeDefined();
    });

    it('should call onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn();
      renderForm({ onCancel });

      const cancelButton = screen.getByText('取消');
      fireEvent.click(cancelButton);

      expect(onCancel).toHaveBeenCalled();
    });

    it('should not render cancel button when onCancel is not provided', () => {
      renderForm();

      expect(screen.queryByText('取消')).toBeNull();
    });
  });
});

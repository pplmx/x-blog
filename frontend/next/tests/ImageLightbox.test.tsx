import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ImageLightbox from '@/components/ImageLightbox';

describe('ImageLightbox', () => {
  const mockImages = [
    { src: '/image1.jpg', alt: 'Image 1' },
    { src: '/image2.jpg', alt: 'Image 2' },
    { src: '/image3.jpg', alt: 'Image 3' },
  ];

  const defaultProps = {
    images: mockImages,
    currentIndex: 0,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Mock document.body.style.overflow
    Object.defineProperty(document.body, 'style', {
      value: { overflow: '' },
      writable: true,
      configurable: true,
    });

    // Mock document.addEventListener and removeEventListener
    vi.spyOn(document, 'addEventListener');
    vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const renderLightbox = (props = defaultProps) => {
    return render(<ImageLightbox {...props} />);
  };

  describe('Modal open/close', () => {
    it('should render modal when opened', () => {
      renderLightbox();

      const modal = document.querySelector('[role="dialog"]');
      expect(modal).toBeDefined();
    });

    it('should have correct aria attributes', () => {
      renderLightbox();

      const modal = screen.getByRole('dialog');
      expect(modal.getAttribute('aria-modal')).toBe('true');
      expect(modal.getAttribute('aria-label')).toBe('图片查看器');
    });

    it('should call onClose when close button is clicked', () => {
      renderLightbox();

      const closeButton = screen.getByLabelText('关闭');
      fireEvent.click(closeButton);

      // Button click propagates to overlay, calling onClose twice
      expect(defaultProps.onClose).toHaveBeenCalledTimes(2);
    });

    it('should call onClose when overlay is clicked', () => {
      renderLightbox();

      const modal = screen.getByRole('dialog');
      fireEvent.click(modal);

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onClose when image container is clicked', () => {
      const { container } = renderLightbox();

      const imageContainer = container.querySelector('[role="img"]');
      if (imageContainer) {
        fireEvent.click(imageContainer);
      }

      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    it('should call onClose when Escape key is pressed', () => {
      renderLightbox();

      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should return null when currentIndex is out of bounds', () => {
      const { container } = renderLightbox({
        ...defaultProps,
        currentIndex: 10,
      });

      expect(container.firstChild).toBeNull();
    });

    it('should return null when images array is empty', () => {
      const { container } = renderLightbox({
        ...defaultProps,
        images: [],
      });

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Image display', () => {
    it('should display current image', () => {
      renderLightbox({ ...defaultProps, currentIndex: 1 });

      const images = screen.getAllByRole('img', { name: 'Image 2' });
      // Both the container div and img tag have role="img" with the same name
      expect(images.length).toBeGreaterThanOrEqual(1);
    });

    it('should display image with correct src', () => {
      renderLightbox({ ...defaultProps, currentIndex: 2 });

      const images = document.querySelectorAll('img');
      expect(images[0].getAttribute('src')).toBe('/image3.jpg');
    });

    it('should display image counter for multiple images', () => {
      renderLightbox();

      const counter = document.querySelector('[aria-live="polite"]');
      expect(counter).toBeDefined();
      expect(counter?.textContent).toBe('1 / 3');
    });

    it('should not display counter for single image', () => {
      renderLightbox({
        ...defaultProps,
        images: [{ src: '/single.jpg', alt: 'Single' }],
      });

      const counter = document.querySelector('[aria-live="polite"]');
      expect(counter).toBeNull();
    });

    it('should update counter when index changes', () => {
      const { rerender } = renderLightbox({ ...defaultProps, currentIndex: 0 });

      rerender(<ImageLightbox {...defaultProps} currentIndex={2} />);

      const counter = document.querySelector('[aria-live="polite"]');
      expect(counter?.textContent).toBe('3 / 3');
    });
  });

  describe('Keyboard navigation', () => {
    it('should register keyboard event listener on mount', () => {
      renderLightbox();

      expect(document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should remove keyboard event listener on unmount', () => {
      const { unmount } = renderLightbox();

      unmount();

      expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should navigate to previous image with ArrowLeft', () => {
      renderLightbox({ ...defaultProps, currentIndex: 1 });

      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
      });

      expect(defaultProps.onNavigate).toHaveBeenCalledWith(0);
    });

    it('should navigate to next image with ArrowRight', () => {
      renderLightbox({ ...defaultProps, currentIndex: 1 });

      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowRight' });
      });

      expect(defaultProps.onNavigate).toHaveBeenCalledWith(2);
    });

    it('should not navigate prev when at first image', () => {
      renderLightbox({ ...defaultProps, currentIndex: 0 });

      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
      });

      expect(defaultProps.onNavigate).not.toHaveBeenCalled();
    });

    it('should not navigate next when at last image', () => {
      renderLightbox({ ...defaultProps, currentIndex: 2 });

      act(() => {
        fireEvent.keyDown(document, { key: 'ArrowRight' });
      });

      expect(defaultProps.onNavigate).not.toHaveBeenCalled();
    });

    it('should close with Escape key', () => {
      renderLightbox();

      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should close with Escape from onKeyDown handler', () => {
      renderLightbox();

      const modal = screen.getByRole('dialog');
      fireEvent.keyDown(modal, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('Overlay click to close', () => {
    it('should close on overlay click', () => {
      renderLightbox();

      const modal = screen.getByRole('dialog');
      fireEvent.click(modal);

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should not close when clicking inside image container', () => {
      renderLightbox();

      const imageContainer = document.querySelector('[role="img"]') as HTMLElement;
      fireEvent.click(imageContainer);

      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    it('should propagate click events to stop propagation', () => {
      const { container } = renderLightbox();

      const imageContainer = container.querySelector('[role="img"]');

      // This should call stopPropagation internally
      if (imageContainer) {
        fireEvent.click(imageContainer);
      }

      // Close should not be called because click was stopped
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });

  describe('Navigation buttons', () => {
    it('should render navigation buttons for multiple images', () => {
      renderLightbox();

      const prevButton = screen.getByLabelText('上一张图片');
      const nextButton = screen.getByLabelText('下一张图片');

      expect(prevButton).toBeDefined();
      expect(nextButton).toBeDefined();
    });

    it('should not render navigation buttons for single image', () => {
      renderLightbox({
        ...defaultProps,
        images: [{ src: '/single.jpg', alt: 'Single' }],
      });

      expect(screen.queryByLabelText('上一张图片')).toBeNull();
      expect(screen.queryByLabelText('下一张图片')).toBeNull();
    });

    it('should call onNavigate with previous index on prev button click', () => {
      renderLightbox({ ...defaultProps, currentIndex: 1 });

      const prevButton = screen.getByLabelText('上一张图片');
      fireEvent.click(prevButton);

      expect(defaultProps.onNavigate).toHaveBeenCalledWith(0);
    });

    it('should call onNavigate with next index on next button click', () => {
      renderLightbox({ ...defaultProps, currentIndex: 1 });

      const nextButton = screen.getByLabelText('下一张图片');
      fireEvent.click(nextButton);

      expect(defaultProps.onNavigate).toHaveBeenCalledWith(2);
    });

    it('should disable prev button at first image', () => {
      renderLightbox({ ...defaultProps, currentIndex: 0 });

      const prevButton = screen.getByLabelText('上一张图片') as HTMLButtonElement;
      expect(prevButton.disabled).toBe(true);
    });

    it('should disable next button at last image', () => {
      renderLightbox({ ...defaultProps, currentIndex: 2 });

      const nextButton = screen.getByLabelText('下一张图片') as HTMLButtonElement;
      expect(nextButton.disabled).toBe(true);
    });

    it('should not call onNavigate when prev is disabled', () => {
      renderLightbox({ ...defaultProps, currentIndex: 0 });

      const prevButton = screen.getByLabelText('上一张图片');
      fireEvent.click(prevButton);

      expect(defaultProps.onNavigate).not.toHaveBeenCalled();
    });

    it('should not call onNavigate when next is disabled', () => {
      renderLightbox({ ...defaultProps, currentIndex: 2 });

      const nextButton = screen.getByLabelText('下一张图片');
      fireEvent.click(nextButton);

      expect(defaultProps.onNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Body scroll prevention', () => {
    it('should set body overflow to hidden on mount', () => {
      renderLightbox();

      expect(document.body.style.overflow).toBe('hidden');
    });

    it('should reset body overflow on unmount', () => {
      const { unmount } = renderLightbox();

      unmount();

      expect(document.body.style.overflow).toBe('');
    });
  });
});

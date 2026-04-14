'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import ImageLightbox from './ImageLightbox';

interface LightboxImage {
  src: string;
  alt: string;
}

interface ImageLightboxContextType {
  openLightbox: (images: LightboxImage[], initialIndex: number) => void;
  closeLightbox: () => void;
}

const ImageLightboxContext = createContext<ImageLightboxContextType | null>(null);

export function useImageLightbox() {
  const context = useContext(ImageLightboxContext);
  if (!context) {
    throw new Error('useImageLightbox must be used within ImageLightboxProvider');
  }
  return context;
}

interface ImageLightboxProviderProps {
  children: ReactNode;
}

export function ImageLightboxProvider({ children }: ImageLightboxProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [images, setImages] = useState<LightboxImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const openLightbox = useCallback((imgs: LightboxImage[], initialIndex: number) => {
    setImages(imgs);
    setCurrentIndex(initialIndex);
    setIsOpen(true);
  }, []);

  const closeLightbox = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleNavigate = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  return (
    <ImageLightboxContext.Provider value={{ openLightbox, closeLightbox }}>
      {children}
      {isOpen && (
        <ImageLightbox
          images={images}
          currentIndex={currentIndex}
          onClose={closeLightbox}
          onNavigate={handleNavigate}
        />
      )}
    </ImageLightboxContext.Provider>
  );
}

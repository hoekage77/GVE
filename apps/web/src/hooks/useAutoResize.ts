import { useCallback, useEffect, useRef } from "react";

interface UseAutoResizeOptions {
  minHeight?: number;
  maxHeight?: number;
  enabled?: boolean;
}

export function useAutoResize<T extends HTMLTextAreaElement>({
  minHeight = 80,
  maxHeight = 400,
  enabled = true
}: UseAutoResizeOptions = {}) {
  const elementRef = useRef<T>(null);
  const initialHeightRef = useRef<number>(minHeight);

  const resize = useCallback(() => {
    const element = elementRef.current;
    if (!element || !enabled) return;

    // Reset height to auto to get the correct scrollHeight
    element.style.height = "auto";
    
    // Calculate new height
    const scrollHeight = element.scrollHeight;
    const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
    
    element.style.height = `${newHeight}px`;
    
    // Add overflow if content exceeds maxHeight
    element.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  }, [minHeight, maxHeight, enabled]);

  const reset = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    
    element.style.height = `${initialHeightRef.current}px`;
    element.style.overflowY = "hidden";
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled) return;

    // Store initial height
    initialHeightRef.current = parseInt(getComputedStyle(element).minHeight) || minHeight;

    // Set initial styles
    element.style.resize = "none";
    element.style.overflowY = "hidden";

    // Resize on input
    const handleInput = () => resize();
    element.addEventListener("input", handleInput);

    // Resize on window resize
    const handleResize = () => resize();
    window.addEventListener("resize", handleResize);

    // Initial resize
    resize();

    return () => {
      element.removeEventListener("input", handleInput);
      window.removeEventListener("resize", handleResize);
    };
  }, [resize, minHeight, enabled]);

  return {
    ref: elementRef,
    resize,
    reset
  };
}

export interface LinkElement {
  id: number;
  text: string;
  url: string;
  type: "nav" | "product" | "social" | "blog" | "info";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HighlightBox {
  id: number;
  opacity: number;
  scale: number;
  active?: boolean;
}

export interface ExtractionState {
  currentView: "browser" | "scene" | "code";
  highlightsOn: boolean;
  elementCount: number;
  linkCount: number;
  extractedLinks: LinkElement[];
  selectedLinkId: number | null;
}

export type ViewType = "browser" | "scene" | "code";
